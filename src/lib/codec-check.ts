/**
 * Codec & MIME-type capability detection for HLS / MSE playback.
 *
 * Why this exists
 * ───────────────
 * Toffee Live / similar South-Asian streaming CDNs often ship
 * HEVC (H.265) video inside HLS. Desktop Chrome (with hardware
 * acceleration) can decode HEVC, but mobile Chrome and Firefox do NOT
 * expose HEVC through Media Source Extensions (MSE) — so hls.js fails
 * with a "media error" the user perceives as "stream format not supported".
 *
 * This module lets us detect that situation BEFORE we throw a confusing
 * error, so we can:
 *   1. Show a clear, actionable message ("Use Safari / try desktop").
 *   2. Trigger an iframe fallback (the source site's own player, which
 *      uses native HLS on iOS Safari).
 *   3. Skip codecs the browser claims it can't decode.
 */

export interface CodecCheckResult {
  /** Browser can play at least one of the levels in the manifest. */
  playable: boolean
  /** True if at least one level uses HEVC / H.265 video. */
  hasHevc: boolean
  /** True if at least one level uses AV1 video. */
  hasAv1: boolean
  /** True if at least one level uses AAC-HE / HE-AAC v2 audio. */
  hasHeAac: boolean
  /** Human-readable summary useful for logging. */
  summary: string
  /** Suggested fallback action. */
  fallback: 'none' | 'iframe' | 'mpegts' | 'safari-only'
}

export interface LevelCodecInfo {
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
  bitrate?: number
}

/**
 * Check whether the browser can decode the codecs used by the given HLS
 * levels. Uses `MediaSource.isTypeSupported()` (the source of truth for
 * what hls.js can actually feed to a <video> element).
 *
 * Note: `video.canPlayType()` returns optimistic results for HEVC on
 * mobile Chrome (it reports the OS-level decoder, not the MSE path), so
 * we MUST use `MediaSource.isTypeSupported()` instead.
 */
export function checkHlsCodecCompatibility(
  levels: LevelCodecInfo[]
): CodecCheckResult {
  // No levels → nothing to check, assume playable (let hls.js try).
  if (!levels || levels.length === 0) {
    return {
      playable: true,
      hasHevc: false,
      hasAv1: false,
      hasHeAac: false,
      summary: 'No levels to inspect',
      fallback: 'none',
    }
  }

  const hasHevc = levels.some((l) => isHevcCodec(l.videoCodec))
  const hasAv1 = levels.some((l) => isAv1Codec(l.videoCodec))
  const hasHeAac = levels.some((l) => isHeAacCodec(l.audioCodec))

  // Build MIME probes for every (video, audio) combination present.
  // If ANY level is fully supported, we consider the stream playable
  // (hls.js can stick to that level via ABR).
  let anyPlayable = false
  for (const level of levels) {
    const mime = buildMimeString(level.videoCodec, level.audioCodec)
    if (mime && isMimeSupported(mime)) {
      anyPlayable = true
      break
    }
  }

  // If no individual level was playable, but we have multiple levels and
  // at least one of them has only H.264 + AAC (no exotic codecs), retry
  // with a relaxed probe — sometimes the codec string in the manifest
  // is over-specified and hls.js can still play it.
  if (!anyPlayable) {
    const h264AacLevel = levels.find(
      (l) => !isHevcCodec(l.videoCodec) && !isAv1Codec(l.videoCodec)
    )
    if (h264AacLevel) {
      const relaxed = buildMimeString(
        'avc1.42E01E', // baseline H.264 fallback
        'mp4a.40.2'    // AAC-LC fallback
      )
      if (relaxed && isMimeSupported(relaxed)) {
        anyPlayable = true
      }
    }
  }

  let fallback: CodecCheckResult['fallback'] = 'none'
  let summary: string

  if (anyPlayable) {
    summary = `Playable — codecs present: ${describeCodecs(levels)}`
  } else if (hasHevc) {
    // HEVC + mobile Chrome/Firefox = no path through MSE.
    // Native HLS (Safari) or the source site's iframe player are the
    // only ways forward.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    fallback = isSafari ? 'mpegts' : 'iframe'
    summary = `HEVC stream detected — this browser cannot decode HEVC via MSE. ${
      isSafari ? 'Try mpegts.js fallback.' : 'Use Safari or the embedded player.'
    }`
  } else if (hasAv1) {
    fallback = 'mpegts'
    summary = `AV1 stream detected — trying mpegts.js fallback.`
  } else {
    fallback = 'mpegts'
    summary = `No playable codec found — trying mpegts.js fallback. Codecs: ${describeCodecs(levels)}`
  }

  return {
    playable: anyPlayable,
    hasHevc,
    hasAv1,
    hasHeAac,
    summary,
    fallback,
  }
}

