/**
 * IP → Country geolocation for analytics.
 *
 * On Cloudflare Pages (Workers runtime), the cf-ipcountry header is
 * automatically provided by Cloudflare's edge network — no external
 * lookup needed. This module prefers the header and falls back to
 * ip-api.com only if the header is missing (e.g. local dev).
 *
 * No in-memory cache on Workers (ephemeral runtime).
 */

/** True if the IP is private / loopback / link-local (skip geolocation). */
function isPrivateIp(ip: string): boolean {
  if (!ip) return true
  if (ip === '::1' || ip === '::') return true
  if (/^127\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true
  if (/^0\./.test(ip)) return true
  if (/^f[cd]/i.test(ip)) return true
  if (/^fe80/i.test(ip)) return true
  return false
}

/**
 * Look up the country code for an IP address.
 * On Cloudflare Workers, the cf-ipcountry header is always present.
 * Falls back to ip-api.com for local development.
 */
export async function lookupCountry(ip: string): Promise<string> {
  if (!ip || isPrivateIp(ip)) return ''

  // On Workers: use cf-ipcountry (available in getRequestContext)
  // But since this function receives raw IP, we'll use ip-api.com
  // as fallback. In practice, the API routes that use this should
  // prefer countryFromHeaders() which checks cf-ipcountry first.

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`,
      {
        headers: { 'Accept': 'application/json' },
      }
    )

    if (!res.ok) return ''
    const data = (await res.json()) as {
      status?: string
      country?: string
      countryCode?: string
    }
    if (data.status !== 'success') return ''
    return data.country?.trim() || data.countryCode?.trim() || ''
  } catch {
    return ''
  }
}

/**
 * Best-effort country from request headers, without a network lookup.
 * On Cloudflare Pages, cf-ipcountry is always present and reliable.
 */
export function countryFromHeaders(headers: Headers): string {
  const candidates = [
    'cf-ipcountry',       // Cloudflare Workers — always present
    'x-vercel-ip-country', // Vercel
    'x-country-code',
    'x-geo-country',
  ]
  for (const h of candidates) {
    const v = headers.get(h)
    if (v && v.trim() && v.trim() !== 'XX') return v.trim()
  }
  return ''
}
