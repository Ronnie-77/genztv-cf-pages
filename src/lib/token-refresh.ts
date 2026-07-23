/**
 * Token Refresh Automation
 * =========================
 *
 * Signed-URL HLS streams (Akamai hdntl, strmd.st secure paths, bhalocast tokens)
 * embed a time-limited token in the URL. When the token expires the CDN returns
 * 403/404 and the stream stops playing.
 *
 * This module:
 *   1. Parses the token expiry from a stream URL (currently supports Akamai
 *      `hdntl=exp=<unix>` and generic `?exp=` / `?expires=` query params).
 *   2. Re-extracts a fresh m3u8 from the source page (the public web page where
 *      the embed player lives) by fetching the HTML and searching for m3u8 URLs
 *      with a configurable regex. Falls back to iframe src URLs and re-fetches
 *      those if the main page has no direct m3u8.
 *
 * Used by:
 *   - /api/channels/[id]/refresh      (single channel, reactive)
 *   - /api/channels/refresh-expired   (batch, proactive cron)
 */

export interface ParsedTokenExpiry {
  /** Absolute expiry timestamp in ms epoch, or null if no token detected. */
  expiresAt: number | null
  /** Token scheme detected, for logging/UI. */
  scheme: 'akamai-hdntl' | 'query-exp' | 'query-expires' | 'none'
}

/**
 * Parse the token expiry timestamp from a stream URL.
 *
 * Supports:
 *  - Akamai hdntl: `?hdntl=exp=1700000000~acl=/*~data=...~hmac=...`
 *  - Akamai hdntl (variant): `?hdntl=Expires=1700000000~...` (capital E)
 *  - Generic `?exp=1700000000` (seconds or ms)
 *  - Generic `?expires=1700000000` (seconds or ms)
 *  - Generic `?Expires=1700000000` (capital E, seconds or ms)
 */
export function parseTokenExpiry(streamUrl: string): ParsedTokenExpiry {
  if (!streamUrl) return { expiresAt: null, scheme: 'none' }

  try {
    const u = new URL(streamUrl)
    // Akamai hdntl — exp=/Expires= is inside the hdntl= value, not a separate query param
    const hdntl = u.searchParams.get('hdntl')
    if (hdntl) {
      // Match both exp= (lowercase) and Expires= (capital) — different CDNs use different casing
      const expMatch = hdntl.match(/(?:exp|Expires)=(\d+)/i)
      if (expMatch) {
        const exp = parseInt(expMatch[1], 10)
        // Akamai uses seconds
        const ms = exp > 1e12 ? exp : exp * 1000
        return { expiresAt: ms, scheme: 'akamai-hdntl' }
      }
    }

    const expRaw = u.searchParams.get('exp')
    if (expRaw) {
      const exp = parseInt(expRaw, 10)
      if (!Number.isNaN(exp)) {
        const ms = exp > 1e12 ? exp : exp * 1000
        return { expiresAt: ms, scheme: 'query-exp' }
      }
    }

    // Check both 'expires' (lowercase) and 'Expires' (capital)
    const expiresRaw = u.searchParams.get('expires') || u.searchParams.get('Expires')
    if (expiresRaw) {
      const exp = parseInt(expiresRaw, 10)
      if (!Number.isNaN(exp)) {
        const ms = exp > 1e12 ? exp : exp * 1000
        return { expiresAt: ms, scheme: 'query-expires' }
      }
    }
  } catch {
    // Not a valid URL — can't parse
  }

  return { expiresAt: null, scheme: 'none' }
}

