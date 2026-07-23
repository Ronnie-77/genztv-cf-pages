'use client'

import { useEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'

interface JwHlsPlayerProps {
  src: string               // The original m3u8 URL (direct)
  proxySrc: string           // The proxied URL (/api/stream-proxy?url=...)
  onReady?: () => void
  onError?: (error: string) => void
  onVideoRef?: (video: HTMLVideoElement | null) => void
  volume?: number
  muted?: boolean
  playbackRate?: number
  aspectMode?: 'fit' | 'stretch' | 'crop' | '16:9' | '4:3'
  onBuffering?: (isBuffering: boolean) => void
}

/**
 * JW-style HLS Player for m3u8 streams that don't work with the regular HlsPlayer.
 *
 * STRATEGY:
 * 1. Direct FIRST — tries the original URL directly
 *    If the server allows CORS, this works and is fastest.
 *
 * 2. Proxy — uses /api/stream-proxy to bypass CORS
 *    The stream-proxy rewrites all URLs in m3u8 to go through itself.
 *
 * 3. Native HLS — Safari/iOS only
 */

type PlayerMode = 'none' | 'proxy' | 'direct' | 'native'

export function JwHlsPlayer({
  src,
  proxySrc,
  onReady,
  onError,
  onVideoRef,
  volume = 1,
  muted = false,
  playbackRate = 1,
  aspectMode = 'fit',
  onBuffering,
}: JwHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const readyFiredRef = useRef(false)
  const mediaErrorCountRef = useRef(0)
  const destroyedRef = useRef(false)
  const triedModesRef = useRef<Set<PlayerMode>>(new Set())

  const directTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cb = useRef({ onReady, onError, onBuffering, proxySrc })
  useEffect(() => {
    cb.current = { onReady, onError, onBuffering, proxySrc }
  })

  const cleanup = useCallback(() => {
    destroyedRef.current = true
    if (directTimeoutRef.current) {
      clearTimeout(directTimeoutRef.current)
      directTimeoutRef.current = null
    }
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  function fireReady() {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true
      cb.current.onReady?.()
    }
  }

  function finalError(msg: string) {
    console.error(`[jw-hls-player] FATAL: ${msg}`)
    cb.current.onError?.(msg)
    cleanup()
  }

  function createHls(url: string, mode: 'proxy' | 'direct'): Hls | null {
    if (!Hls.isSupported()) return null

    const isProxy = mode === 'proxy'

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      maxBufferSize: 120 * 1000000,
      maxBufferHole: 0.5,

      abrEwmaDefaultEstimate: 500000,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      abrMaxWithRealBitrate: true,

      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      liveDurationInfinity: true,
      progressive: true,

      // More retries and longer timeouts for proxy mode (server-side fetch)
      fragLoadingMaxRetry: isProxy ? 6 : 3,
      fragLoadingMaxRetryTimeout: 30000,
      fragLoadingTimeOut: 30000,

      manifestLoadingMaxRetry: isProxy ? 4 : 2,
      manifestLoadingMaxRetryTimeout: 30000,
      manifestLoadingTimeOut: isProxy ? 30000 : 15000,

      levelLoadingMaxRetry: isProxy ? 4 : 2,
      levelLoadingMaxRetryTimeout: 30000,
      levelLoadingTimeOut: isProxy ? 30000 : 15000,

      startLevel: -1,

      // No custom headers for direct mode (avoids CORS preflight)
      xhrSetup: (xhr: XMLHttpRequest, reqUrl: string) => {
        if (isProxy || reqUrl.includes('/api/stream-proxy')) {
          try { xhr.setRequestHeader('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18') } catch {}
        }
      },
    })

    hls.loadSource(url)
    hls.attachMedia(videoRef.current!)

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      console.log(`[jw-hls-player] Manifest parsed (${mode}), ${data.levels.length} levels ✅`)
      // Clear the direct timeout if manifest is parsed
      if (directTimeoutRef.current) {
        clearTimeout(directTimeoutRef.current)
        directTimeoutRef.current = null
      }
      fireReady()
      videoRef.current?.play().catch(() => {})
    })

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (destroyedRef.current) return
      console.error(`[jw-hls-player] Error: type=${data.type}, details=${data.details}, fatal=${data.fatal}, mode=${mode}`)

      if (!data.fatal) return

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        mediaErrorCountRef.current += 1
        if (mediaErrorCountRef.current <= 3) {
          console.log(`[jw-hls-player] Media error recovery ${mediaErrorCountRef.current}/3`)
          hls.recoverMediaError()
        } else {
          tryNextMode(mode)
        }
      } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        tryNextMode(mode)
      } else {
        finalError('Stream error — try again later')
      }
    })

    return hls
  }

  function tryNextMode(failedMode: PlayerMode) {
    if (destroyedRef.current && !triedModesRef.current.has(failedMode)) return

    console.log(`[jw-hls-player] Mode '${failedMode}' failed, trying next...`)

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    destroyedRef.current = false
    mediaErrorCountRef.current = 0

    // Order: direct → proxy → native
    if (failedMode === 'direct' && !triedModesRef.current.has('proxy')) {
      startProxy()
    } else if (!triedModesRef.current.has('native')) {
      startNative()
    } else {
      finalError('Stream unavailable — all methods failed. Try opening the URL directly in a new browser tab.')
    }
  }

  // Step 1: Direct (PRIMARY — try original URL first for speed)
  function startDirect() {
    if (destroyedRef.current) return
    if (triedModesRef.current.has('direct')) {
      tryNextMode('direct')
      return
    }
    triedModesRef.current.add('direct')

    if (!Hls.isSupported()) {
      startProxy()
      return
    }

    console.log('[jw-hls-player] Step 1: Direct mode (original URL)')

    const hls = createHls(src, 'direct')
    if (hls) {
      hlsRef.current = hls
      // 10-second timeout: if manifest not parsed, switch to proxy
      directTimeoutRef.current = setTimeout(() => {
        if (readyFiredRef.current) return
        console.log('[jw-hls-player] Direct mode timed out (10s) → switching to proxy')
        if (hlsRef.current) {
          hlsRef.current.destroy()
          hlsRef.current = null
        }
        destroyedRef.current = false
        mediaErrorCountRef.current = 0
        startProxy()
      }, 10000)
    } else {
      tryNextMode('direct')
    }
  }

  // Step 2: Proxy (fallback — bypasses CORS, rewrites m3u8 URLs)
  function startProxy() {
    if (destroyedRef.current) return
    if (triedModesRef.current.has('proxy')) {
      tryNextMode('proxy')
      return
    }
    triedModesRef.current.add('proxy')

    if (!Hls.isSupported()) {
      startNative()
      return
    }

    const proxyUrl = cb.current.proxySrc
    if (!proxyUrl) {
      console.log('[jw-hls-player] No proxy URL, trying native')
      startNative()
      return
    }

    console.log('[jw-hls-player] Step 2: Proxy mode (/api/stream-proxy) — bypasses CORS ✨')

    const hls = createHls(proxyUrl, 'proxy')
    if (hls) {
      hlsRef.current = hls
    } else {
      startNative()
    }
  }

  // Step 3: Native HLS (Safari/iOS only)
  function startNative() {
    if (destroyedRef.current) return
    if (triedModesRef.current.has('native')) {
      finalError('Stream unavailable — all methods failed.')
      return
    }
    triedModesRef.current.add('native')

    const video = videoRef.current
    if (!video) { finalError('No video element'); return }

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl')
    if (!nativeHls) {
      finalError('Stream unavailable — browser cannot play this format.')
      return
    }

    console.log('[jw-hls-player] Step 3: Native HLS (Safari/iOS)')
    video.src = src

    const handleLoadedMetadata = () => {
      console.log('[jw-hls-player] Native HLS working! ✅')
      fireReady()
      video.play().catch(() => {})
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
      clearTimeout(nativeTimeout)
    }

    const handleError = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
      clearTimeout(nativeTimeout)
      video.removeAttribute('src')
      video.load()
      finalError('Stream unavailable — server may be offline.')
    }

    const nativeTimeout = setTimeout(() => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
      video.removeAttribute('src')
      video.load()
      finalError('Stream unavailable — connection timed out.')
    }, 10000)

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleError)
    video.play().catch(() => {})
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    onVideoRef?.(video)

    cleanup()
    readyFiredRef.current = false
    mediaErrorCountRef.current = 0
    destroyedRef.current = false
    triedModesRef.current = new Set()

    const handleWaiting = () => onBuffering?.(true)
    const handlePlaying = () => { onBuffering?.(false); fireReady() }
    const handleCanPlay = () => onBuffering?.(false)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('canplay', handleCanPlay)

    // Start with direct → proxy → native
    startDirect()

    return () => {
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('canplay', handleCanPlay)
      cleanup()
    }
  }, [src, proxySrc])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = volume
    v.muted = muted
    v.playbackRate = playbackRate
  }, [volume, muted, playbackRate])

  // Aspect ratio wrapper + video style
  // For '16:9' and '4:3' we use a wrapper div with the target aspect ratio
  // so the video frames correctly even when the parent is not that ratio.
  const isFixedAspect = aspectMode === '16:9' || aspectMode === '4:3'

  const videoStyle: React.CSSProperties = (() => {
    switch (aspectMode) {
      case 'stretch': return { objectFit: 'fill' }
      case 'crop': return { objectFit: 'cover' }
      case '16:9': return { objectFit: 'contain' }
      case '4:3': return { objectFit: 'contain' }
      default: return { objectFit: 'contain' }
    }
  })()

  const wrapperStyle: React.CSSProperties = isFixedAspect
    ? { aspectRatio: aspectMode === '16:9' ? '16/9' : '4/3', maxWidth: '100%', maxHeight: '100%', margin: '0 auto' }
    : {}

  if (isFixedAspect) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div style={wrapperStyle} className="w-full h-full">
          <video ref={videoRef} className="w-full h-full" style={videoStyle} playsInline autoPlay />
        </div>
      </div>
    )
  }

  return (
    <video ref={videoRef} className="w-full h-full" style={videoStyle} playsInline autoPlay />
  )
}
