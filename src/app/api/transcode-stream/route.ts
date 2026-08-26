import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/transcode-stream?hash=<hash>&seg=<seg_name>(optional)
 *
 * Proxy to the transcode mini-service on port 3032.
 *
 * Two modes:
 *   1. No `seg` param → serves the HLS playlist (playlist.m3u8).
 *      Segment URLs in the playlist are rewritten to go through this same
 *      route (with seg=...) so they work in both environments.
 *   2. seg=seg_0000.ts → serves a raw segment file from the mini-service.
 */

const TRANSCODE_SERVICE = 'http://127.0.0.1:3032'

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get('hash')
  if (!hash) {
    return NextResponse.json({ error: 'Missing hash parameter' }, { status: 400 })
  }

  const seg = req.nextUrl.searchParams.get('seg')

  try {
    if (seg) {
      // ── Serve a raw segment ──
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const upstream = await fetch(
        `${TRANSCODE_SERVICE}/stream/${hash}/${seg}`,
        { signal: controller.signal }
      )
      clearTimeout(timeout)

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Segment fetch failed: ${upstream.status}` },
          { status: upstream.status }
        )
      }
      const data = await upstream.arrayBuffer()
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } else {
      // ── Serve the playlist (with segment URLs rewritten) ──
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const upstream = await fetch(
        `${TRANSCODE_SERVICE}/stream/${hash}/playlist.m3u8`,
        { signal: controller.signal }
      )
      clearTimeout(timeout)

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Playlist fetch failed: ${upstream.status}` },
          { status: upstream.status }
        )
      }
      const content = await upstream.text()

      // Rewrite segment URLs to go through this route.
      // Raw lines:  seg_0000.ts?XTransformPort=3032
      // Rewritten:   /api/transcode-stream?hash=<hash>&seg=seg_0000.ts
      const lines = content.split('\n')
      const rewritten = lines.map(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return line
        const segName = trimmed.split('?')[0]
        return `/api/transcode-stream?hash=${hash}&seg=${encodeURIComponent(segName)}`
      }).join('\n')

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/transcode-stream] Error:', msg)
    return NextResponse.json(
      { error: `Transcode stream error: ${msg}` },
      { status: 503 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  })
}