/** Default regex used to find m3u8 URLs in page HTML. */
const DEFAULT_M3U8_REGEX =
  /https?:\/\/[^\s"'<>()\\]+?\.m3u8(?:\?[^\s"'<>()\\]*)?/gi

export interface RefreshResult {
  success: boolean
  /** New stream URL if successful. */
  newStreamUrl?: string
  /** Parsed expiry of the new URL, if any. */
  newExpiresAt?: number | null
  /** Human-readable detail. */
  message: string
  /** Where the m3u8 was found: 'main-page' | 'iframe-page' | 'none'. */
  source: 'main-page' | 'iframe-page' | 'none'
}

export interface RefreshOptions {
  /** Override the regex used to find m3u8 (string form). */
  pattern?: string
  /** Maximum number of iframe srcs to follow (default 5). */
  maxIframes?: number
  /** Upstream fetch timeout per page (ms, default 10000). */
  timeoutMs?: number
  /** Optional filter: only accept m3u8 whose URL contains this substring.
   *  Useful when a page has many m3u8s and only one is the live stream. */
  urlFilter?: string
}

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Find the first m3u8 URL in HTML that matches the filter (if any). */
function findM3u8InHtml(
  html: string,
  pattern: string | undefined,
  urlFilter?: string
): string | null {
  const regex = pattern ? new RegExp(pattern, 'gi') : DEFAULT_M3U8_REGEX
  const matches = html.match(regex)
  if (!matches || matches.length === 0) return null
  // De-duplicate
  const unique = Array.from(new Set(matches.map((m) => m)))
  // If a filter is provided, prefer matching URLs
  if (urlFilter) {
    const filtered = unique.filter((u) => u.includes(urlFilter))
    if (filtered.length > 0) return filtered[0]
  }
  // Otherwise return the first match
  return unique[0]
}

/** Extract <iframe src="..."> URLs from HTML. */
function extractIframes(html: string): string[] {
  const out: string[] = []
  const re = /<iframe[^>]+src=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push(m[1])
  }
  return out
}

/** Make a relative URL absolute against a base. */
function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/**
 * Re-extract a fresh m3u8 URL from a channel's source page.
 *
 * Strategy:
 *  1. Fetch the sourcePageUrl HTML.
 *  2. Search for m3u8 URLs (using refreshPattern or default regex).
 *  3. If none found, look for <iframe> srcs, fetch each, and search again.
 *  4. Return the first valid m3u8 found (preferring ones matching urlFilter).
 */
export async function refreshStreamUrl(
  sourcePageUrl: string,
  options: RefreshOptions = {}
): Promise<RefreshResult> {
  if (!sourcePageUrl) {
    return {
      success: false,
      message: 'No source page URL configured for this channel.',
      source: 'none',
    }
  }

  const { pattern, maxIframes = 5, timeoutMs = 10000, urlFilter } = options

  // ── Step 1: fetch the main source page ──
  const mainHtml = await fetchText(sourcePageUrl, timeoutMs)
  if (!mainHtml) {
    return {
      success: false,
      message: `Failed to fetch source page: ${sourcePageUrl}`,
      source: 'none',
    }
  }

  // ── Step 2: search main page for m3u8 ──
  const direct = findM3u8InHtml(mainHtml, pattern, urlFilter)
  if (direct) {
    const parsed = parseTokenExpiry(direct)
    return {
      success: true,
      newStreamUrl: direct,
      newExpiresAt: parsed.expiresAt,
      message: `Fresh m3u8 found on source page.`,
      source: 'main-page',
    }
  }

  // ── Step 3: follow iframes ──
  const iframes = extractIframes(mainHtml)
    .map((src) => absolutize(src, sourcePageUrl))
    // Only follow http(s) iframe srcs
    .filter((u) => u.startsWith('http://') || u.startsWith('https://'))
    .slice(0, maxIframes)

  for (const iframeUrl of iframes) {
    const iframeHtml = await fetchText(iframeUrl, timeoutMs)
    if (!iframeHtml) continue
    const found = findM3u8InHtml(iframeHtml, pattern, urlFilter)
    if (found) {
      const parsed = parseTokenExpiry(found)
      return {
        success: true,
        newStreamUrl: found,
        newExpiresAt: parsed.expiresAt,
        message: `Fresh m3u8 found in iframe: ${iframeUrl}`,
        source: 'iframe-page',
      }
    }
  }

  return {
    success: false,
    message:
      'No m3u8 URL found on source page or in iframes. The page may be ' +
      'JS-rendered (try agent-browser extraction) or the page structure changed.',
    source: 'none',
  }
}

/**
 * Decide whether a channel's token is "expiring soon".
 *
 * A channel is expiring soon if:
 *  - it has a tokenExpiresAt, AND
 *  - that expiry is within `windowMs` of now (default 1 hour).
 *
 * Returns false if no expiry is known (unknown → can't proactively refresh).
 */
export function isTokenExpiringSoon(
  expiresAt: Date | null,
  windowMs: number = 60 * 60 * 1000
): boolean {
  if (!expiresAt) return false
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt
  return ms - Date.now() < windowMs
}

/** Human-readable relative-time formatter for the admin UI. */
export function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return 'unknown'
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt
  const diff = ms - Date.now()
  if (diff <= 0) return 'expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m left`
  const hrs = Math.floor(mins / 60)
  const remMin = mins % 60
  if (hrs < 24) return `${hrs}h ${remMin}m left`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h left`
}
