export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// /api/feedback/[id]
//
// PATCH (admin)  — update status / admin note
// DELETE (admin) — delete a feedback entry
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const b = body as Record<string, unknown>

    const data: Record<string, unknown> = {}
    if (typeof b.status === 'string') {
      const validStatuses = ['new', 'read', 'resolved']
      if (validStatuses.includes(b.status)) data.status = b.status
    }
    if (typeof b.adminNote === 'string') data.adminNote = b.adminNote.slice(0, 2000)

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await db.feedback.update({
      where: { id },
      data,
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('[Feedback] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    await db.feedback.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Feedback] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete feedback' }, { status: 500 })
  }
}
