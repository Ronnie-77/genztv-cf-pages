import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { CategoryRow } from '@/lib/types'

// GET /api/categories/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await getDb()
    const { id } = await params
    const category = await db.first<CategoryRow>(
      'SELECT * FROM Category WHERE id = ?',
      id
    )
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }
    return NextResponse.json(category)
  } catch (error) {
    console.error('Error fetching category:', error)
    return NextResponse.json({ error: 'Failed to fetch category' }, { status: 500 })
  }
}

// PUT /api/categories/[id] (admin only)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const { id } = await params
      const body = await req.json()
      const now = new Date().toISOString()

      // Build SET clause dynamically based on which fields are present
      const setClauses: string[] = ['updatedAt = ?']
      const sqlParams: unknown[] = [now]

      if (body.name !== undefined) {
        setClauses.push('name = ?')
        sqlParams.push(body.name)
      }
      if (body.icon !== undefined) {
        setClauses.push('icon = ?')
        sqlParams.push(body.icon)
      }
      if (body.color !== undefined) {
        setClauses.push('color = ?')
        sqlParams.push(body.color)
      }
      if (body.order !== undefined) {
        setClauses.push('"order" = ?')
        sqlParams.push(body.order)
      }
      if (body.channelCount !== undefined) {
        setClauses.push('channelCount = ?')
        sqlParams.push(body.channelCount)
      }

      sqlParams.push(id)
      const sql = `UPDATE Category SET ${setClauses.join(', ')} WHERE id = ?`
      await db.run(sql, ...sqlParams)

      // Invalidate categories cache
      apiCache.invalidateCategories()

      const category = await db.first<CategoryRow>(
        'SELECT * FROM Category WHERE id = ?',
        id
      )
      return NextResponse.json(category)
    } catch (error) {
      console.error('Error updating category:', error)
      return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
    }
  })
}

// DELETE /api/categories/[id] (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAdminAuth(_req, async () => {
    try {
      const db = await getDb()
      const { id } = await params
      await db.run('DELETE FROM Category WHERE id = ?', id)

      // Invalidate categories cache
      apiCache.invalidateCategories()

      return NextResponse.json({ success: true })
    } catch (error) {
      console.error('Error deleting category:', error)
      return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
    }
  })
}
