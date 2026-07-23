export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseUserAgent } from '@/lib/ua-parser'
import { lookupCountry, countryFromHeaders } from '@/lib/geo'
import { apiCache } from '@/lib/cache'

// POST /api/analytics/track — track a page view
// Records REAL visitor data only: IP, User-Agent → device + browser,
// IP → country (via ip-api.com), page, channel, referrer.
// Also maintains DailyStat.peakVisitors = max concurrent online (5-min window)
// seen so far today.
//
// DEFENSIVE DESIGN:
// The Task-17 schema added `device`, `browser`, `country` (PageView/VisitorSession)
// and `peakVisitors`, `topDevices`, `topBrowsers` (DailyStat). If a developer's
// LOCAL machine hasn't run `bun run db:push` yet, the local Prisma client /
// SQLite DB won't know these fields and every write that includes them would
// throw "Unknown field `device` ..." and return 500 — breaking ALL tracking.
// To avoid that, every write below is attempted with the full (rich) payload
// first, and on a schema-mismatch error we retry with a minimal payload that
// only contains the original (pre-Task-17) fields. This way tracking NEVER
// breaks, even on an unmigrated local DB.

function isSchemaMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Unknown field') ||
    msg.includes('does not exist') ||
    msg.includes('unknown column') ||
    msg.includes('no such column')
  )
}

// Fields introduced in Task-17. Stripped from the payload on the fallback path.
const NEW_FIELDS = ['device', 'browser', 'country', 'peakVisitors', 'topDevices', 'topBrowsers']

// Fields introduced for live-viewer tracking (PageView.matchId,
// VisitorSession.currentChannelId / currentMatchId). Stripped from the
// payload on the fallback path when the local DB hasn't been migrated yet.
const LIVE_VIEWER_FIELDS = ['matchId', 'currentChannelId', 'currentMatchId']

function stripNewFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!NEW_FIELDS.includes(k) && !LIVE_VIEWER_FIELDS.includes(k)) out[k] = v
  }
  return out as Partial<T>
}

// ── Auto-Cleanup ──
// Probabilistically triggers analytics data cleanup (1% chance per request).
// Two modes:
//   1. Midnight reset: If a new day has started since the last reset, deletes
//      ALL PageView + VisitorSession rows (DailyStat has the aggregated counts).
//   2. Old data cleanup: Deletes PageViews older than 90 days and VisitorSessions
//      older than 30 days (for days that weren't reset).
// Fire-and-forget — does NOT block the track response.

let _lastResetDate: string | null = null

function triggerAutoCleanup() {
  try {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)

    // ── Midnight Reset ──
    // If the date changed since the last reset, perform the daily reset:
    // Delete ALL PageView + VisitorSession rows. DailyStat keeps the counts.
    if (_lastResetDate && _lastResetDate !== todayStr) {
      console.log(`[Analytics Daily Reset] Date changed from ${_lastResetDate} to ${todayStr} — resetting...`)
      _lastResetDate = todayStr

      // Delete all PageViews (detailed data not needed — DailyStat has counts)
      db.pageView.deleteMany({}).then((result) => {
        if (result.count > 0) {
          console.log(`[Analytics Daily Reset] Deleted ${result.count} PageViews`)
        }
      }).catch((err) => {
        console.error('[Analytics Daily Reset] PageView deletion failed:', err)
      })

      // Delete all VisitorSessions (stale — new day)
      db.visitorSession.deleteMany({}).then((result) => {
        if (result.count > 0) {
          console.log(`[Analytics Daily Reset] Deleted ${result.count} VisitorSessions`)
        }
      }).catch((err) => {
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
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    db.pageView.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    }).then((result) => {
      if (result.count > 0) {
        console.log(`[Analytics Auto-Cleanup] Deleted ${result.count} old PageViews`)
      }
    }).catch((err) => {
      console.error('[Analytics Auto-Cleanup] PageView cleanup failed:', err)
    })

    db.visitorSession.deleteMany({
      where: { lastSeen: { lt: thirtyDaysAgo } },
    }).then((result) => {
      if (result.count > 0) {
        console.log(`[Analytics Auto-Cleanup] Deleted ${result.count} old VisitorSessions`)
      }
    }).catch((err) => {
      console.error('[Analytics Auto-Cleanup] VisitorSession cleanup failed:', err)
    })
  } catch {
    // Non-critical — never fail the track request
  }
}

