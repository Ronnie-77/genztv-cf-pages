export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { refreshStreamUrl, parseTokenExpiry, isTokenExpiringSoon } from '@/lib/token-refresh'

/**
 * POST /api/channels/refresh-expired
 *
 * Batch refresh all channels whose tokens are expiring soon (within 1 hour) OR
 * have already expired AND have autoRefresh=true AND have a sourcePageUrl.
 *
 * This endpoint is called by:
 *   1. The proactive cron job (every 30 minutes via the cron tool).
 *   2. The admin "Refresh All Expired" button.
 *
 * Body (optional):
 *   { forceAll?: boolean }  — if true, refresh ALL autoRefresh channels
 *                             regardless of expiry status. Admin-only override.
 *
 * Returns a summary: how many were refreshed, how many failed, per-channel details.
 *
 * Auth: admin only when called manually. The cron tool calls this with a shared
 * secret in the X-Cron-Secret header (configured in .env) to bypass admin auth.
 */
export const maxDuration = 300 // 5 min — batch refresh can take a while

const CRON_SECRET = process.env.CRON_REFRESH_SECRET || ''

export async function POST(req: NextRequest) {
  // Auth: either admin OR valid cron secret
  const cronSecret = req.headers.get('x-cron-secret')
  const isCron = CRON_SECRET && cronSecret === CRON_SECRET

  if (!isCron) {
    const authCheck = await requireAdminAuth(req, async () => NextResponse.json({ ok: true }))
    if (authCheck instanceof NextResponse && authCheck.status === 401) {
      return authCheck
    }
  }

  try {
    const body = await req.json().catch(() => ({}))
    const forceAll = Boolean(body?.forceAll)

    // Find candidate channels: autoRefresh=true + has sourcePageUrl
    const candidates = await db.channel.findMany({
      where: {
        autoRefresh: true,
        sourcePageUrl: { not: '' },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sourcePageUrl: true,
        refreshPattern: true,
        streamUrl: true,
        tokenExpiresAt: true,
      },
    })

    // Filter to "expiring soon" unless forceAll
    const toRefresh = forceAll
      ? candidates
      : candidates.filter((c) => {
          // Refresh if: no expiry known (might be expired), OR expiring soon, OR already expired
          if (!c.tokenExpiresAt) return true // unknown — be safe, try
          return isTokenExpiringSoon(c.tokenExpiresAt)
        })

    console.log(
      `[refresh-expired] ${toRefresh.length}/${candidates.length} channels need refresh (forceAll=${forceAll})`
    )

    const results: Array<{
      id: string
      name: string
      success: boolean
      message: string
      newExpiresAt?: number | null
    }> = []

    let successCount = 0
    let failedCount = 0

    // Process sequentially — parallel fetching could hammer source pages.
    for (const ch of toRefresh) {
      try {
        const result = await refreshStreamUrl(ch.sourcePageUrl, {
          pattern: ch.refreshPattern || undefined,
        })

        if (result.success && result.newStreamUrl) {
          const newUrl = result.newStreamUrl
          if (/\.m3u8?(\?|$)/i.test(newUrl)) {
            const parsed = parseTokenExpiry(newUrl)
            await db.channel.update({
              where: { id: ch.id },
              data: {
                streamUrl: newUrl,
                tokenExpiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
                lastRefreshedAt: new Date(),
                refreshError: '',
              },
            })
            successCount++
            results.push({
              id: ch.id,
              name: ch.name,
              success: true,
              message: result.message,
              newExpiresAt: parsed.expiresAt,
            })
            console.log(`[refresh-expired] ✅ ${ch.name}: refreshed (${result.source})`)
          } else {
            await db.channel.update({
              where: { id: ch.id },
              data: { refreshError: `Not m3u8: ${newUrl.slice(0, 100)}` },
            })
            failedCount++
            results.push({
              id: ch.id,
              name: ch.name,
              success: false,
              message: `Found URL is not an m3u8`,
            })
          }
        } else {
          await db.channel.update({
            where: { id: ch.id },
            data: { refreshError: result.message },
          })
          failedCount++
          results.push({
            id: ch.id,
            name: ch.name,
            success: false,
            message: result.message,
          })
          console.warn(`[refresh-expired] ❌ ${ch.name}: ${result.message}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        await db.channel.update({
          where: { id: ch.id },
          data: { refreshError: msg },
        })
        failedCount++
        results.push({ id: ch.id, name: ch.name, success: false, message: msg })
      }
    }

    return NextResponse.json({
      success: true,
      total: toRefresh.length,
      refreshed: successCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('[refresh-expired] Error:', error)
    return NextResponse.json(
      { error: 'Failed to refresh expired channels', detail: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/channels/refresh-expired
 *
 * Returns a list of channels that need refresh (for the admin UI status panel).
 * Does NOT perform a refresh — just shows what would be refreshed.
 */
export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const channels = await db.channel.findMany({
        where: {
          autoRefresh: true,
          sourcePageUrl: { not: '' },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          streamType: true,
          sourcePageUrl: true,
          tokenExpiresAt: true,
          lastRefreshedAt: true,
          refreshError: true,
        },
        orderBy: { tokenExpiresAt: 'asc' },
      })

      const annotated = channels.map((c) => ({
        ...c,
        needsRefresh: !c.tokenExpiresAt || isTokenExpiringSoon(c.tokenExpiresAt),
        isExpired: c.tokenExpiresAt ? c.tokenExpiresAt.getTime() < Date.now() : false,
      }))

      return NextResponse.json({
        total: annotated.length,
        needingRefresh: annotated.filter((c) => c.needsRefresh).length,
        expired: annotated.filter((c) => c.isExpired).length,
        channels: annotated,
      })
    } catch (error) {
      console.error('[refresh-expired GET] Error:', error)
      return NextResponse.json({ error: 'Failed to fetch refresh status' }, { status: 500 })
    }
  })
}
