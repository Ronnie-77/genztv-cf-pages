import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { ChannelRow } from '@/lib/types'
import { toBool } from '@/lib/types'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/channels/export — Export channels only (admin only)
// Returns a JSON file with all channel data, suitable for importing
// on another GenZTV instance or for backup purposes.
export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const db = await getDb()
      const channels = await db.all<ChannelRow>(
        'SELECT * FROM Channel ORDER BY isFeatured DESC, viewCount DESC, name ASC'
      )

      // Convert SQLite 0/1 booleans to JS booleans so the export format matches
      // what the frontend / import endpoint expects.
      const serialized = channels.map((c) => ({
        ...c,
        isFeatured: toBool(c.isFeatured),
        isActive: toBool(c.isActive),
        autoRefresh: toBool(c.autoRefresh),
      }))

      const exportData = {
        _meta: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          app: 'GenZ TV',
          type: 'channels-only',
          count: serialized.length,
        },
        channels: serialized,
      }

      return NextResponse.json(exportData)
    } catch (error) {
      console.error('[Channels Export] Error:', error)
      return NextResponse.json(
        { error: 'Failed to export channels' },
        { status: 500 }
      )
    }
  })
}