export async function POST(request: NextRequest) {
  try {
    // ── Probabilistic auto-cleanup (1% chance per request) ──
    // Fire-and-forget: don't await, don't block the response
    if (Math.random() < 0.01) {
      triggerAutoCleanup()
    }

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
    const todayStr = now.toISOString().slice(0, 10) // YYYY-MM-DD
    // "Online now" window — MUST match /api/admin/live-viewers' active
    // window (60s) so peak-visitors tracking uses the same definition of
    // "online" as the admin live-viewer counts.
    const activeSince = new Date(now.getTime() - 60 * 1000)

    // Check if this session already viewed today (BEFORE creating the page view)
    const existingTodayView = await db.pageView.findFirst({
      where: {
        sessionId,
        createdAt: {
          gte: new Date(todayStr + 'T00:00:00.000Z'),
        },
      },
      select: { id: true },
    })

    // Create PageView (with REAL device + browser).
    // Fallback: if the local DB schema is pre-Task-17, retry without new fields.
    const pageViewData: Record<string, unknown> = {
      sessionId,
      page,
      channelId: channelId || null,
      matchId: matchId || null,
      referrer: referrer || '',
      userAgent: ua,
      country,
      ip,
      device,
      browser,
    }
    try {
      await db.pageView.create({ data: pageViewData as never })
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        await db.pageView.create({ data: stripNewFields(pageViewData) as never })
      } else {
        throw err
      }
    }

    // Upsert VisitorSession (sequential to avoid memory spikes).
    // Fallback: strip country/device/browser on schema mismatch.
    // Also stores currentChannelId / currentMatchId for live-viewer tracking.
    const sessionUpdate = {
      lastSeen: now,
      pageCount: { increment: 1 },
      country: country || undefined,
      device: device || undefined,
      browser: browser || undefined,
      // Live-viewer attribution: if this is a watch page view, record which
      // channel/match the visitor is watching. Cleared (set to null) on
      // non-watch page views so a stale attribution doesn't linger.
      currentChannelId: page === 'watch' ? (channelId || null) : null,
      currentMatchId: page === 'watch' ? (matchId || null) : null,
    }
    const sessionCreate = {
      sessionId,
      firstSeen: now,
      lastSeen: now,
      pageCount: 1,
      country,
      userAgent: ua,
      ip,
      device,
      browser,
      currentChannelId: page === 'watch' ? (channelId || null) : null,
      currentMatchId: page === 'watch' ? (matchId || null) : null,
    }
    try {
      await db.visitorSession.upsert({
        where: { sessionId },
        update: sessionUpdate as never,
        create: sessionCreate as never,
      })
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        await db.visitorSession.upsert({
          where: { sessionId },
          update: stripNewFields(sessionUpdate as Record<string, unknown>) as never,
          create: stripNewFields(sessionCreate as Record<string, unknown>) as never,
        })
      } else {
        throw err
      }
    }

    // If channelId is provided, increment channel viewCount
    if (channelId) {
      await db.channel.update({
        where: { id: channelId },
        data: { viewCount: { increment: 1 } },
      }).catch(() => {
        // Channel might not exist — ignore error
      })
    }

    // Upsert DailyStat.
    // Fallback: the Task-17 schema added peakVisitors/topDevices/topBrowsers to
    // DailyStat. On an old DB the `create` block referencing them throws, so we
    // retry with a minimal create block.
    const statCreate: Record<string, unknown> = {
      date: todayStr,
      totalViews: 0,
      uniqueVisitors: 0,
      peakVisitors: 0,
      topPages: '{}',
      topChannels: '{}',
      topCountries: '{}',
      topDevices: '{}',
      topBrowsers: '{}',
    }
    let currentStat
    try {
      currentStat = await db.dailyStat.upsert({
        where: { date: todayStr },
        update: {},
        create: statCreate as never,
      })
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        currentStat = await db.dailyStat.upsert({
          where: { date: todayStr },
          update: {},
          create: stripNewFields(statCreate) as never,
        })
      } else {
        throw err
      }
    }

    // Parse and update JSON fields.
    // Defensive reads: topDevices/topBrowsers/topCountries may be absent on an
    // unmigrated DB (the column simply won't exist in the returned row).
    const pv = currentStat as Record<string, unknown>
    const topPages: Record<string, number> = JSON.parse((pv.topPages as string) ?? '{}')
    const topChannels: Record<string, number> = JSON.parse((pv.topChannels as string) ?? '{}')
    const topCountries: Record<string, number> = JSON.parse((pv.topCountries as string) ?? '{}')
    let topDevices: Record<string, number> = {}
    let topBrowsers: Record<string, number> = {}
    try {
      topDevices = JSON.parse((pv.topDevices as string) ?? '{}')
    } catch { /* column absent on old schema */ }
    try {
      topBrowsers = JSON.parse((pv.topBrowsers as string) ?? '{}')
    } catch { /* column absent on old schema */ }

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

    // Build update payload.
    // Includes the new JSON columns (topDevices/topBrowsers). If the local DB
    // doesn't have them, the update below will throw → we retry with a
    // stripped payload.
    const updateData: Record<string, unknown> = {
      totalViews: { increment: 1 },
      topPages: JSON.stringify(topPages),
      topChannels: JSON.stringify(topChannels),
      topCountries: JSON.stringify(topCountries),
      topDevices: JSON.stringify(topDevices),
      topBrowsers: JSON.stringify(topBrowsers),
    }

    if (!existingTodayView) {
      updateData.uniqueVisitors = { increment: 1 }
    }

    try {
      await db.dailyStat.update({
        where: { id: currentStat.id },
        data: updateData as never,
      })
    } catch (err) {
      if (isSchemaMismatchError(err)) {
        await db.dailyStat.update({
          where: { id: currentStat.id },
          data: stripNewFields(updateData) as never,
        })
      } else {
        throw err
      }
    }

    // Update peakVisitors = max concurrent online (60-second window) seen today.
    // This is a REAL metric: the highest number of simultaneously-active
    // visitors recorded so far today. Computed AFTER this session is recorded
    // so the current visitor is included in the count.
    // The 60-second window matches /api/admin/live-viewers for consistency.
    // Wrapped in try/catch: peakVisitors column may be absent on an old DB,
    // and this is non-critical (must not fail the track request).
    try {
      const onlineNow = await db.visitorSession.count({
        where: { lastSeen: { gte: activeSince } },
      })
      const storedPeak = (pv.peakVisitors as number) || 0
      if (onlineNow > storedPeak) {
        try {
          await db.dailyStat.update({
            where: { id: currentStat.id },
            data: { peakVisitors: onlineNow },
          })
        } catch {
          // peakVisitors column absent on old schema — skip silently
        }
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
