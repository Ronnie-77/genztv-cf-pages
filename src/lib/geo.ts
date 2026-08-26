/**
 * IP → Country geolocation for analytics.
 *
 * Uses ip-api.com (free, no API key, 45 req/min limit) with an in-memory
 * cache so repeat visits from the same IP don't re-query.
 *
 * IMPORTANT: All country data comes from the REAL visitor's IP. No fake/mock
 * data is ever generated. If the lookup fails (network error, rate limit,
 * private IP), country is recorded as an empty string — the rest of the
 * analytics tracking still works.
 *
 * The cache is process-wide (module-level Map) and expires after 24h so
 * a visitor who roams to a new country eventually gets re-resolved.
 */

interface GeoCacheEntry {
  country: string
  expiresAt: number
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const LOOKUP_TIMEOUT_MS = 2500

const cache = new Map<string, GeoCacheEntry>()

/** True if the IP is private / loopback / link-local (skip geolocation). */
function isPrivateIp(ip: string): boolean {
  if (!ip) return true
  if (ip === '::1' || ip === '::') return true
  // IPv4
  if (/^127\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true
  if (/^0\./.test(ip)) return true
  // IPv6 link-local / unique-local
  if (/^f[cd]/i.test(ip)) return true
  if (/^fe80/i.test(ip)) return true
  return false
}

/**
 * Look up the country code for an IP address.
 * Returns '' if the IP is private, the lookup fails, or the result is unknown.
 */
export async function lookupCountry(ip: string): Promise<string> {
  if (!ip || isPrivateIp(ip)) return ''

  // Check cache
  const cached = cache.get(ip)
  if (cached) {
    if (Date.now() < cached.expiresAt) return cached.country
    cache.delete(ip)
  }

  try {
    // ip-api.com free endpoint returns JSON: { country, countryCode, ... }
    // field: countryName — we use full country name for readability in dashboard.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)

    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timer)

    if (!res.ok) return ''
    const data = (await res.json()) as {
      status?: string
      country?: string
      countryCode?: string
    }
    if (data.status !== 'success') return ''
    // Prefer the full country name (e.g. "Bangladesh"); fall back to code.
    const country = data.country?.trim() || data.countryCode?.trim() || ''
    cache.set(ip, { country, expiresAt: Date.now() + CACHE_TTL_MS })
    return country
  } catch {
    // Network error, timeout, or parse failure — record empty, don't cache
    // (so a transient failure can be retried on the next visit).
    return ''
  }
}

/**
 * Best-effort country from request headers, without a network lookup.
 * Checks common CDN/proxy headers (Vercel, Cloudflare, Caddy) first.
 * Returns '' if none are present (caller should then use lookupCountry).
 */
export function countryFromHeaders(headers: Headers): string {
  const candidates = [
    'x-vercel-ip-country',
    'cf-ipcountry',
    'x-country-code',
    'x-geo-country',
  ]
  for (const h of candidates) {
    const v = headers.get(h)
    if (v && v.trim() && v.trim() !== 'XX') return v.trim()
  }
  return ''
}
