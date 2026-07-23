export const runtime = 'nodejs'

// /api/fifalive — Proxy for fifalive.click streams
//
// Proxies m3u8 manifests and segments from fifalive.click workers.dev URLs
// by adding the correct Referer header (required by Cloudflare Workers).
//
// Usage:
//   GET /api/fifalive?url=ENCODED_URL&mode=m3u8
//   - mode=m3u8: fetches & rewrites m3u8 manifest, segment URLs go through this proxy
//   - mode=segment: fetches a single segment (used by rewritten URLs)
//   - mode=direct: fetches the m3u8 as-is without rewriting (for hls.js to handle)
//
// The proxy adds `Referer: https://fifalive.click/` and `Origin: https://fifalive.click`
// to all upstream requests, which is required by the Cloudflare Workers that serve
// the streams (they check the Referer header and return 403 if it's not fifalive.click).

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

const UPSTREAM_TIMEOUT = 15000 // 15s
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 500

// ─── In-memory manifest cache ──────────────────────────────────────────
const MANIFEST_CACHE_TTL_MS = 3000 // 3s — live playlists update frequently
const manifestCache = new Map<string, { body: string; contentType: string; ts: number }>()

// Build upstream fetch headers based on the target URL.
// Toffee CDN (toffeelive.com) needs no Referer — it uses hdntl token auth.
// Workers.dev URLs require Referer: https://fifalive.click/
function buildHeaders(upstreamUrl: string): Record<string, string> {
  const isWorker = upstreamUrl.includes('workers.dev')
  const isTiktokCdn = upstreamUrl.includes('tiktokcdn.com')

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
  }

  if (isWorker) {
    headers['Referer'] = 'https://fifalive.click/'
    headers['Origin'] = 'https://fifalive.click'
  } else if (isTiktokCdn) {
    // TikTok CDN segments don't need Referer
    headers['Referer'] = 'https://fifalive.click/'
  }
  // Toffee CDN: no Referer needed — hdntl token handles auth

  return headers
}

// Fetch with retry
async function fetchWithRetry(url: string, headers: Record<string, string>, timeout = UPSTREAM_TIMEOUT): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt))
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      })

      clearTimeout(timer)

      // Don't retry on 4xx (client errors) except 429 (rate limit)
      if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429) {
        return res
      }

      // Retry on 429 or 5xx
      if (!res.ok && attempt < MAX_RETRIES) {
        continue
      }

      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error')
    }
  }

  throw lastError || new Error('Fetch failed after retries')
}

function getProxyBase(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

function rewriteM3u8(
  body: string,
  upstreamBaseUrl: string,
  proxyBase: string,
): string {
  const lines = body.split('\n')
  const rewritten: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // #EXT-X-KEY or #EXT-X-MAP with URI="..."
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      const uriMatch = line.match(/URI="([^"]+)"/)
      if (uriMatch) {
        const origUri = uriMatch[1]
        const absUri = new URL(origUri, upstreamBaseUrl).href
        const proxyUri = `${proxyBase}/api/fifalive?url=${encodeURIComponent(absUri)}&mode=segment`
        rewritten.push(rawLine.replace(`URI="${origUri}"`, `URI="${proxyUri}"`))
        continue
      }
    }

    // Comment / directive lines
    if (line.startsWith('#') || line === '') {
      rewritten.push(rawLine)
      continue
    }

    // Segment URL (http/https)
    if (line.startsWith('http://') || line.startsWith('https://')) {
      const proxyUrl = `${proxyBase}/api/fifalive?url=${encodeURIComponent(line)}&mode=segment`
      rewritten.push(proxyUrl)
      continue
    }

    // Relative segment URL
    if (line.length > 0 && !line.startsWith('#')) {
      const absUrl = new URL(line, upstreamBaseUrl).href
      const proxyUrl = `${proxyBase}/api/fifalive?url=${encodeURIComponent(absUrl)}&mode=segment`
      rewritten.push(proxyUrl)
      continue
    }

    rewritten.push(rawLine)
  }

  return rewritten.join('\n')
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const encodedUrl = searchParams.get('url')
  const mode = searchParams.get('mode') || 'm3u8'

  if (!encodedUrl) {
    return NextResponse.json({ error: 'Missing ?url= parameter' }, { status: 400 })
  }

  let upstreamUrl: string
  try {
    upstreamUrl = decodeURIComponent(encodedUrl)
  } catch {
    upstreamUrl = encodedUrl
  }

  // Validate URL
  if (!upstreamUrl.startsWith('http://') && !upstreamUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const proxyBase = getProxyBase(request)

  // ─── Segment mode: stream the segment through with Referer ────────
  if (mode === 'segment') {
    try {
      const headers = buildHeaders(upstreamUrl)
      const upstream = await fetchWithRetry(upstreamUrl, headers)

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Upstream returned ${upstream.status}` },
          { status: upstream.status },
        )
      }

      const contentType = upstream.headers.get('content-type') || 'video/MP2T'
      const body = upstream.body

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: `Segment fetch failed: ${msg}` }, { status: 502 })
    }
  }

  // ─── Direct mode: return m3u8 as-is without rewriting ─────────────
  if (mode === 'direct') {
    try {
      const headers = buildHeaders(upstreamUrl)
      const upstream = await fetchWithRetry(upstreamUrl, headers)

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Upstream returned ${upstream.status}` },
          { status: upstream.status },
        )
      }

      const body = await upstream.text()
      const contentType = upstream.headers.get('content-type') || 'application/vnd.apple.mpegurl'

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json({ error: `Direct fetch failed: ${msg}` }, { status: 502 })
    }
  }

  // ─── M3U8 mode: fetch, rewrite segment URLs, cache ────────────────
  // Check cache first
  const cacheKey = upstreamUrl
  const cached = manifestCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < MANIFEST_CACHE_TTL_MS) {
    return new NextResponse(cached.body, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=3',
        'Access-Control-Allow-Origin': '*',
        'X-Fifalive-Cache': 'HIT',
      },
    })
  }

  try {
    const headers = buildHeaders(upstreamUrl)
    const upstream = await fetchWithRetry(upstreamUrl, headers)

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status} for ${upstreamUrl}` },
        { status: upstream.status },
      )
    }

    const body = await upstream.text()
    const contentType = upstream.headers.get('content-type') || 'application/vnd.apple.mpegurl'

    // Rewrite segment URLs to go through this proxy
    const rewritten = rewriteM3u8(body, upstreamUrl, proxyBase)

    // Cache the rewritten manifest
    manifestCache.set(cacheKey, { body: rewritten, contentType, ts: Date.now() })

    // Evict stale entries
    const now = Date.now()
    manifestCache.forEach((entry, key) => {
      if (now - entry.ts > MANIFEST_CACHE_TTL_MS * 2) {
        manifestCache.delete(key)
      }
    })

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3',
        'Access-Control-Allow-Origin': '*',
        'X-Fifalive-Cache': 'MISS',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `M3U8 fetch failed: ${msg}` }, { status: 502 })
  }
}
