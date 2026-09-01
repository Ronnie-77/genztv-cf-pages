import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import type {
  ChannelRow,
  MatchRow,
  MatchStreamRow,
  CategoryRow,
  AppSettingRow,
  FeedbackRow,
  PushSubscriptionRow,
  NoticeRow,
  AppNotificationRow,
  PageViewRow,
  DailyStatRow,
  VisitorSessionRow,
} from '@/lib/types'
import { toBool } from '@/lib/types'

// GET /api/data — export every table (admin only)
//
// Returns a JSON object keyed by table name. For backward compatibility with
// the existing import endpoint, `matches` is also embedded with a nested
// `streams` array (the same shape the previous Prisma-based export produced).
export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()

      const [
        channels,
        matches,
        matchStreams,
        categories,
        settings,
        feedback,
        pushSubscriptions,
        notices,
        appNotifications,
        pageViews,
        dailyStats,
        visitorSessions,
      ] = await Promise.all([
        db.all<ChannelRow>('SELECT * FROM Channel'),
        db.all<MatchRow>('SELECT * FROM Match'),
        db.all<MatchStreamRow>('SELECT * FROM MatchStream'),
        db.all<CategoryRow>('SELECT * FROM Category'),
        db.first<AppSettingRow>('SELECT * FROM AppSetting WHERE id = ?', 'app'),
        db.all<FeedbackRow>('SELECT * FROM Feedback'),
        db.all<PushSubscriptionRow>('SELECT * FROM PushSubscription'),
        db.all<NoticeRow>('SELECT * FROM Notice'),
        db.all<AppNotificationRow>('SELECT * FROM AppNotification'),
        // Export ALL page views — a backup must be complete so it can be fully
        // restored when changing hosting. (The 100MB import cap protects
        // against abuse; SQLite + JSON easily handles tens of thousands of rows.)
        db.all<PageViewRow>('SELECT * FROM PageView'),
        db.all<DailyStatRow>('SELECT * FROM DailyStat'),
        db.all<VisitorSessionRow>('SELECT * FROM VisitorSession'),
      ])

      // Group streams by matchId so we can embed them under each match
      // (preserves the previous Prisma `include: { streams: true }` shape).
      const streamsByMatch = new Map<string, MatchStreamRow[]>()
      for (const s of matchStreams) {
        const list = streamsByMatch.get(s.matchId) ?? []
        list.push(s)
        streamsByMatch.set(s.matchId, list)
      }
      const matchesWithStreams = matches.map((m) => ({
        ...m,
        isFeatured: toBool(m.isFeatured),
        streams: streamsByMatch.get(m.id) ?? [],
      }))

      // Convert boolean columns on channels for downstream consumers
      const channelsJson = channels.map((c) => ({
        ...c,
        isFeatured: toBool(c.isFeatured),
        isActive: toBool(c.isActive),
        autoRefresh: toBool(c.autoRefresh),
      }))

      return NextResponse.json({
        _meta: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          app: 'GenZ TV',
          counts: {
            channels: channels.length,
            matches: matches.length,
            matchStreams: matchStreams.length,
            categories: categories.length,
            feedback: feedback.length,
            pushSubscriptions: pushSubscriptions.length,
            notices: notices.length,
            appNotifications: appNotifications.length,
            dailyStats: dailyStats.length,
            visitorSessions: visitorSessions.length,
            pageViews: pageViews.length,
          },
        },
        // Backward-compatible keys (preserved for existing import logic &
        // any external scripts that consume this backup format)
        settings,
        channels: channelsJson,
        matches: matchesWithStreams,
        categories,
        dailyStats,
        visitorSessions,
        pageViews,
        // Additional table-keyed data for completeness
        matchStreams,
        feedback,
        pushSubscriptions,
        notices,
        appNotifications,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Export failed' },
        { status: 500 }
      )
    }
  })
}
