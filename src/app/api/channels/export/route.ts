export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/channels/export — Export channels only (admin only)
// Returns a JSON file with all channel data, suitable for importing
// on another GenZTV instance or for backup purposes.
export async function GET(req: NextRequest) {
  return requireAdminAuth(req, async () => {
    try {
      const channels = await db.channel.findMany({
        orderBy: [
          { isFeatured: 'desc' },
          { viewCount: 'desc' },
          { name: 'asc' },
        ],
      })

      const exportData = {
        _meta: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          app: 'GenZ TV',
          type: 'channels-only',
          count: channels.length,
        },
        channels,
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
