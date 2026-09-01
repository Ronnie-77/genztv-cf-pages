import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { DailyStatRow, PageViewRow, ChannelRow } from '@/lib/types'

// GET /api/analytics/dashboard — admin analytics dashboard data
//
// Data logic:
//   - Today: Live detailed metrics from PageView + VisitorSession + DailyStat
//     (resets at midnight — PageView/VisitorSession are deleted, DailyStat keeps counts)
//   - Last 7/30 Days: Views + Unique Visitors from DailyStat only
//   - Calendar: All DailyStat rows for the selected month
//   - Top Channels/Countries/Devices: From DailyStat JSON counts (not raw rows)
export async function GET(request: NextRequest) {
  return requireAdminAuth(request, async () => {
    try {
      const db = await getDb()

      // Check cache first (10s TTL)
      const cached = apiCache.getDashboard()
      if (cached) {
        return NextResponse.json(cached)
      }

      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
      const fourteenDaysAgo = new Date(now.getTime() - 13 * 86400000).toISOString().slice(0, 10)
      const activeSince = new Date(now.getTime() - 60 * 1000).toISOString()

      // ── Calendar month param ──
      const { searchParams } = new URL(request.url)
      const calendarMonth = searchParams.get('month') // "2025-06" format
      const calendarYear = calendarMonth ? parseInt(calendarMonth.split('-')[0]) : now.getFullYear()
      const calendarMon = calendarMonth ? parseInt(calendarMonth.split('-')[1]) : now.getMonth() + 1

      // Fetch today's stat
      const todayStat = await db.first<DailyStatRow>(
        'SELECT * FROM DailyStat WHERE date = ?',
        todayStr
      )

      // Fetch yesterday's stat
      const yesterdayStat = await db.first<DailyStatRow>(
        'SELECT * FROM DailyStat WHERE date = ?',
        yesterdayStr
      )

      // Fetch daily chart data (14 days)
      const dailyStats = await db.all<DailyStatRow>(
        'SELECT * FROM DailyStat WHERE date >= ? ORDER BY date ASC',
        fourteenDaysAgo
      )

      // Aggregate 7-day stats
      const last7DaysStats = dailyStats.filter(s => s.date >= sevenDaysAgo)
      const last7Days = {
        views: last7DaysStats.reduce((sum, s) => sum + s.totalViews, 0),
        uniqueVisitors: last7DaysStats.reduce((sum, s) => sum + s.uniqueVisitors, 0),
        days: last7DaysStats.map(s => ({
          date: s.date,
          views: s.totalViews,
          uniqueVisitors: s.uniqueVisitors,
        })),
      }

      // 30-day stats — fetch separately only if needed
      const last30DaysStats = fourteenDaysAgo <= thirtyDaysAgo
        ? await db.all<DailyStatRow>(
            'SELECT * FROM DailyStat WHERE date >= ? ORDER BY date ASC',
            thirtyDaysAgo
          )
        : last7DaysStats
      const last30Days = {
        views: last30DaysStats.reduce((sum, s) => sum + s.totalViews, 0),
        uniqueVisitors: last30DaysStats.reduce((sum, s) => sum + s.uniqueVisitors, 0),
        days: last30DaysStats.map(s => ({
          date: s.date,
          views: s.totalViews,
          uniqueVisitors: s.uniqueVisitors,
        })),
      }

      // Total all time — fetch all DailyStat rows
      const allStats = await db.all<DailyStatRow>('SELECT * FROM DailyStat ORDER BY date ASC')
      const totalAllTime = {
        views: allStats.reduce((sum, s) => sum + s.totalViews, 0),
        uniqueVisitors: allStats.reduce((sum, s) => sum + s.uniqueVisitors, 0),
      }

      // Online now (real: sessions active in last 60 seconds)
      const onlineRow = await db.first<{ c: number }>(
        'SELECT COUNT(*) as c FROM VisitorSession WHERE lastSeen >= ?',
        activeSince
      )
      const onlineNow = onlineRow?.c ?? 0

      // Recent page views (only exists for today — yesterday's were deleted at midnight)
      let recentPageViews: PageViewRow[] = []
      try {
        recentPageViews = await db.all<PageViewRow>(
          'SELECT * FROM PageView ORDER BY createdAt DESC LIMIT 20'
        )
      } catch (e) {
        console.error('[Analytics] recentPageViews fetch failed (degraded):', e)
        recentPageViews = []
      }

      // ── Top channels/countries/devices from DailyStat JSON counts ──
      // These are aggregated counts, not raw PageView rows
      const channelCounts: Record<string, number> = {}
      const countryCounts: Record<string, number> = {}
      const deviceCounts: Record<string, number> = {}
      const browserCounts: Record<string, number> = {}

      for (const stat of allStats) {
        try {
          const ch: Record<string, number> = JSON.parse(stat.topChannels ?? '{}')
          for (const [id, count] of Object.entries(ch)) {
            channelCounts[id] = (channelCounts[id] || 0) + count
          }
        } catch { /* skip */ }
        try {
          const co: Record<string, number> = JSON.parse(stat.topCountries ?? '{}')
          for (const [c, count] of Object.entries(co)) {
            countryCounts[c] = (countryCounts[c] || 0) + count
          }
        } catch { /* skip */ }
        try {
          const dev: Record<string, number> = JSON.parse(stat.topDevices ?? '{}')
          for (const [d, count] of Object.entries(dev)) {
            deviceCounts[d] = (deviceCounts[d] || 0) + count
          }
        } catch { /* skip */ }
        try {
          const br: Record<string, number> = JSON.parse(stat.topBrowsers ?? '{}')
          for (const [b, count] of Object.entries(br)) {
            browserCounts[b] = (browserCounts[b] || 0) + count
          }
        } catch { /* skip */ }
      }

      // Resolve channel names
      const topChannelIds = Object.entries(channelCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([id]) => id)

      let channelMap = new Map<string, string>()
      if (topChannelIds.length > 0) {
        const placeholders = topChannelIds.map(() => '?').join(', ')
        const channels = await db.all<Pick<ChannelRow, 'id' | 'name'>>(
          `SELECT id, name FROM Channel WHERE id IN (${placeholders})`,
          ...topChannelIds
        )
        channelMap = new Map(channels.map(c => [c.id, c.name]))
      }

      const topChannelsAllTime = Object.entries(channelCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([id, views]) => ({
          id,
          name: channelMap.get(id) || 'Unknown',
          views,
        }))

      const topCountriesAllTime = Object.entries(countryCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([country, count]) => ({ country, count }))

      const topDevicesAllTime = Object.entries(deviceCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([device, count]) => ({ device, count }))

      const topBrowsersAllTime = Object.entries(browserCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([browser, count]) => ({ browser, count }))

      // ── Calendar data ──
      // Get all DailyStat rows for the selected month
      const monthStart = `${calendarYear}-${String(calendarMon).padStart(2, '0')}-01`
      const nextMon = calendarMon === 12 ? 1 : calendarMon + 1
      const nextYear = calendarMon === 12 ? calendarYear + 1 : calendarYear
      const monthEnd = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`

      const calendarStats = await db.all<DailyStatRow>(
        'SELECT * FROM DailyStat WHERE date >= ? AND date < ? ORDER BY date ASC',
        monthStart,
        monthEnd
      )

      const calendarDays = calendarStats.map(s => ({
        date: s.date,
        views: s.totalViews,
        uniqueVisitors: s.uniqueVisitors,
        peakVisitors: s.peakVisitors || 0,
      }))

      // Daily chart data
      const dailyChart = dailyStats.map((s) => ({
        date: s.date,
        views: s.totalViews,
        uniqueVisitors: s.uniqueVisitors,
        peakVisitors: s.peakVisitors || 0,
      }))

      const formatStat = (stat: DailyStatRow | null) => ({
        views: stat?.totalViews || 0,
        uniqueVisitors: stat?.uniqueVisitors || 0,
        peakVisitors: stat?.peakVisitors || 0,
        topPages: JSON.parse(stat?.topPages ?? '{}'),
        topChannels: JSON.parse(stat?.topChannels ?? '{}'),
        topCountries: JSON.parse(stat?.topCountries ?? '{}'),
        topDevices: JSON.parse(stat?.topDevices ?? '{}'),
        topBrowsers: JSON.parse(stat?.topBrowsers ?? '{}'),
      })

      const responseData = {
        today: formatStat(todayStat),
        yesterday: formatStat(yesterdayStat),
        last7Days,
        last30Days,
        totalAllTime,
        dailyChart,
        topChannelsAllTime,
        topCountriesAllTime,
        topDevicesAllTime,
        topBrowsersAllTime,
        onlineNow,
        recentPageViews: recentPageViews.map((pv) => ({
          page: pv.page,
          channelId: pv.channelId,
          // SQLite stores createdAt as ISO string already; normalise to
          // ensure the frontend always sees a valid Date-parseable string.
          createdAt: pv.createdAt ? new Date(pv.createdAt).toISOString() : '',
          country: pv.country || '',
          device: pv.device || '',
          browser: pv.browser || '',
        })),
        calendar: {
          year: calendarYear,
          month: calendarMon,
          days: calendarDays,
        },
      }

      // Cache the dashboard data
      apiCache.setDashboard(responseData as unknown as Record<string, unknown>)

      return NextResponse.json(responseData)
    } catch (error) {
      console.error('[Analytics] Dashboard error:', error)
      const message = error instanceof Error ? error.message : 'Failed to fetch analytics'
      return NextResponse.json(
        { error: 'Failed to fetch analytics', detail: message },
        { status: 500 }
      )
    }
  })
}
