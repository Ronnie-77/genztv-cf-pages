export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

/**
 * GET /api/health — Health check endpoint
 * 
 * Used by:
 *   - Render.com health checks
 *   - Keep-alive pings (prevents free-tier spin-down)
 *   - Monitoring services
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'GenZ TV',
    timestamp: new Date().toISOString(),
  })
}
