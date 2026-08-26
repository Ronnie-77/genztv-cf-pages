// /api/resolve-fifalive — resolves the live m3u8 URL (with Akamai hdntl
// token) for the fifalive.click/play stream.
//
// (Task 29) fifalive.click/play embeds a toffeelive.com HLS stream whose
// URL carries an `hdntl=Expires=...~Signature=...` token that is valid
// for ~24h. This endpoint fetches the page server-side, extracts the m3u8
// URL + token, and caches it in-memory for 20h (well within the 23-24h
// token lifetime). When the cache expires, the next request re-fetches.
//
// Anti-devtools protection on the page is client-side only (debugger
// detection, contextmenu block) — it does not affect server-side fetch.
//
// Response:
//   { url: string, expires: number|null, source: string, cached: boolean }

import { NextResponse } from 'next/server'

const FIFALIVE_PAGE = 'https://fifalive.click/play'
const CACHE_TTL_MS = 20 * 60 * 60 * 1000 // 20h (token valid ~23-24h)

interface CacheEntry {
  url: string
  expires: number | null
  fetchedAt: number
}
let cache: CacheEntry | null = null

// Extract the first toffeelive.com m3u8 URL (with hdntl token) from HTML.
// Also tries generic m3u8 URLs as fallback.
function extractStreamUrl(html: string): { url: string; expires: number | null } | null {
  // Prefer the toffeelive master m3u8 (the actual live stream).
  const toffeMatch = html.match(
    /https?:\/\/[^\s"'<>]*toffeelive\.com\/[^\s"'<>]+\.m3u8[^\s"'<>]*/,
  )
  if (toffeMatch) {
    const url = toffeMatch[0]
    const expMatch = url.match(/Expires=(\d+)/)
    return { url, expires: expMatch ? parseInt(expMatch[1], 10) : null }
  }
  // Fallback: any m3u8 URL on the page.
  const anyMatch = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/)
  if (anyMatch) {
    const url = anyMatch[0]
    const expMatch = url.match(/Expires=(\d+)/)
    return { url, expires: expMatch ? parseInt(expMatch[1], 10) : null }
  }
  return null
}

async function fetchFreshUrl(): Promise<CacheEntry> {
  const res = await fetch(FIFALIVE_PAGE, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    // Don't follow redirects silently — we want the page HTML.
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`fifalive.click returned ${res.status}`)
  }
  const html = await res.text()
  const extracted = extractStreamUrl(html)
  if (!extracted) {
    throw new Error('No m3u8 stream URL found on fifalive.click/play')
  }
  cache = {
    url: extracted.url,
    expires: extracted.expires,
    fetchedAt: Date.now(),
  }
  return cache
}

export async function GET(request: Request) {
  // `force=1` bypasses the cache — used by the player when a stream error
  // suggests the cached token has been rejected by Akamai even though it
  // hasn't technically expired yet (rare, but possible during CDN edge
  // propagation). (Task 29)
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  try {
    // Serve from cache if fresh enough AND token hasn't expired AND not forced.
    const now = Date.now()
    if (!force && cache) {
      const age = now - cache.fetchedAt
      const tokenStillValid = cache.expires ? now < cache.expires * 1000 - 60_000 : age < CACHE_TTL_MS
      if (age < CACHE_TTL_MS && tokenStillValid) {
        return NextResponse.json({
          url: cache.url,
          expires: cache.expires,
          source: 'fifalive.click',
          cached: true,
        })
      }
    }
    // Cache miss / stale / forced — fetch fresh.
    const entry = await fetchFreshUrl()
    return NextResponse.json({
      url: entry.url,
      expires: entry.expires,
      source: 'fifalive.click',
      cached: false,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    // If we have a cached entry, return it as a last resort even if stale —
    // the player will try it and re-resolve on failure.
    if (cache) {
      return NextResponse.json({
        url: cache.url,
        expires: cache.expires,
        source: 'fifalive.click',
        cached: true,
        warning: `fresh fetch failed: ${msg}`,
      })
    }
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
