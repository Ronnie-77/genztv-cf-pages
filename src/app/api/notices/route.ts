export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { sendPushToAll } from '@/lib/push'

// GET /api/notices — public. Returns only ACTIVE notices that should be shown
// to visitors. Used by the website-entry popup component to find any pending
// popup notice to display.
//
// Query params:
//   ?scope=popup  → return only active notices of type "popup" or "both"
//                   (the popup-display flow). Default if no scope given.
//   ?scope=all    → return all active notices (popup + push + both). Rarely used.
export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get('scope') || 'popup'
    const where = { isActive: true } as const

    let notices
    if (scope === 'popup') {
      // Only notices that should show as a popup on site entry.
      notices = await db.notice.findMany({
        where: { ...where, type: { in: ['popup', 'both'] } },
        orderBy: { updatedAt: 'desc' },
      })
    } else {
      notices = await db.notice.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      })
    }

    return NextResponse.json({ notices })
  } catch (error) {
    console.error('[Notices] Error fetching:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notices' },
      { status: 500 },
    )
  }
}

// POST /api/notices — admin only. Creates a new notice.
//
// Body: { type, title, body, url?, imageUrl?, isActive? }
//
// If type is "push" or "both", we IMMEDIATELY fire a push notification to all
// subscribers and mark pushSent=true. If type is "popup", no push is sent.
//
// Returns the created notice + the push send result (if applicable).
export async function POST(req: NextRequest) {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { type, title, body: noticeBody, url, imageUrl, isActive } = body as {
      type?: string
      title?: string
      body?: string
      url?: string
      imageUrl?: string
      isActive?: boolean
    }

    // Validation
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    const validTypes = ['popup', 'push', 'both']
    const finalType = validTypes.includes(type) ? type! : 'popup'
    const finalBody = typeof noticeBody === 'string' ? noticeBody : null
    const finalUrl = typeof url === 'string' ? url : ''
    const finalImage = typeof imageUrl === 'string' ? imageUrl : ''
    const finalActive = isActive !== false // default true unless explicitly false

    // Create the notice row first.
    const notice = await db.notice.create({
      data: {
        type: finalType,
        title: title.trim(),
        body: finalBody,
        url: finalUrl,
        imageUrl: finalImage,
        isActive: finalActive,
        pushSent: false,
      },
    })

    // If the notice should fire a push notification, do so now.
    let pushResult: { sent: number; failed: number; removed?: number } | null = null
    if (finalActive && (finalType === 'push' || finalType === 'both')) {
      try {
        pushResult = await sendPushToAll({
          title: notice.title,
          body: notice.body ?? 'New update from GenZ TV',
          icon: notice.imageUrl || '/logo.svg',
          image: notice.imageUrl || undefined,
          url: notice.url || '/',
          tag: `notice-${notice.id}`,
        })
        // Mark as sent so re-saving doesn't re-fire.
        await db.notice.update({
          where: { id: notice.id },
          data: { pushSent: true },
        })
        notice.pushSent = true
      } catch (err) {
        console.error('[Notices] Push send failed:', err)
        // Don't fail the whole request — the notice is still created; admin
        // can retry the push via the PATCH/POST endpoint below.
      }
    }

    return NextResponse.json({ notice, pushResult }, { status: 201 })
  } catch (error) {
    console.error('[Notices] Error creating:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to create notice', detail: message },
      { status: 500 },
    )
  }
}
