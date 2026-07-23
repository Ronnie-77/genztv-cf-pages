export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { refreshStreamUrl, parseTokenExpiry } from '@/lib/token-refresh'

/**
 * POST /api/channels/[id]/refresh
 *
 * Re-extracts a fresh m3u8 URL from the channel's source page and updates the
 * channel's streamUrl + tokenExpiresAt + lastRefreshedAt.
 *
 * Body (optional):
 *   { force?: boolean }  — if true, refresh even if autoRefresh is off or token
 *                          is not yet expiring.
 *
 * Returns:
 *   200 { success, channel, message }      — refresh succeeded
 *   400 { error }                          — no source page configured
 *   404 { error }                          — channel not found
 *   502 { error, detail }                  — refresh failed (no m3u8 found)
 *
 * Auth: admin only. (Public visitors can't trigger refreshes directly — that
 * would let anonymous users hammer source pages. The player-side reactive
 * refresh uses a separate public endpoint that's rate-limited.)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
    try {
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const force = Boolean(body?.force)

      const channel = await db.channel.findUnique({ where: { id } })
      if (!channel) {
        return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
      }

      if (!channel.sourcePageUrl) {
        return NextResponse.json(
          {
            error:
              'No source page URL configured. Edit the channel and set "Source Page URL" to enable auto-refresh.',
          },
          { status: 400 }
        )
      }

      // If autoRefresh is off and not forced, refuse — admin must opt in.
      if (!channel.autoRefresh && !force) {
        return NextResponse.json(
          {
            error:
              'Auto-refresh is off for this channel. Enable "Auto Refresh" or pass force=true.',
          },
          { status: 400 }
        )
      }

      console.log(
        `[refresh] Re-extracting m3u8 for "${channel.name}" from ${channel.sourcePageUrl}`
      )

      const result = await refreshStreamUrl(channel.sourcePageUrl, {
        pattern: channel.refreshPattern || undefined,
        urlFilter: undefined,
      })

      if (!result.success || !result.newStreamUrl) {
        // Record the failure on the channel so the admin sees it.
        await db.channel.update({
          where: { id },
          data: { refreshError: result.message },
        })
        return NextResponse.json(
          { error: 'Refresh failed', detail: result.message },
          { status: 502 }
        )
      }

      // Verify the new URL is at least a plausible m3u8 URL.
      const newUrl = result.newStreamUrl
      if (!/\.m3u8?(\?|$)/i.test(newUrl)) {
        await db.channel.update({
          where: { id },
          data: { refreshError: `Found URL is not an m3u8: ${newUrl.slice(0, 100)}` },
        })
        return NextResponse.json(
          { error: 'Refreshed URL is not an m3u8', detail: newUrl.slice(0, 200) },
          { status: 502 }
        )
      }

      // Parse new expiry (if any) and persist.
      const parsed = parseTokenExpiry(newUrl)
      const updated = await db.channel.update({
        where: { id },
        data: {
          streamUrl: newUrl,
          tokenExpiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
          lastRefreshedAt: new Date(),
          refreshError: '',
        },
      })

      console.log(
        `[refresh] ✅ "${channel.name}" refreshed. New expiry: ${
          parsed.expiresAt ? new Date(parsed.expiresAt).toISOString() : 'unknown'
        } (source: ${result.source})`
      )

      return NextResponse.json({
        success: true,
        channel: updated,
        message: result.message,
        source: result.source,
        newExpiresAt: parsed.expiresAt,
      })
    } catch (error) {
      console.error('[refresh] Error:', error)
      return NextResponse.json(
        { error: 'Failed to refresh channel', detail: error instanceof Error ? error.message : 'Unknown' },
        { status: 500 }
      )
    }
  })
}

/**
 * GET /api/channels/[id]/refresh
 *
 * Returns the current refresh status of a channel (expiry, last refresh, error).
 * Public — visitors' players call this to check whether they should request a
 * reactive refresh.
 */
export async function GET(
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
        streamType: true,
        streamUrl: true,
        sourcePageUrl: true,
        tokenExpiresAt: true,
        lastRefreshedAt: true,
        autoRefresh: true,
        refreshError: true,
      },
    })
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    return NextResponse.json(channel)
  } catch (error) {
    console.error('[refresh-status] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch refresh status' }, { status: 500 })
  }
}
