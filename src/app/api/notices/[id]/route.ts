export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'

// PATCH /api/notices/[id] — admin only. Updates a notice.
//
// Body (any subset): { type?, title?, body?, url?, imageUrl?, isActive?,
//                      resendPush? }
//
// If `resendPush: true` is passed (and the notice is active and type is
// "push"/"both"), we fire a fresh push notification regardless of pushSent
// state. Otherwise, if the admin changes a "popup" notice to "push"/"both"
// for the first time, we also fire the push automatically.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await db.notice.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Notice not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
      type,
      title,
      body: noticeBody,
      url,
      imageUrl,
      isActive,
      resendPush,
    } = body as {
      type?: string
      title?: string
      body?: string
      url?: string
      imageUrl?: string
      isActive?: boolean
      resendPush?: boolean
    }

    const validTypes = ['popup', 'push', 'both']
    const finalType = type && validTypes.includes(type) ? type : existing.type
    const finalTitle = typeof title === 'string' ? title.trim() : existing.title
    const finalBody = typeof noticeBody === 'string' ? noticeBody : (existing.body ?? null)
    const finalUrl = typeof url === 'string' ? url : existing.url
    const finalImage = typeof imageUrl === 'string' ? imageUrl : existing.imageUrl
    const finalActive = typeof isActive === 'boolean' ? isActive : existing.isActive

    const updated = await db.notice.update({
      where: { id },
      data: {
        type: finalType,
        title: finalTitle,
        body: finalBody,
        url: finalUrl,
        imageUrl: finalImage,
        isActive: finalActive,
      },
    })

    // Determine whether to fire a push notification.
    //   - Explicit resendPush → yes.
    //   - Type changed to push/both AND push hasn't been sent yet → yes.
    //   - Otherwise → no (don't double-push on minor text edits).
    const shouldFirePush =
      finalActive &&
      (finalType === 'push' || finalType === 'both') &&
      (resendPush === true ||
        (!existing.pushSent && existing.type !== finalType))

    let pushResult: { sent: number; failed: number; removed?: number } | null = null
    if (shouldFirePush) {
      try {
        pushResult = await sendPushToAll({
          title: updated.title,
          body: updated.body ?? 'New update from GenZ TV',
          icon: updated.imageUrl || '/logo.svg',
          image: updated.imageUrl || undefined,
          url: updated.url || '/',
          tag: `notice-${updated.id}`,
        })
        await db.notice.update({
          where: { id: updated.id },
          data: { pushSent: true },
        })
        updated.pushSent = true
      } catch (err) {
        console.error('[Notices] Push send failed on PATCH:', err)
      }
    }

    return NextResponse.json({ notice: updated, pushResult })
  } catch (error) {
    console.error('[Notices] Error updating:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update notice', detail: message },
      { status: 500 },
    )
  }
}

// DELETE /api/notices/[id] — admin only. Permanently removes a notice.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await db.notice.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Notice not found' }, { status: 404 })
    }

    await db.notice.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notices] Error deleting:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to delete notice', detail: message },
      { status: 500 },
    )
  }
}