/** Build a MIME string suitable for `MediaSource.isTypeSupported()`. */
function buildMimeString(
  videoCodec?: string,
  audioCodec?: string
): string | null {
  const codecs = [videoCodec, audioCodec].filter(Boolean)
  if (codecs.length === 0) return null
  return `video/mp4; codecs="${codecs.join(',')}"`
}

/** Safe wrapper — `MediaSource` may be undefined on very old browsers. */
function isMimeSupported(mime: string): boolean {
  try {
    if (
      typeof MediaSource !== 'undefined' &&
      typeof MediaSource.isTypeSupported === 'function'
    ) {
      return MediaSource.isTypeSupported(mime)
    }
  } catch {
    /* swallow */
  }
  return false
}

/** HEVC codec strings start with hvc1, hev1, or hvs1 (Apple variant). */
export function isHevcCodec(codec?: string): boolean {
  if (!codec) return false
  const c = codec.toLowerCase()
  return c.startsWith('hvc1') || c.startsWith('hev1') || c.startsWith('hvs1')
}

/** AV1 codec strings start with av01. */
export function isAv1Codec(codec?: string): boolean {
  if (!codec) return false
  return codec.toLowerCase().startsWith('av01')
}

/** HE-AAC v1/v2 codec strings are mp4a.40.5 / mp4a.40.29 / mp4a.40.2 (LC is fine). */
export function isHeAacCodec(codec?: string): boolean {
  if (!codec) return false
  const c = codec.toLowerCase()
  // 40.5 = HE-AAC v1, 40.29 = HE-AAC v2, 40.2 = AAC-LC (always supported)
  return c.includes('mp4a.40.5') || c.includes('mp4a.40.29')
}

/** Short human-readable codec summary for logs. */
function describeCodecs(levels: LevelCodecInfo[]): string {
  const seen = new Set<string>()
  for (const l of levels) {
    if (l.videoCodec) seen.add(`V:${l.videoCodec}`)
    if (l.audioCodec) seen.add(`A:${l.audioCodec}`)
  }
  return Array.from(seen).join(' ') || 'unknown'
}

/**
 * Quick check: does the current browser expose HEVC through MSE?
 * Caches the result — this probe is non-trivial on some platforms.
 */
let _hevcMseSupported: boolean | null = null
export function isHevcMseSupported(): boolean {
  if (_hevcMseSupported !== null) return _hevcMseSupported
  // Common HEVC codec strings used by HLS manifests.
  const probes = [
    'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'video/mp4; codecs="hev1.1.6.L93.B0"',
    'video/mp4; codecs="hvc1.2.4.L120.B0"',
  ]
  _hevcMseSupported = probes.some((p) => isMimeSupported(p))
  return _hevcMseSupported
}

/**
 * Quick check: is the current browser Safari (which natively handles HLS
 * AND has hardware HEVC, bypassing MSE entirely)?
 */
export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Safari UA contains "Safari" but NOT "Chrome" and NOT "Android".
  // iOS Safari also reports "Version/" + "Mobile/".
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)
}

/**
 * Quick check: is this a mobile device?
 * Used to decide whether to surface the "use desktop" hint.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod|mobile|windows phone/i.test(navigator.userAgent)
}
