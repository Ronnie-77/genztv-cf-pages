// /api/fifalive/streams — Lists all available streams from fifalive.click
//
// Fetches the fifalive.click page, extracts stream URLs (Toffee CDN + workers.dev),
// and returns them with pre-formatted proxy URLs that can be used directly
// as stream URLs in GenZTV channels.
//
// Response:
//   {
//     streams: [
//       { name: "Server 1 (Toffee HD)", quality: "HD", originalUrl: "...", proxyUrl: "...", type: "toffee" },
//       { name: "Server 2 (FHD)", quality: "HD", originalUrl: "...", proxyUrl: "...", type: "worker" },
//       { name: "Server 3 (4K)", quality: "4K", originalUrl: "...", proxyUrl: "...", type: "worker" },
//     ],
//     resolvedToffeeUrl: "https://prod-cdn01-live...",  // resolved via /api/resolve-fifalive
//     cached: boolean,
//     fetchedAt: number
//   }

import { NextRequest, NextResponse } from 'next/server'

const FIFALIVE_PAGE = 'https://fifalive.click/'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes — workers.dev URLs are stable

interface StreamInfo {
  name: string
  quality: string
  originalUrl: string
  proxyUrl: string
  type: 'toffee' | 'worker'
  bdOnly: boolean
}

interface CacheEntry {
  streams: StreamInfo[]
  fetchedAt: number
}

let cache: CacheEntry | null = null

function getProxyBase(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

function extractStreams(html: string, proxyBase: string): StreamInfo[] {
  const streams: StreamInfo[] = []

  // Extract serverList array
  const serverMatch = html.match(/var\s+serverList\s*=\s*(\[[\s\S]*?\]);/)
  // Extract qualityList array
  const qualityMatch = html.match(/var\s+qualityList\s*=\s*(\[[\s\S]*?\]);/)
  // Extract server button labels
  const btnRegex = /class="server-btn[^"]*"[^>]*>([\s\S]*?)<\/button>/g
  const btnMatches: RegExpMatchArray[] = []
  let btnMatch: RegExpMatchArray | null
  while ((btnMatch = btnRegex.exec(html)) !== null) {
    btnMatches.push(btnMatch)
  }

  let serverUrls: string[] = []
  let qualities: string[] = []

  if (serverMatch) {
    try {
      serverUrls = JSON.parse(serverMatch[1].replace(/\\\//g, '/'))
    } catch {}
  }

  if (qualityMatch) {
    try {
      qualities = JSON.parse(qualityMatch[1])
    } catch {}
  }

  // Parse button labels to get server names
  const btnLabels = btnMatches.map(m => {
    const text = m[1].replace(/<[^>]*>/g, '').trim()
    return text
  })

  for (let i = 0; i < serverUrls.length; i++) {
    const url = serverUrls[i]
    const quality = qualities[i] || 'HD'
    const label = btnLabels[i] || `Server ${i + 1}`
    const isToffee = url.includes('toffeelive.com')
    const isWorker = url.includes('workers.dev')
    const bdOnly = isToffee || (isWorker && !url.includes('4k'))

    // For workers.dev URLs, use the fifalive proxy
    // For toffeelive URLs, also proxy through fifalive (adds Referer + rewrites segments)
    const proxyUrl = `${proxyBase}/api/fifalive?url=${encodeURIComponent(url)}&mode=m3u8`

    streams.push({
      name: label,
      quality,
      originalUrl: url,
      proxyUrl,
      type: isToffee ? 'toffee' : 'worker',
      bdOnly,
    })
  }

  return streams
}

export async function GET(request: NextRequest) {
  const proxyBase = getProxyBase(request)
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  // Serve from cache if fresh
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    // Rebuild proxy URLs with current proxy base (in case host changed)
    const streams = cache.streams.map(s => ({
      ...s,
      proxyUrl: `${proxyBase}/api/fifalive?url=${encodeURIComponent(s.originalUrl)}&mode=m3u8`,
    }))
    return NextResponse.json({
      streams,
      cached: true,
      fetchedAt: cache.fetchedAt,
    })
  }

  try {
    // Fetch the fifalive.click page
    const res = await fetch(FIFALIVE_PAGE, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      throw new Error(`fifalive.click returned ${res.status}`)
    }

    const html = await res.text()
    const streams = extractStreams(html, proxyBase)

    if (streams.length === 0) {
      throw new Error('No streams found on fifalive.click')
    }

    // Update cache
    cache = {
      streams: streams.map(s => ({ ...s, proxyUrl: '' })), // Don't cache proxy URLs (host-dependent)
      fetchedAt: Date.now(),
    }

    // Also try to extract the Toffee URL directly from the page
    // (fifalive.click embeds a toffeelive m3u8 with hdntl token)
    let resolvedToffeeUrl: string | null = null
    try {
      const toffeMatch = html.match(/https?:\/\/[^\s"'<>]*toffeelive\.com\/[^\s"'<>]+\.m3u8[^\s"'<>]*/)
      if (toffeMatch) {
        resolvedToffeeUrl = toffeMatch[0]
        // Update the toffee stream with the fresh resolved URL
        const toffeeStream = streams.find(s => s.type === 'toffee')
        if (toffeeStream) {
          toffeeStream.originalUrl = resolvedToffeeUrl
          toffeeStream.proxyUrl = `${proxyBase}/api/fifalive?url=${encodeURIComponent(resolvedToffeeUrl)}&mode=m3u8`
        }
      }
    } catch {
      // Non-fatal — the page-extracted URL may still work
    }

    return NextResponse.json({
      streams,
      resolvedToffeeUrl,
      cached: false,
      fetchedAt: cache.fetchedAt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'

    // Return stale cache as fallback
    if (cache) {
      const streams = cache.streams.map(s => ({
        ...s,
        proxyUrl: `${proxyBase}/api/fifalive?url=${encodeURIComponent(s.originalUrl)}&mode=m3u8`,
      }))
      return NextResponse.json({
        streams,
        cached: true,
        fetchedAt: cache.fetchedAt,
        warning: `Fresh fetch failed: ${msg}`,
      })
    }

    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
