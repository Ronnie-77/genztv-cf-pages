export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

// POST /api/data/import — Import data from JSON (admin only)
//
// Restores a GenZ TV backup file produced by GET /api/data. Merges with
// existing data: same-ID records are updated, new-ID records are created.
// No data is deleted. All schema fields are preserved including the
// analytics enrichment fields (device, browser, peakVisitors, topDevices,
// topBrowsers) and the GA4 / Firebase settings — so a hosting change via
// export → import loses nothing.
//
// Also supports channels-only imports (type: "channels-only" in _meta).
export async function POST(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      // Check content-length to reject obviously too-large payloads early
      const contentLength = req.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
        return NextResponse.json({ error: 'File too large. Maximum size is 100MB.' }, { status: 413 })
      }

      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return NextResponse.json({ error: 'Invalid JSON — could not parse the file. Make sure it\'s a valid backup file.' }, { status: 400 })
      }

      if (!body._meta || !(body._meta as Record<string, unknown>).version) {
        return NextResponse.json({ error: 'Invalid import file — missing _meta.version header. Make sure this is a GenZ TV backup file.' }, { status: 400 })
      }

      const meta = body._meta as Record<string, unknown>
      const isChannelsOnly = meta.type === 'channels-only'

      const r = {
        channels: { imported: 0, skipped: 0 },
        matches: { imported: 0, skipped: 0 },
        categories: { imported: 0, skipped: 0 },
        settings: false,
        dailyStats: { imported: 0, skipped: 0 },
        visitorSessions: { imported: 0, skipped: 0 },
        pageViews: { imported: 0, skipped: 0 },
      }

      // ── Channels-Only Import Path ──
      if (isChannelsOnly) {
        if (Array.isArray(body.channels)) {
          for (const ch of body.channels as Record<string, unknown>[]) {
            try {
              await db.channel.upsert({
                where: { id: ch.id as string },
                update: { name: ch.name as string, logo: (ch.logo as string) ?? '', category: (ch.category as string) ?? 'entertainment', streamType: (ch.streamType as string) ?? 'm3u', streamUrl: (ch.streamUrl as string) ?? '', githubM3uPath: (ch.githubM3uPath as string) ?? '', language: (ch.language as string) ?? '', country: (ch.country as string) ?? '', tags: (ch.tags as string) ?? '', isFeatured: (ch.isFeatured as boolean) ?? false, isActive: (ch.isActive as boolean) ?? true, viewCount: (ch.viewCount as number) ?? 0 },
                create: { id: ch.id as string, name: ch.name as string, logo: (ch.logo as string) ?? '', category: (ch.category as string) ?? 'entertainment', streamType: (ch.streamType as string) ?? 'm3u', streamUrl: (ch.streamUrl as string) ?? '', githubM3uPath: (ch.githubM3uPath as string) ?? '', language: (ch.language as string) ?? '', country: (ch.country as string) ?? '', tags: (ch.tags as string) ?? '', isFeatured: (ch.isFeatured as boolean) ?? false, isActive: (ch.isActive as boolean) ?? true, viewCount: (ch.viewCount as number) ?? 0 },
              })
              r.channels.imported++
            } catch { r.channels.skipped++ }
          }
        }

        console.log('[Data Import] Channels-only import complete:', JSON.stringify(r))
        return NextResponse.json({ success: true, result: r })
      }

      // ── Full Import Path ──

      // Settings — ALL fields including GA4 / Firebase config
      if (body.settings && (body.settings as Record<string, unknown>)?.id) {
        const s = body.settings as Record<string, unknown>
        try {
          await db.appSetting.upsert({
            where: { id: 'app' },
            update: {
              appName: s.appName as string, logoUrl: s.logoUrl as string,
              maintenanceMode: s.maintenanceMode as boolean, featuredChannelId: s.featuredChannelId as string,
              heroBannerText: s.heroBannerText as string, defaultQuality: s.defaultQuality as string,
              bannerAdScript: s.bannerAdScript ? String(s.bannerAdScript) : null, socialBarAdScript: s.socialBarAdScript ? String(s.socialBarAdScript) : null,
              customAdScripts: s.customAdScripts ? String(s.customAdScripts) : null, adsEnabled: s.adsEnabled as boolean,
              homeAdsEnabled: s.homeAdsEnabled as boolean, videoAdsEnabled: s.videoAdsEnabled as boolean,
              apkUrl: s.apkUrl as string,
              ga4MeasurementId: (s.ga4MeasurementId as string) ?? '',
              firebaseConfig: (s.firebaseConfig as string) ?? '{}',
            },
            create: {
              id: 'app', appName: (s.appName as string) || 'GenZ TV', logoUrl: (s.logoUrl as string) || '',
              maintenanceMode: (s.maintenanceMode as boolean) || false, featuredChannelId: (s.featuredChannelId as string) || '',
              heroBannerText: (s.heroBannerText as string) || '', defaultQuality: (s.defaultQuality as string) || 'auto',
              bannerAdScript: s.bannerAdScript ? String(s.bannerAdScript) : null, socialBarAdScript: s.socialBarAdScript ? String(s.socialBarAdScript) : null,
              customAdScripts: s.customAdScripts ? String(s.customAdScripts) : null,
              adsEnabled: s.adsEnabled !== undefined ? (s.adsEnabled as boolean) : true,
              homeAdsEnabled: s.homeAdsEnabled !== undefined ? (s.homeAdsEnabled as boolean) : true,
              videoAdsEnabled: s.videoAdsEnabled !== undefined ? (s.videoAdsEnabled as boolean) : true,
              apkUrl: (s.apkUrl as string) || '',
              ga4MeasurementId: (s.ga4MeasurementId as string) || '',
              firebaseConfig: s.firebaseConfig ? String(s.firebaseConfig) : null,
            },
          })
          r.settings = true
        } catch (err) {
          console.error('[Data Import] Settings error:', err)
        }
      }

      // Categories
      if (Array.isArray(body.categories)) {
        for (const c of body.categories as Record<string, unknown>[]) {
          try {
            await db.category.upsert({
              where: { id: c.id as string },
              update: { name: c.name as string, icon: (c.icon as string) ?? '', color: (c.color as string) ?? '', order: (c.order as number) ?? 0, channelCount: (c.channelCount as number) ?? 0 },
              create: { id: c.id as string, name: c.name as string, icon: (c.icon as string) ?? '', color: (c.color as string) ?? '', order: (c.order as number) ?? 0, channelCount: (c.channelCount as number) ?? 0 },
            })
            r.categories.imported++
          } catch { r.categories.skipped++ }
        }
      }

      // Channels
      if (Array.isArray(body.channels)) {
        for (const ch of body.channels as Record<string, unknown>[]) {
          try {
            await db.channel.upsert({
              where: { id: ch.id as string },
              update: { name: ch.name as string, logo: (ch.logo as string) ?? '', category: (ch.category as string) ?? 'entertainment', streamType: (ch.streamType as string) ?? 'm3u', streamUrl: (ch.streamUrl as string) ?? '', githubM3uPath: (ch.githubM3uPath as string) ?? '', language: (ch.language as string) ?? '', country: (ch.country as string) ?? '', tags: (ch.tags as string) ?? '', isFeatured: (ch.isFeatured as boolean) ?? false, isActive: (ch.isActive as boolean) ?? true, viewCount: (ch.viewCount as number) ?? 0 },
              create: { id: ch.id as string, name: ch.name as string, logo: (ch.logo as string) ?? '', category: (ch.category as string) ?? 'entertainment', streamType: (ch.streamType as string) ?? 'm3u', streamUrl: (ch.streamUrl as string) ?? '', githubM3uPath: (ch.githubM3uPath as string) ?? '', language: (ch.language as string) ?? '', country: (ch.country as string) ?? '', tags: (ch.tags as string) ?? '', isFeatured: (ch.isFeatured as boolean) ?? false, isActive: (ch.isActive as boolean) ?? true, viewCount: (ch.viewCount as number) ?? 0 },
            })
            r.channels.imported++
          } catch { r.channels.skipped++ }
        }
      }

      // Matches + Streams
      if (Array.isArray(body.matches)) {
        for (const m of body.matches as Record<string, unknown>[]) {
          try {
            const startTime = m.startTime ? new Date(m.startTime as string) : new Date()
            const endTime = m.endTime ? new Date(m.endTime as string) : null
            // Validate dates
            if (isNaN(startTime.getTime())) {
              r.matches.skipped++
              continue
            }
            await db.match.upsert({
              where: { id: m.id as string },
              update: { title: m.title as string, sport: (m.sport as string) ?? 'football', teamA: m.teamA as string, teamALogo: (m.teamALogo as string) ?? '', teamB: m.teamB as string, teamBLogo: (m.teamBLogo as string) ?? '', league: (m.league as string) ?? '', thumbnail: (m.thumbnail as string) ?? '', startTime, endTime, status: (m.status as string) ?? 'upcoming', isFeatured: (m.isFeatured as boolean) ?? false },
              create: { id: m.id as string, title: m.title as string, sport: (m.sport as string) ?? 'football', teamA: m.teamA as string, teamALogo: (m.teamALogo as string) ?? '', teamB: m.teamB as string, teamBLogo: (m.teamBLogo as string) ?? '', league: (m.league as string) ?? '', thumbnail: (m.thumbnail as string) ?? '', startTime, endTime, status: (m.status as string) ?? 'upcoming', isFeatured: (m.isFeatured as boolean) ?? false },
            })
            if (Array.isArray(m.streams)) {
              for (const s of m.streams as Record<string, unknown>[]) {
                try {
                  await db.matchStream.upsert({
                    where: { id: s.id as string },
                    update: { name: (s.name as string) ?? 'Stream 1', channel: (s.channel as string) ?? '', type: (s.type as string) ?? 'iframe', url: (s.url as string) ?? '' },
                    create: { id: s.id as string, matchId: m.id as string, name: (s.name as string) ?? 'Stream 1', channel: (s.channel as string) ?? '', type: (s.type as string) ?? 'iframe', url: (s.url as string) ?? '' },
                  })
                } catch { /* skip stream */ }
              }
            }
            r.matches.imported++
          } catch (err) {
            console.error('[Data Import] Match error:', (err as Error).message)
            r.matches.skipped++
          }
        }
      }

      // Daily Stats — ALL fields including peakVisitors / topDevices / topBrowsers
      if (Array.isArray(body.dailyStats)) {
        for (const d of body.dailyStats as Record<string, unknown>[]) {
          try {
            await db.dailyStat.upsert({
              where: { date: d.date as string },
              update: {
                totalViews: (d.totalViews as number) ?? 0,
                uniqueVisitors: (d.uniqueVisitors as number) ?? 0,
                peakVisitors: (d.peakVisitors as number) ?? 0,
                topPages: (d.topPages as string) ?? '{}',
                topChannels: (d.topChannels as string) ?? '{}',
                topCountries: (d.topCountries as string) ?? '{}',
                topDevices: (d.topDevices as string) ?? '{}',
                topBrowsers: (d.topBrowsers as string) ?? '{}',
              },
              create: {
                date: d.date as string,
                totalViews: (d.totalViews as number) ?? 0,
                uniqueVisitors: (d.uniqueVisitors as number) ?? 0,
                peakVisitors: (d.peakVisitors as number) ?? 0,
                topPages: (d.topPages as string) ?? '{}',
                topChannels: (d.topChannels as string) ?? '{}',
                topCountries: (d.topCountries as string) ?? '{}',
                topDevices: (d.topDevices as string) ?? '{}',
                topBrowsers: (d.topBrowsers as string) ?? '{}',
              },
            })
            r.dailyStats.imported++
          } catch { r.dailyStats.skipped++ }
        }
      }

      // Visitor Sessions — ALL fields including device / browser
      if (Array.isArray(body.visitorSessions)) {
        for (const v of body.visitorSessions as Record<string, unknown>[]) {
          try {
            const firstSeen = v.firstSeen ? new Date(v.firstSeen as string) : new Date()
            const lastSeen = v.lastSeen ? new Date(v.lastSeen as string) : new Date()
            if (isNaN(firstSeen.getTime()) || isNaN(lastSeen.getTime())) {
              r.visitorSessions.skipped++
              continue
            }
            await db.visitorSession.upsert({
              where: { sessionId: v.sessionId as string },
              update: {
                lastSeen, pageCount: (v.pageCount as number) ?? 0, country: (v.country as string) ?? '',
                userAgent: (v.userAgent as string) ?? '', ip: (v.ip as string) ?? '',
                device: (v.device as string) ?? '', browser: (v.browser as string) ?? '',
              },
              create: {
                sessionId: v.sessionId as string, firstSeen, lastSeen,
                pageCount: (v.pageCount as number) ?? 0, country: (v.country as string) ?? '',
                userAgent: (v.userAgent as string) ?? '', ip: (v.ip as string) ?? '',
                device: (v.device as string) ?? '', browser: (v.browser as string) ?? '',
              },
            })
            r.visitorSessions.imported++
          } catch { r.visitorSessions.skipped++ }
        }
      }

      // Page Views — upsert by id (avoids duplicates on re-import) + device / browser
      if (Array.isArray(body.pageViews)) {
        const pageViews = (body.pageViews as Record<string, unknown>[]).slice(0, 50000)
        for (const p of pageViews) {
          try {
            const createdAt = p.createdAt ? new Date(p.createdAt as string) : new Date()
            if (isNaN(createdAt.getTime())) {
              r.pageViews.skipped++
              continue
            }
            await db.pageView.upsert({
              where: { id: p.id as string },
              update: {
                sessionId: (p.sessionId as string) ?? '', page: (p.page as string) ?? '',
                channelId: (p.channelId as string) || null, referrer: (p.referrer as string) ?? '',
                userAgent: (p.userAgent as string) ?? '', country: (p.country as string) ?? '',
                ip: (p.ip as string) ?? '', device: (p.device as string) ?? '',
                browser: (p.browser as string) ?? '', createdAt,
              },
              create: {
                id: p.id as string, sessionId: (p.sessionId as string) ?? '',
                page: (p.page as string) ?? '', channelId: (p.channelId as string) || null,
                referrer: (p.referrer as string) ?? '', userAgent: (p.userAgent as string) ?? '',
                country: (p.country as string) ?? '', ip: (p.ip as string) ?? '',
                device: (p.device as string) ?? '', browser: (p.browser as string) ?? '',
                createdAt,
              },
            })
            r.pageViews.imported++
          } catch { r.pageViews.skipped++ }
        }
      }

      console.log('[Data Import] Complete:', JSON.stringify(r))
      return NextResponse.json({ success: true, result: r })
    } catch (error) {
      console.error('[Data Import] Fatal error:', error)
      const msg = error instanceof Error ? error.message : 'Import failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  })
}
