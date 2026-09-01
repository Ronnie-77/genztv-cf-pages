import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { parseUserAgent } from '@/lib/ua-parser'
import { lookupCountry, countryFromHeaders } from '@/lib/geo'
import { apiCache } from '@/lib/cache'
import type { DailyStatRow } from '@/lib/types'

// POST /api/analytics/track — track a page view
//
// Records REAL visitor data only: IP, User-Agent → device + browser,
// IP → country (via ip-api.com), page, channel, referrer.
// Also maintains DailyStat.peakVisitors = max concurrent online (60s window)
// seen so far today.
//
// All writes use raw D1 SQL. Schema fields (device/browser/country/matchId/
// currentChannelId/currentMatchId/peakVisitors/topDevices/topBrowsers) are
// all present in prisma/d1-schema.sql — no defensive fallback needed.

// ── Auto-Cleanup ──
// Probabilistically triggers analytics data cleanup (1% chance per request).
// Two modes:
//   1. Midnight reset: If a new day has started since the last reset, deletes
//      ALL PageView + VisitorSession rows (DailyStat has the aggregated counts).
//   2. Old data cleanup: Deletes PageViews older than 90 days and VisitorSessions
//      older than 30 days (for days that weren't reset).
// Fire-and-forget — does NOT block the track response.

let _lastResetDate: string | null = null

async function triggerAutoCleanup() {
  try {
    const db = await getDb()
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)

    // ── Midnight Reset ──
    // If the date changed since the last reset, perform the daily reset:
    // Delete ALL PageView + VisitorSession rows. DailyStat keeps the counts.
    if (_lastResetDate && _lastResetDate !== todayStr) {
      console.log(`[Analytics Daily Reset] Date changed from ${_lastResetDate} to ${todayStr} — resetting...`)
      _lastResetDate = todayStr

      // Delete all PageViews (detailed data not needed — DailyStat has counts)
      db.run('DELETE FROM PageView')
        .then(() => console.log('[Analytics Daily Reset] PageView table cleared'))
        .catch((err) => {
          console.error('[Analytics Daily Reset] PageView deletion failed:', err)
        })

      // Delete all VisitorSessions (stale — new day)
      db.run('DELETE FROM VisitorSession')
        .then(() => console.log('[Analytics Daily Reset] VisitorSession table cleared'))
        .catch((err) => {
          console.error('[Analytics Daily Reset] VisitorSession deletion failed:', err)
        })

      // Invalidate all caches
      try { apiCache.clear() } catch { /* ignore */ }

      return // Skip old-data cleanup on reset day
    }

    // Initialize the reset date tracker
    if (!_lastResetDate) {
      _lastResetDate = todayStr
    }

    // ── Old Data Cleanup (fallback for non-reset days) ──
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    db.run('DELETE FROM PageView WHERE createdAt < ?', ninetyDaysAgo)
      .catch((err) => {
        console.error('[Analytics Auto-Cleanup] PageView cleanup failed:', err)
      })

    db.run('DELETE FROM VisitorSession WHERE lastSeen < ?', thirtyDaysAgo)
      .catch((err) => {
        console.error('[Analytics Auto-Cleanup] VisitorSession cleanup failed:', err)
      })
  } catch {
    // Non-critical — never fail the track request
  }
}

