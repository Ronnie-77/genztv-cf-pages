export const runtime = 'nodejs'

import { NextRequest } from 'next/server'

// GET /api/stream-proxy?url=ENCODED_URL
// Simple 1:1 HLS/m3u8 proxy for Cloudflare Pages (Workers runtime).
//
// ─── ARCHITECTURE: Simple Proxy (No Multiplexing) ─────────────────────────
//
// Each viewer gets their own upstream connection.
// No Stream Multiplexer, no ring buffer, no in-memory state.
// Workers runtime is ephemeral — no persistent memory between requests.
//
// Features:
// - VLC User-Agent for IPTV server compatibility
// - Origin/Referer headers for better upstream compatibility
// - m3u8 manifest rewriting: rewrites URLs to go through the proxy
// - ReadableStream streaming for efficient data transfer
// - CORS headers for browser access
// - Error handling with graceful responses

// ─── Upstream request headers ──────────────────────────────────────────────
const UPSTREAM_HEADERS: Record<string, string> = {
  'User-Agent': 'VLC/3.0.21 LibVLC/3.0.21',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
}

// ─── CORS response headers ─────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
  'Access-Control-Max-Age': '86400',
}

// ─── Detect if response is an m3u8 manifest ───────────────────────────────
function isM3u8(contentType: string, url: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes('mpegurl') || ct.includes('application/vnd.apple.mpegurl')) return true
  // Fallback: check URL extension
  if (url.match(/\.m3u8(\?|$)/i)) return true
  return false
}

// ─── Rewrite m3u8 URLs to go through the proxy ───────────────────────────
function rewriteM3u8(body: string, originalUrl: string): string {
  try {
    const baseUrl = new URL(originalUrl)
    const origin = baseUrl.origin
    const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1)

    const proxyBase = '/api/stream-proxy?url='

    // Rewrite absolute URLs
    let rewritten = body.replace(
      /https?:\/\/[^\s"'<>()\\]+/g,
      (match) => {
        // Skip URLs that are already proxied
        if (match.includes('/api/stream-proxy')) return match
        return proxyBase + encodeURIComponent(match)
      }
    )

    // Rewrite relative URLs (paths like ../segment.ts or segment.ts)
    rewritten = rewritten.replace(
      /(?:^|\n)([^\s#"'<>()\\]+?\.(?:ts|m3u8|m4s|mp4)(?:\?[^\s#"'<>()\\]*)?)/gm,
      (match, urlPath) => {
        // Don't rewrite if already absolute or proxied
        if (urlPath.startsWith('http') || urlPath.includes('/api/stream-proxy')) return match
        // Resolve relative path against base
        try {
          const resolved = new URL(urlPath, origin + basePath).href
          return proxyBase + encodeURIComponent(resolved)
        } catch {
          return match
        }
      }
    )

    // Rewrite #EXT-X-KEY URI= and #EXT-X-MAP URI= attributes
    rewritten = rewritten.replace(
      /URI="([^"]+)"/g,
      (match, uri) => {
        if (uri.startsWith('http') || uri.includes('/api/stream-proxy')) return match
        try {
          const resolved = new URL(uri, origin + basePath).href
          return `URI="${proxyBase + encodeURIComponent(resolved)}"`
        } catch {
          return match
        }
      }
    )

    return rewritten
  } catch {
    return body
  }
}

export async function GET(req: NextRequest) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const encodedUrl = req.nextUrl.searchParams.get('url')
  if (!encodedUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing "url" query parameter' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  let upstreamUrl: string
  try {
    upstreamUrl = decodeURIComponent(encodedUrl)
  } catch {
    upstreamUrl = encodedUrl
  }

  // Build upstream headers — add Referer/Origin based on the upstream URL's origin
  const headers: Record<string, string> = { ...UPSTREAM_HEADERS }
  try {
    const u = new URL(upstreamUrl)
    headers['Referer'] = u.origin + '/'
    headers['Origin'] = u.origin
  } catch {
    // Invalid URL — proceed without Referer
  }

  // Pass Range headers if present (for segment seeking)
  const rangeHeader = req.headers.get('Range')
  if (rangeHeader) {
    headers['Range'] = rangeHeader
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers,
      redirect: 'follow',
    })

    if (!upstreamResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `Upstream returned ${upstreamResponse.status}`,
          status: upstreamResponse.status,
        }),
        {
          status: upstreamResponse.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      )
    }

    const contentType = upstreamResponse.headers.get('Content-Type') || ''

    // ── m3u8 manifest: rewrite URLs and return as text ──
    if (isM3u8(contentType, upstreamUrl)) {
      const body = await upstreamResponse.text()
      const rewritten = rewriteM3u8(body, upstreamUrl)
      return new Response(rewritten, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store',
        },
      })
    }

    // ── Binary content (segments, live streams): stream through ──
    // Use ReadableStream for efficient streaming
    const stream = upstreamResponse.body

    if (!stream) {
      // No body — return empty response with upstream status
      return new Response(null, {
        status: upstreamResponse.status,
        headers: CORS_HEADERS,
      })
    }

    // Build response headers — forward relevant upstream headers + CORS
    const responseHeaders: Record<string, string> = { ...CORS_HEADERS }

    // Forward Content-Type
    if (contentType) {
      responseHeaders['Content-Type'] = contentType
    }

    // Forward Content-Length if available
    const contentLength = upstreamResponse.headers.get('Content-Length')
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength
    }

    // Forward Content-Range if available (for range requests)
    const contentRange = upstreamResponse.headers.get('Content-Range')
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange
    }

    // Forward Accept-Ranges
    const acceptRanges = upstreamResponse.headers.get('Accept-Ranges')
    if (acceptRanges) {
      responseHeaders['Accept-Ranges'] = acceptRanges
    }

    // Cache segments briefly, no-cache for live streams
    const isSegment = upstreamUrl.match(/\.(ts|m4s|mp4)(\?|$)/i)
    responseHeaders['Cache-Control'] = isSegment
      ? 'public, max-age=60'
      : 'no-cache, no-store'

    return new Response(stream, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: `Proxy error: ${message}` }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  }
}
