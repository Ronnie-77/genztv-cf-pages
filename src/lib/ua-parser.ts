/**
 * Server-side User-Agent parser for analytics.
 *
 * Detects:
 *  - device: 'tv' | 'desktop' | 'mobile'
 *  - browser: 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'Opera' | 'Samsung Internet' | 'Other'
 *
 * No external dependencies — pure string matching. All data is derived from
 * the REAL visitor's User-Agent header. No fake/mock data.
 */

export type DeviceType = 'tv' | 'desktop' | 'mobile'

const TV_UA_PATTERNS = [
  /smart-tv/i,
  /smarttv/i,
  /tizen/i,
  /webos/i,
  /netcast/i,
  /hbbtv/i,
  /roku/i,
  /appletv/i,
  /applecoremedia.*television/i,
  /ce-html/i,
  /googletv/i,
  /viera/i, // Panasonic
  /bravia/i, // Sony
  /nettv/i, // Philips
  /tvbox/i,
  /\bdtv\b/i,
  /tv;\s/i,
]

export function detectDevice(ua: string): DeviceType {
  if (!ua) return 'desktop'
  if (TV_UA_PATTERNS.some((re) => re.test(ua))) return 'tv'
  // Mobile signals
  if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) return 'mobile'
  // iPad (older UA) / Android tablet
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function detectBrowser(ua: string): string {
  if (!ua) return 'Other'
  // Order matters — check most specific first (Edge/Edg uses Chrome UA, OPR uses Chrome UA, Samsung uses Chrome UA)
  if (/edg\//i.test(ua) || /edge\//i.test(ua)) return 'Edge'
  if (/opr\/|opera/i.test(ua)) return 'Opera'
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet'
  if (/firefox\//i.test(ua) || /fxios/i.test(ua)) return 'Firefox'
  if (/chrome\//i.test(ua) || /crios/i.test(ua)) return 'Chrome'
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return 'Safari'
  // Fallbacks for older / niche browsers
  if (/ucbrowser/i.test(ua)) return 'UC Browser'
  if (/miuibrowser/i.test(ua)) return 'Mi Browser'
  if (/yabrowser/i.test(ua)) return 'Yandex'
  return 'Other'
}

/** Parse a UA string into { device, browser }. */
export function parseUserAgent(ua: string): { device: DeviceType; browser: string } {
  return {
    device: detectDevice(ua),
    browser: detectBrowser(ua),
  }
}
