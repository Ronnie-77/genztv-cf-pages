import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/transcode?url=<encoded>
 *
 * Proxy to the transcode mini-service on port 3032.
 *
 * The frontend calls this relative path so it works regardless of whether
 * the request goes through the Caddy gateway (port 81, Preview Panel) or
 * directly to the Next.js dev server (port 3000, Agent Browser / localhost).
 *
 * Returns JSON: { playlist: "/api/transcode-stream?hash=<hash>", hash: "..." }
 * The playlist URL goes through /api/transcode-stream (another Next.js route)
 * which proxies playlist + segment requests to port 3032. This single-path
 * approach works in BOTH environments without relying on XTransformPort.
 */

const TRANSCODE_SERVICE = 'http://127.0.0.1:3032'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    // Forward to the transcode mini-service with a 25s timeout
    // (transcode startup can take a few seconds for HEVC streams)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)

    const upstream = await fetch(
      `${TRANSCODE_SERVICE}/transcode?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    const text = await upstream.text()

    // The mini-service returns JSON with a playlist URL containing
    // ?XTransformPort=3032 (for gateway routing). We rewrite it to go through
    // our Next.js proxy route so it works in both environments.
    try {
      const data = JSON.parse(text)
      if (data.playlist) {
        const match = data.playlist.match(/\/stream\/([a-f0-9]+)\/playlist\.m3u8/)
        if (match) {
          const hash = match[1]
          data.playlist = `/api/transcode-stream?hash=${hash}`
        }
      }
      return NextResponse.json(data, { status: upstream.status })
    } catch {
      return new NextResponse(text, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[api/transcode] Error:', msg)
    return NextResponse.json(
      { error: `Transcode service unavailable: ${msg}` },
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
