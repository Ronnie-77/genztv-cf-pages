import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { ChannelRow } from '@/lib/types'
import { toBool } from '@/lib/types'
import { requireAdminAuth } from '@/lib/auth'
import { refreshStreamUrl, parseTokenExpiry } from '@/lib/token-refresh'

type RefreshStatusRow = Pick<
  ChannelRow,
  | 'id'
  | 'name'
  | 'streamType'
  | 'streamUrl'
  | 'sourcePageUrl'
  | 'tokenExpiresAt'
  | 'lastRefreshedAt'
  | 'autoRefresh'
  | 'refreshError'
>

const REFRESH_STATUS_COLUMNS =
  'id, name, streamType, streamUrl, sourcePageUrl, tokenExpiresAt, lastRefreshedAt, autoRefresh, refreshError'

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
      const db = await getDb()
      const { id } = await params
      const body = await req.json().catch(() => ({}))
      const force = Boolean(body?.force)
      const now = new Date().toISOString()

      const channel = await db.first<ChannelRow>('SELECT * FROM Channel WHERE id = ?', id)
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
      if (!toBool(channel.autoRefresh) && !force) {
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
        await db.run(
          'UPDATE Channel SET refreshError = ?, updatedAt = ? WHERE id = ?',
          result.message,
          now,
          id
        )
        return NextResponse.json(
          { error: 'Refresh failed', detail: result.message },
          { status: 502 }
        )
      }

      // Verify the new URL is at least a plausible m3u8 URL.
      const newUrl = result.newStreamUrl
      if (!/\.m3u8?(\?|$)/i.test(newUrl)) {
        await db.run(
          'UPDATE Channel SET refreshError = ?, updatedAt = ? WHERE id = ?',
          `Found URL is not an m3u8: ${newUrl.slice(0, 100)}`,
          now,
          id
        )
        return NextResponse.json(
          { error: 'Refreshed URL is not an m3u8', detail: newUrl.slice(0, 200) },
          { status: 502 }
        )
      }

      // Parse new expiry (if any) and persist.
      const parsed = parseTokenExpiry(newUrl)
      const tokenExpiresAt = parsed.expiresAt
        ? new Date(parsed.expiresAt).toISOString()
        : null
      await db.run(
        'UPDATE Channel SET streamUrl = ?, tokenExpiresAt = ?, lastRefreshedAt = ?, refreshError = ?, updatedAt = ? WHERE id = ?',
        newUrl,
        tokenExpiresAt,
        now,
        '',
        now,
        id
      )

      const updated = await db.first<ChannelRow>('SELECT * FROM Channel WHERE id = ?', id)
      const updatedResult = updated
        ? {
            ...updated,
            isFeatured: toBool(updated.isFeatured),
            isActive: toBool(updated.isActive),
            autoRefresh: toBool(updated.autoRefresh),
          }
        : null

      console.log(
        `[refresh] ✅ "${channel.name}" refreshed. New expiry: ${
          parsed.expiresAt ? new Date(parsed.expiresAt).toISOString() : 'unknown'
        } (source: ${result.source})`
      )

      return NextResponse.json({
        success: true,
        channel: updatedResult,
        message: result.message,
        source: result.source,
        newExpiresAt: parsed.expiresAt,
      })
    } catch (error) {
      console.error('[refresh] Error:', error)
      return NextResponse.json(
        {
          error: 'Failed to refresh channel',
          detail: error instanceof Error ? error.message : 'Unknown',
        },
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
    const db = await getDb()
    const { id } = await params
    const channel = await db.first<RefreshStatusRow>(
      `SELECT ${REFRESH_STATUS_COLUMNS} FROM Channel WHERE id = ?`,
      id
    )
    if (!channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    return NextResponse.json({
      ...channel,
      autoRefresh: toBool(channel.autoRefresh),
    })
  } catch (error) {
    console.error('[refresh-status] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch refresh status' }, { status: 500 })
  }
}