export async function POST(request: NextRequest) {
  // ── Probabilistic auto-cleanup (1% chance per request) ──
  // Fire-and-forget: don't await, don't block the response
  if (Math.random() < 0.01) {
    void triggerAutoCleanup().catch(() => {})
  }

  try {
    const db = await getDb()
    const body = await request.json()
    const { page, channelId, matchId, referrer } = body as {
      page: string
      channelId?: string
      matchId?: string
      referrer?: string
    }

    if (!page) {
      return NextResponse.json({ error: 'Page is required' }, { status: 400 })
    }

    // Get request metadata
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      ''
    const ua = request.headers.get('user-agent') || ''

    // Parse device + browser from the REAL user-agent (no fake data).
    const { device, browser } = parseUserAgent(ua)

    // Country: prefer CDN/proxy headers, fall back to IP geolocation.
    // This is the REAL visitor country derived from their IP address.
    let country = countryFromHeaders(request.headers)
    if (!country && ip) {
      country = await lookupCountry(ip)
    }

    // Generate simple session ID from ip+ua (avoid crypto import to save memory)
    let hash = 0
    const str = `${ip}-${ua}`
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    const sessionId = Math.abs(hash).toString(36).padStart(8, '0')

    const now = new Date()
    const nowIso = now.toISOString()
    const todayStr = nowIso.slice(0, 10) // YYYY-MM-DD
    const todayStartIso = todayStr + 'T00:00:00.000Z'
    // "Online now" window — MUST match /api/admin/live-viewers' active
    // window (60s) so peak-visitors tracking uses the same definition of
    // "online" as the admin live-viewer counts.
    const activeSinceIso = new Date(now.getTime() - 60 * 1000).toISOString()

    // Check if this session already viewed today (BEFORE creating the page view)
    const existingTodayView = await db.first<{ id: string }>(
      'SELECT id FROM PageView WHERE sessionId = ? AND createdAt >= ? LIMIT 1',
      sessionId,
      todayStartIso
    )

    // Create PageView (with REAL device + browser).
    await db.run(
      `INSERT INTO PageView (id, sessionId, page, channelId, matchId, referrer, userAgent, country, ip, device, browser, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      generateId(),
      sessionId,
      page,
      channelId || null,
      matchId || null,
      referrer || '',
      ua,
      country,
      ip,
      device,
      browser,
      nowIso
    )

    // Upsert VisitorSession (sessionId is UNIQUE — see VisitorSession_sessionId_key).
    // - On INSERT: firstSeen=lastSeen=now, pageCount=1.
    // - On CONFLICT: increment pageCount atomically, update lastSeen +
    //   attribution fields.
    // Live-viewer attribution: if this is a watch page view, record which
    // channel/match the visitor is watching. Cleared (set to null) on
    // non-watch page views so a stale attribution doesn't linger.
    const currentChannelId = page === 'watch' ? (channelId || null) : null
    const currentMatchId = page === 'watch' ? (matchId || null) : null
    await db.run(
      `INSERT INTO VisitorSession (id, sessionId, firstSeen, lastSeen, pageCount, country, userAgent, ip, device, browser, currentChannelId, currentMatchId)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sessionId) DO UPDATE SET
         lastSeen = excluded.lastSeen,
         pageCount = pageCount + 1,
         country = excluded.country,
         device = excluded.device,
         browser = excluded.browser,
         currentChannelId = excluded.currentChannelId,
         currentMatchId = excluded.currentMatchId`,
      generateId(),
      sessionId,
      nowIso,
      nowIso,
      country,
      ua,
      ip,
      device,
      browser,
      currentChannelId,
      currentMatchId
    )

    // If channelId is provided, increment channel viewCount
    if (channelId) {
      db.run('UPDATE Channel SET viewCount = viewCount + 1 WHERE id = ?', channelId)
        .catch(() => {
          // Channel might not exist — ignore error
        })
    }

    // Ensure today's DailyStat row exists (date is UNIQUE — DailyStat_date_key).
    // ON CONFLICT DO NOTHING preserves any existing counts.
    await db.run(
      `INSERT INTO DailyStat (id, date, totalViews, uniqueVisitors, peakVisitors, topPages, topChannels, topCountries, topDevices, topBrowsers, createdAt, updatedAt)
       VALUES (?, ?, 0, 0, 0, '{}', '{}', '{}', '{}', '{}', ?, ?)
       ON CONFLICT(date) DO NOTHING`,
      generateId(),
      todayStr,
      nowIso,
      nowIso
    )

    // Fetch today's (just-ensured) stat
    const currentStat = await db.first<DailyStatRow>(
      'SELECT * FROM DailyStat WHERE date = ?',
      todayStr
    )
    if (!currentStat) {
      throw new Error("Failed to load today's DailyStat after upsert")
    }

    // Parse and update JSON fields
    const topPages: Record<string, number> = JSON.parse(currentStat.topPages ?? '{}')
    const topChannels: Record<string, number> = JSON.parse(currentStat.topChannels ?? '{}')
    const topCountries: Record<string, number> = JSON.parse(currentStat.topCountries ?? '{}')
    const topDevices: Record<string, number> = JSON.parse(currentStat.topDevices ?? '{}')
    const topBrowsers: Record<string, number> = JSON.parse(currentStat.topBrowsers ?? '{}')

    topPages[page] = (topPages[page] || 0) + 1

    if (channelId) {
      topChannels[channelId] = (topChannels[channelId] || 0) + 1
    }

    if (country) {
      topCountries[country] = (topCountries[country] || 0) + 1
    }

    if (device) {
      topDevices[device] = (topDevices[device] || 0) + 1
    }

    if (browser) {
      topBrowsers[browser] = (topBrowsers[browser] || 0) + 1
    }

    // Atomic increment for counts (matches Prisma's `{ increment: 1 }`).
    // uniqueVisitors increments by 1 only if this is a new unique session today.
    const uniqueIncrement = existingTodayView ? 0 : 1
    await db.run(
      `UPDATE DailyStat SET
         totalViews = totalViews + 1,
         uniqueVisitors = uniqueVisitors + ?,
         topPages = ?,
         topChannels = ?,
         topCountries = ?,
         topDevices = ?,
         topBrowsers = ?,
         updatedAt = ?
       WHERE id = ?`,
      uniqueIncrement,
      JSON.stringify(topPages),
      JSON.stringify(topChannels),
      JSON.stringify(topCountries),
      JSON.stringify(topDevices),
      JSON.stringify(topBrowsers),
      nowIso,
      currentStat.id
    )

    // Update peakVisitors = max concurrent online (60-second window) seen today.
    // This is a REAL metric: the highest number of simultaneously-active
    // visitors recorded so far today. Computed AFTER this session is recorded
    // so the current visitor is included in the count.
    // The 60-second window matches /api/admin/live-viewers for consistency.
    // Wrapped in try/catch — non-critical (must not fail the track request).
    try {
      const onlineRow = await db.first<{ c: number }>(
        'SELECT COUNT(*) as c FROM VisitorSession WHERE lastSeen >= ?',
        activeSinceIso
      )
      const onlineNow = onlineRow?.c ?? 0
      const storedPeak = currentStat.peakVisitors || 0
      if (onlineNow > storedPeak) {
        await db.run(
          'UPDATE DailyStat SET peakVisitors = ? WHERE id = ?',
          onlineNow,
          currentStat.id
        )
      }
    } catch {
      // Non-critical — don't fail the track request
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Analytics] Track error:', error)
    const message = error instanceof Error ? error.message : 'Failed to track page view'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
