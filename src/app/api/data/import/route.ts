import { NextRequest, NextResponse } from 'next/server'
import { getDb, generateId } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import { toNum } from '@/lib/types'

// POST /api/data/import — Import data from JSON (admin only)
//
// Restores a GenZ TV backup file produced by GET /api/data.
//
// Per the migration spec: uses `db.batch([...])` so the DELETE + INSERT
// statements for each table run as an atomic transaction. Existing rows are
// deleted first, then the imported rows are inserted — this is a RESTORE,
// not a merge.
//
// Also supports channels-only imports (type: "channels-only" in _meta) —
// that path is a MERGE that uses `INSERT OR REPLACE` so existing channels
// are updated in place without wiping the rest of the database.
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      // Check content-length to reject obviously too-large payloads early
      const contentLength = req.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'File too large. Maximum size is 100MB.' },
          { status: 413 }
        )
      }

      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return NextResponse.json(
          {
            error:
              "Invalid JSON — could not parse the file. Make sure it's a valid backup file.",
          },
          { status: 400 }
        )
      }

      if (!body._meta || !(body._meta as Record<string, unknown>).version) {
        return NextResponse.json(
          {
            error:
              'Invalid import file — missing _meta.version header. Make sure this is a GenZ TV backup file.',
          },
          { status: 400 }
        )
      }

      const meta = body._meta as Record<string, unknown>
      const isChannelsOnly = meta.type === 'channels-only'

      const db = await getDb()
      const now = new Date().toISOString()

      const r = {
        channels: { imported: 0, skipped: 0 },
        matches: { imported: 0, skipped: 0 },
        categories: { imported: 0, skipped: 0 },
        settings: false,
        dailyStats: { imported: 0, skipped: 0 },
        visitorSessions: { imported: 0, skipped: 0 },
        pageViews: { imported: 0, skipped: 0 },
      }

      // ── Channels-Only Import Path (MERGE) ──
      if (isChannelsOnly) {
        if (Array.isArray(body.channels)) {
          const channels = body.channels as Record<string, unknown>[]
          const statements: { sql: string; params: unknown[] }[] = []
          for (const ch of channels) {
            try {
              statements.push({
                sql: `INSERT OR REPLACE INTO Channel
                        (id, name, logo, category, streamType, streamUrl, githubM3uPath,
                         language, country, tags, isFeatured, isActive, viewCount,
                         createdAt, updatedAt, sourcePageUrl, refreshPattern,
                         tokenExpiresAt, lastRefreshedAt, autoRefresh, refreshError)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [
                  ch.id,
                  ch.name,
                  (ch.logo as string) ?? '',
                  (ch.category as string) ?? 'entertainment',
                  (ch.streamType as string) ?? 'm3u',
                  (ch.streamUrl as string) ?? '',
                  (ch.githubM3uPath as string) ?? '',
                  (ch.language as string) ?? '',
                  (ch.country as string) ?? '',
                  (ch.tags as string) ?? '',
                  toNum((ch.isFeatured as boolean) ?? false),
                  toNum((ch.isActive as boolean) ?? true),
                  (ch.viewCount as number) ?? 0,
                  (ch.createdAt as string) ?? now,
                  (ch.updatedAt as string) ?? now,
                  (ch.sourcePageUrl as string) ?? '',
                  (ch.refreshPattern as string) ?? '',
                  (ch.tokenExpiresAt as string) ?? null,
                  (ch.lastRefreshedAt as string) ?? null,
                  toNum((ch.autoRefresh as boolean) ?? false),
                  (ch.refreshError as string) ?? '',
                ],
              })
              r.channels.imported++
            } catch {
              r.channels.skipped++
            }
          }
          if (statements.length > 0) {
            try {
              await db.batch(statements)
            } catch (err) {
              console.error('[Data Import] Channels-only batch error:', err)
            }
          }
        }

        apiCache.invalidateChannels()
        console.log('[Data Import] Channels-only import complete:', JSON.stringify(r))
        return NextResponse.json({ success: true, result: r })
      }

      // ── Full Import Path (RESTORE) ──
      // For each table: delete existing rows, then insert all imported rows
      // in a single atomic `db.batch()` transaction.

      // Settings — singleton row (id='app'). Delete + insert.
      if (body.settings && (body.settings as Record<string, unknown>)?.id) {
        const s = body.settings as Record<string, unknown>
        try {
          await db.batch([
            { sql: 'DELETE FROM AppSetting WHERE id = ?', params: ['app'] },
            {
              sql: `INSERT INTO AppSetting
                      (id, appName, logoUrl, maintenanceMode, featuredChannelId,
                       heroBannerText, defaultQuality, bannerAdScript, socialBarAdScript,
                       customAdScripts, adsEnabled, homeAdsEnabled, videoAdsEnabled, apkUrl,
                       ga4MeasurementId, firebaseConfig, securityEnabled, redirectAdUrl,
                       redirectAdEnabled, redirectAdIntervalMinutes, monetagEnabled,
                       monetagZoneId, monetagDomain)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              params: [
                'app',
                (s.appName as string) || 'GenZ TV',
                (s.logoUrl as string) || '',
                toNum((s.maintenanceMode as boolean) || false),
                (s.featuredChannelId as string) || '',
                (s.heroBannerText as string) || '',
                (s.defaultQuality as string) || 'auto',
                s.bannerAdScript ? String(s.bannerAdScript) : '',
                s.socialBarAdScript ? String(s.socialBarAdScript) : '',
                s.customAdScripts ? String(s.customAdScripts) : '[]',
                toNum(s.adsEnabled !== undefined ? (s.adsEnabled as boolean) : true),
                toNum(
                  s.homeAdsEnabled !== undefined ? (s.homeAdsEnabled as boolean) : true
                ),
                toNum(
                  s.videoAdsEnabled !== undefined
                    ? (s.videoAdsEnabled as boolean)
                    : true
                ),
                (s.apkUrl as string) || '',
                (s.ga4MeasurementId as string) || '',
                s.firebaseConfig ? String(s.firebaseConfig) : '{}',
                toNum(
                  s.securityEnabled !== undefined ? (s.securityEnabled as boolean) : true
                ),
                (s.redirectAdUrl as string) || '',
                toNum((s.redirectAdEnabled as boolean) ?? false),
                (s.redirectAdIntervalMinutes as number) ?? 5,
                toNum((s.monetagEnabled as boolean) ?? false),
                (s.monetagZoneId as string) || '',
                (s.monetagDomain as string) || '5gvci.com',
              ],
            },
          ])
          r.settings = true
        } catch (err) {
          console.error('[Data Import] Settings error:', err)
        }
      }

      // Categories — DELETE all then INSERT
      if (Array.isArray(body.categories)) {
        const cats = body.categories as Record<string, unknown>[]
        const statements: { sql: string; params: unknown[] }[] = [
          { sql: 'DELETE FROM Category', params: [] },
        ]
        let imported = 0
        for (const c of cats) {
          statements.push({
            sql: `INSERT INTO Category
                    (id, name, icon, color, "order", channelCount, createdAt, updatedAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              c.id,
              c.name,
              (c.icon as string) ?? '',
              (c.color as string) ?? '',
              (c.order as number) ?? 0,
              (c.channelCount as number) ?? 0,
              (c.createdAt as string) ?? now,
              (c.updatedAt as string) ?? now,
            ],
          })
          imported++
        }
        try {
          await db.batch(statements)
          r.categories.imported = imported
        } catch (err) {
          console.error('[Data Import] Categories error:', err)
          r.categories.skipped = cats.length - imported
        }
      }

      // Channels — DELETE all then INSERT
      if (Array.isArray(body.channels)) {
        const chs = body.channels as Record<string, unknown>[]
        const statements: { sql: string; params: unknown[] }[] = [
          { sql: 'DELETE FROM Channel', params: [] },
        ]
        let imported = 0
        for (const ch of chs) {
          statements.push({
            sql: `INSERT INTO Channel
                    (id, name, logo, category, streamType, streamUrl, githubM3uPath,
                     language, country, tags, isFeatured, isActive, viewCount,
                     createdAt, updatedAt, sourcePageUrl, refreshPattern,
                     tokenExpiresAt, lastRefreshedAt, autoRefresh, refreshError)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              ch.id,
              ch.name,
              (ch.logo as string) ?? '',
              (ch.category as string) ?? 'entertainment',
              (ch.streamType as string) ?? 'm3u',
              (ch.streamUrl as string) ?? '',
              (ch.githubM3uPath as string) ?? '',
              (ch.language as string) ?? '',
              (ch.country as string) ?? '',
              (ch.tags as string) ?? '',
              toNum((ch.isFeatured as boolean) ?? false),
              toNum((ch.isActive as boolean) ?? true),
              (ch.viewCount as number) ?? 0,
              (ch.createdAt as string) ?? now,
              (ch.updatedAt as string) ?? now,
              (ch.sourcePageUrl as string) ?? '',
              (ch.refreshPattern as string) ?? '',
              (ch.tokenExpiresAt as string) ?? null,
              (ch.lastRefreshedAt as string) ?? null,
              toNum((ch.autoRefresh as boolean) ?? false),
              (ch.refreshError as string) ?? '',
            ],
          })
          imported++
        }
        try {
          await db.batch(statements)
          r.channels.imported = imported
        } catch (err) {
          console.error('[Data Import] Channels error:', err)
          r.channels.skipped = chs.length - imported
        }
      }

      // Matches + Streams — DELETE all then INSERT
      if (Array.isArray(body.matches)) {
        const ms = body.matches as Record<string, unknown>[]
        const statements: { sql: string; params: unknown[] }[] = [
          // MatchStream references Match, so delete streams first.
          { sql: 'DELETE FROM MatchStream', params: [] },
          { sql: 'DELETE FROM Match', params: [] },
        ]
        let imported = 0
        let skipped = 0
        for (const m of ms) {
          const startTimeRaw = m.startTime ? new Date(m.startTime as string) : new Date()
          if (isNaN(startTimeRaw.getTime())) {
            skipped++
            continue
          }
          const startTime = startTimeRaw.toISOString()
          const endTime = m.endTime
            ? new Date(m.endTime as string).toISOString()
            : null
          statements.push({
            sql: `INSERT INTO Match
                    (id, title, sport, teamA, teamALogo, teamB, teamBLogo, league,
                     thumbnail, startTime, endTime, status, isFeatured, liveNotifiedAt,
                     createdAt, updatedAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              m.id,
              m.title,
              (m.sport as string) ?? 'football',
              m.teamA,
              (m.teamALogo as string) ?? '',
              m.teamB,
              (m.teamBLogo as string) ?? '',
              (m.league as string) ?? '',
              (m.thumbnail as string) ?? '',
              startTime,
              endTime,
              (m.status as string) ?? 'upcoming',
              toNum((m.isFeatured as boolean) ?? false),
              (m.liveNotifiedAt as string) ?? null,
              (m.createdAt as string) ?? now,
              (m.updatedAt as string) ?? now,
            ],
          })
          // Insert streams (nested under the match in the backup JSON)
          if (Array.isArray(m.streams)) {
            for (const s of m.streams as Record<string, unknown>[]) {
              statements.push({
                sql: `INSERT INTO MatchStream (id, matchId, name, channel, type, url)
                      VALUES (?, ?, ?, ?, ?, ?)`,
                params: [
                  (s.id as string) ?? generateId(),
                  m.id,
                  (s.name as string) ?? 'Stream 1',
                  (s.channel as string) ?? '',
                  (s.type as string) ?? 'iframe',
                  (s.url as string) ?? '',
                ],
              })
            }
          }
          imported++
        }
        try {
          await db.batch(statements)
          r.matches.imported = imported
          r.matches.skipped = skipped
        } catch (err) {
          console.error('[Data Import] Matches error:', err)
          r.matches.skipped = ms.length - imported
        }
      }

      // Daily Stats — DELETE all then INSERT
      if (Array.isArray(body.dailyStats)) {
        const ds = body.dailyStats as Record<string, unknown>[]
        const statements: { sql: string; params: unknown[] }[] = [
          { sql: 'DELETE FROM DailyStat', params: [] },
        ]
        let imported = 0
        for (const d of ds) {
          statements.push({
            sql: `INSERT INTO DailyStat
                    (id, date, totalViews, uniqueVisitors, peakVisitors, topPages,
                     topChannels, topCountries, topDevices, topBrowsers, createdAt, updatedAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              (d.id as string) ?? generateId(),
              d.date,
              (d.totalViews as number) ?? 0,
              (d.uniqueVisitors as number) ?? 0,
              (d.peakVisitors as number) ?? 0,
              (d.topPages as string) ?? '{}',
              (d.topChannels as string) ?? '{}',
              (d.topCountries as string) ?? '{}',
              (d.topDevices as string) ?? '{}',
              (d.topBrowsers as string) ?? '{}',
              (d.createdAt as string) ?? now,
              (d.updatedAt as string) ?? now,
            ],
          })
          imported++
        }
        try {
          await db.batch(statements)
          r.dailyStats.imported = imported
        } catch (err) {
          console.error('[Data Import] DailyStats error:', err)
          r.dailyStats.skipped = ds.length - imported
        }
      }

      // Visitor Sessions — DELETE all then INSERT
      if (Array.isArray(body.visitorSessions)) {
        const vs = body.visitorSessions as Record<string, unknown>[]
        const statements: { sql: string; params: unknown[] }[] = [
          { sql: 'DELETE FROM VisitorSession', params: [] },
        ]
        let imported = 0
        let skipped = 0
        for (const v of vs) {
          const firstSeenRaw = v.firstSeen
            ? new Date(v.firstSeen as string)
            : new Date()
          const lastSeenRaw = v.lastSeen
            ? new Date(v.lastSeen as string)
            : new Date()
          if (isNaN(firstSeenRaw.getTime()) || isNaN(lastSeenRaw.getTime())) {
            skipped++
            continue
          }
          statements.push({
            sql: `INSERT INTO VisitorSession
                    (id, sessionId, firstSeen, lastSeen, pageCount, country, userAgent,
                     ip, device, browser, currentChannelId, currentMatchId)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              (v.id as string) ?? generateId(),
              v.sessionId,
              firstSeenRaw.toISOString(),
              lastSeenRaw.toISOString(),
              (v.pageCount as number) ?? 0,
              (v.country as string) ?? '',
              (v.userAgent as string) ?? '',
              (v.ip as string) ?? '',
              (v.device as string) ?? '',
              (v.browser as string) ?? '',
              (v.currentChannelId as string) ?? null,
              (v.currentMatchId as string) ?? null,
            ],
          })
          imported++
        }
        try {
          await db.batch(statements)
          r.visitorSessions.imported = imported
          r.visitorSessions.skipped = skipped
        } catch (err) {
          console.error('[Data Import] VisitorSessions error:', err)
          r.visitorSessions.skipped = vs.length - imported
        }
      }

      // Page Views — DELETE all then INSERT (cap at 50000 to limit payload size)
      if (Array.isArray(body.pageViews)) {
        const pvs = (body.pageViews as Record<string, unknown>[]).slice(0, 50000)
        const statements: { sql: string; params: unknown[] }[] = [
          { sql: 'DELETE FROM PageView', params: [] },
        ]
        let imported = 0
        let skipped = 0
        for (const p of pvs) {
          const createdAtRaw = p.createdAt
            ? new Date(p.createdAt as string)
            : new Date()
          if (isNaN(createdAtRaw.getTime())) {
            skipped++
            continue
          }
          statements.push({
            sql: `INSERT INTO PageView
                    (id, sessionId, page, channelId, matchId, referrer, userAgent,
                     country, ip, device, browser, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              (p.id as string) ?? generateId(),
              (p.sessionId as string) ?? '',
              (p.page as string) ?? '',
              (p.channelId as string) ?? null,
              (p.matchId as string) ?? null,
              (p.referrer as string) ?? '',
              (p.userAgent as string) ?? '',
              (p.country as string) ?? '',
              (p.ip as string) ?? '',
              (p.device as string) ?? '',
              (p.browser as string) ?? '',
              createdAtRaw.toISOString(),
            ],
          })
          imported++
        }
        try {
          await db.batch(statements)
          r.pageViews.imported = imported
          r.pageViews.skipped = skipped
        } catch (err) {
          console.error('[Data Import] PageViews error:', err)
          r.pageViews.skipped = pvs.length - imported
        }
      }

      // Invalidate all caches — every table may have changed
      apiCache.clear()

      console.log('[Data Import] Complete:', JSON.stringify(r))
      return NextResponse.json({ success: true, result: r })
    } catch (error) {
      console.error('[Data Import] Fatal error:', error)
      const msg = error instanceof Error ? error.message : 'Import failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  })
}
