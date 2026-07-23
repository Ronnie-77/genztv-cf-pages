export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshStreamUrl, parseTokenExpiry } from '@/lib/token-refresh'

/**
 * POST /api/channels/[id]/reactive-refresh
 *
 * PUBLIC endpoint that visitors' players call when playback fails (403/404 from
 * upstream CDN — token expired). Triggers a one-off re-extraction of the m3u8
 * from the channel's source page.
 *
 * Rate limiting:
 *   - Per-channel: at most 1 refresh per 30 seconds (in-memory). Prevents a
 *     broken player from hammering the source page if many viewers hit the same
 *     dead stream simultaneously.
 *   - Per-channel: at most 5 refreshes per 10 minutes. If 5 refreshes didn't
 *     fix it, the source page is probably down — stop trying until an admin
 *     intervenes or the proactive cron picks it up.
 *
 * Conditions for refresh (all must be true):
 *   - channel.autoRefresh === true
 *   - channel.sourcePageUrl is set
 *   - rate limit not exceeded
 *
 * Returns:
 *   200 { success, refreshed, newStreamUrl, newExpiresAt }  — refresh succeeded
 *   200 { success, refreshed: false, reason }                — rate limited / skipped
 *   404 { error }                                            — channel not found
 *   502 { error }                                            — refresh attempted but failed
 */
export const maxDuration = 60

// In-memory rate limit state. Cleared on server restart.
// Keyed by channelId.
interface RateLimitState {
  lastRefreshAt: number
  recentAttempts: number[] // timestamps of recent refresh attempts (within 10 min window)
}
const rateLimitMap = new Map<string, RateLimitState>()

const MIN_REFRESH_INTERVAL_MS = 30 * 1000 // 30s between attempts
const RECENT_WINDOW_MS = 10 * 60 * 1000 // 10 min
const MAX_ATTEMPTS_PER_WINDOW = 5

function checkRateLimit(channelId: string): { ok: boolean; reason?: string } {
  const now = Date.now()
  const state = rateLimitMap.get(channelId)

  if (!state) {
    return { ok: true }
  }

  // Throttle: too soon since last attempt?
  if (now - state.lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
    const waitS = Math.ceil((MIN_REFRESH_INTERVAL_MS - (now - state.lastRefreshAt)) / 1000)
    return { ok: false, reason: `Rate limited — retry in ${waitS}s` }
  }

  // Prune old attempts
  const recent = state.recentAttempts.filter((t) => now - t < RECENT_WINDOW_MS)
  if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
    return {
      ok: false,
      reason: `Too many refresh attempts (${recent.length} in 10min). Source page may be down — try again later.`,
    }
  }

  return { ok: true }
}

function recordAttempt(channelId: string) {
  const now = Date.now()
  const state = rateLimitMap.get(channelId) || { lastRefreshAt: 0, recentAttempts: [] }
  state.lastRefreshAt = now
  state.recentAttempts = state.recentAttempts.filter((t) => now - t < RECENT_WINDOW_MS)
  state.recentAttempts.push(now)
  rateLimitMap.set(channelId, state)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const channel = await db.channel.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        streamUrl: true,
        sourcePageUrl: true,
        refreshPattern: true,
        autoRefresh: true,
        tokenExpiresAt: true,
      },
    })

    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    // Must have autoRefresh + source page
    if (!channel.autoRefresh || !channel.sourcePageUrl) {
      return NextResponse.json({
        success: true,
        refreshed: false,
        reason: 'Auto-refresh not enabled for this channel.',
        streamUrl: channel.streamUrl,
      })
    }

    // Rate limit check
    const rl = checkRateLimit(id)
    if (!rl.ok) {
      return NextResponse.json({
        success: true,
        refreshed: false,
        reason: rl.reason,
        streamUrl: channel.streamUrl,
      })
    }

    recordAttempt(id)

    console.log(
      `[reactive-refresh] Player triggered refresh for "${channel.name}" (id=${id})`
    )

    const result = await refreshStreamUrl(channel.sourcePageUrl, {
      pattern: channel.refreshPattern || undefined,
    })

    if (!result.success || !result.newStreamUrl) {
      await db.channel.update({
        where: { id },
        data: { refreshError: result.message },
      })
      return NextResponse.json(
        {
          success: false,
          refreshed: false,
          reason: result.message,
          streamUrl: channel.streamUrl,
        },
        { status: 502 }
      )
    }

    const newUrl = result.newStreamUrl
    if (!/\.m3u8?(\?|$)/i.test(newUrl)) {
      await db.channel.update({
        where: { id },
        data: { refreshError: `Not m3u8: ${newUrl.slice(0, 100)}` },
      })
      return NextResponse.json(
        {
          success: false,
          refreshed: false,
          reason: 'Found URL is not an m3u8.',
          streamUrl: channel.streamUrl,
        },
        { status: 502 }
      )
    }

    // Same URL? Don't write — nothing changed. Tell player to keep trying or give up.
    if (newUrl === channel.streamUrl) {
      return NextResponse.json({
        success: true,
        refreshed: false,
        reason: 'Source page returned the same URL. Token may still be the same.',
        streamUrl: channel.streamUrl,
      })
    }

    const parsed = parseTokenExpiry(newUrl)
    await db.channel.update({
      where: { id },
      data: {
        streamUrl: newUrl,
        tokenExpiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        lastRefreshedAt: new Date(),
        refreshError: '',
      },
    })

    console.log(
      `[reactive-refresh] ✅ "${channel.name}" refreshed reactively (source: ${result.source})`
    )

    return NextResponse.json({
      success: true,
      refreshed: true,
      streamUrl: newUrl,
      newExpiresAt: parsed.expiresAt,
      message: result.message,
    })
  } catch (error) {
    console.error('[reactive-refresh] Error:', error)
    return NextResponse.json(
      { error: 'Reactive refresh failed', detail: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
