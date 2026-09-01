import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import type { FeedbackRow } from '@/lib/types'

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

    const fields: string[] = []
    const sqlParams: unknown[] = []

    if (typeof b.status === 'string') {
      const validStatuses = ['new', 'read', 'resolved']
      if (validStatuses.includes(b.status)) {
        fields.push('status = ?')
        sqlParams.push(b.status)
      }
    }
    if (typeof b.adminNote === 'string') {
      fields.push('adminNote = ?')
      sqlParams.push(b.adminNote.slice(0, 2000))
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    fields.push('updatedAt = ?')
    sqlParams.push(new Date().toISOString())
    sqlParams.push(id)

    const db = await getDb()
    await db.run(
      `UPDATE Feedback SET ${fields.join(', ')} WHERE id = ?`,
      ...sqlParams
    )

    const updated = await db.first<FeedbackRow>(
      'SELECT * FROM Feedback WHERE id = ?',
      id
    )

    if (!updated) {
      return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
    }

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
    const db = await getDb()
    await db.run('DELETE FROM Feedback WHERE id = ?', id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Feedback] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete feedback' }, { status: 500 })
  }
}
