'use client'

import { useEffect, useRef, useCallback } from 'react'

// mpegts.js uses `window` at import time — must be dynamically imported
let mpegts: typeof import('mpegts.js') | null = null

async function loadMpegts() {
  if (!mpegts) {
    const mod = await import('mpegts.js')
    mpegts = mod.default || mod
  }
  return mpegts
}

// Detect if a URL is an HLS/m3u8 stream
function isHlsUrl(url: string): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    return pathname.includes('.m3u8') || pathname.includes('.m3u')
  } catch {
    return url.includes('.m3u8') || url.includes('.m3u')
  }
}

interface TsPlayerProps {
  src: string
  onReady?: () => void
  onError?: (error: string) => void
  onVideoRef?: (video: HTMLVideoElement | null) => void
  volume?: number
  muted?: boolean
  playbackRate?: number
  aspectMode?: 'fit' | 'stretch' | 'crop' | '16:9' | '4:3'
  onBuffering?: (isBuffering: boolean) => void
  deinterlace?: boolean
  // Fired when the browser cannot decode the stream's video codec via MSE
  // (e.g. HEVC/H.265 on Chrome/Firefox/Edge). The parent can use this to
  // fall back to a server-side transcoder (HEVC → H.264 HLS) so the stream
  // plays on ALL browsers, not just Safari.
  onCodecUnsupported?: () => void
}

export function TsPlayer({
  src,
  onReady,
  onError,
  onVideoRef,
  volume = 1,
  muted = false,
  playbackRate = 1,
  aspectMode = 'fit',
  onBuffering,
  deinterlace = false,
  onCodecUnsupported,
}: TsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<any>(null) // mpegts.Player type not available at import time
  const readyFiredRef = useRef(false)

  const cleanup = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.pause()
        playerRef.current.unload()
        playerRef.current.detachMediaElement()
        playerRef.current.destroy()
      } catch {
        // Ignore cleanup errors
      }
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    onVideoRef?.(video)
    cleanup()
    readyFiredRef.current = false

    let cancelled = false
    let retryCount = 0
    const maxRetries = 5
    // Declare reconnectTimer at the effect scope so the cleanup return function
    // can clear it. (The .then() callback assigns to this variable.)
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    // Determine stream type based on URL
    const streamType = isHlsUrl(src) ? 'hls' : 'mpegts'
    console.log(`[TsPlayer] Loading stream as ${streamType}: ${src}`)

    // Startup timeout — if no video data after 25s, report error
    const startupTimer = setTimeout(() => {
      if (!cancelled && !readyFiredRef.current) {
        console.error(`[TsPlayer] Startup timeout — no video data received after 25s`)
        onError?.('Stream could not be loaded. The server may be offline or blocking connections.')
        cleanup()
      }
    }, 25000)

    // Dynamically load mpegts.js (avoids SSR issues)
    loadMpegts().then((mpegtsLib) => {
      if (cancelled || !mpegtsLib) return

      // Check if mpegts.js is supported (requires MSE)
      if (!mpegtsLib.isSupported()) {
        // ── iOS Safari / browsers without MSE ──
        // mpegts.js requires Media Source Extensions (MSE). iOS Safari
        // doesn't support MSE for .ts streams, but it DOES support
        // native HLS playback via <video src>. For .ts URLs proxied
        // through our server with Content-Type: video/mp2t, iOS Safari
        // can play them natively using AVFoundation.
        //
        // However, the proxy URL includes /api/stream-proxy?url= which
        // returns Content-Type: video/mp2t — iOS Safari can play this
        // directly if the stream is H.264 (not HEVC).
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

        if (isIOS || isSafari) {
          console.log('[TsPlayer] mpegts.js not supported (no MSE) — using native video playback for iOS/Safari')
          // Use native <video> playback — Safari's AVFoundation handles .ts natively
          video.src = src
          video.load()
          video.play().catch(() => {
            // Autoplay blocked — user must click play
          })

          // Native video events
          const handleNativePlaying = () => {
            if (!readyFiredRef.current) {
              readyFiredRef.current = true
              clearTimeout(startupTimer)
              onReady?.()
            }
            onBuffering?.(false)
          }
          const handleNativeWaiting = () => { onBuffering?.(true) }
          const handleNativeCanPlay = () => { onBuffering?.(false) }
          const handleNativeError = () => {
            const err = video.error
            let msg = 'Native playback error'
            if (err) {
              switch (err.code) {
                case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error'; break
                case MediaError.MEDIA_ERR_DECODE: msg = 'Decode error'; break
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Stream format not supported on this device'; break
              }
            }
            console.error('[TsPlayer] Native video error:', msg)
            onError?.(msg)
          }

          video.addEventListener('playing', handleNativePlaying)
          video.addEventListener('waiting', handleNativeWaiting)
          video.addEventListener('canplay', handleNativeCanPlay)
          video.addEventListener('error', handleNativeError)
          return
        }

        // Not iOS/Safari and no MSE — genuinely unsupported
        onError?.('MPEG-TS playback is not supported in this browser. Try Safari (iOS/macOS).')
        return
      }

      // ─── Low-latency live MPEG-TS config (tuned for smooth playback) ───
      //
      // PROBLEM: The previous config set liveSyncDurationCount=6,
      // maxBufferLength=30, maxMaxBufferLength=120, bufferSize=120MB.
      // For a ~600 Kbps IPTV stream this meant the player tried to
      // pre-buffer 30–120s of video before/while playing — it could never
      // reach that target over a marginal connection, so it stayed
      // perpetually in the "buffering" state (spinner).
      //
      // FIX: Optimized all buffer targets for proxy + live streams:
      //   1. enableStashBuffer: TRUE — IO↔demuxer cushion absorbs jitter.
      //   2. stashInitialSize: 768KB — larger than 384KB to handle proxy
      //      latency. The proxy does 2MB burst buffering, so 768KB stash
      //      ensures the demuxer has a full cushion even after the burst.
      //   3. liveSyncDurationCount: 5 — play from 5 segments behind live
      //      edge. Value of 1–3 was TOO CLOSE: any proxy jitter dried up
      //      the buffer → spinner. With 5 segments (~10–30s), the player
      //      absorbs proxy latency spikes gracefully.
      //   4. liveMaxLatencyDurationCount: 18 — generous headroom. Previous
      //      value of 12 caused premature catch-up attempts → stutter.
      //   5. maxBufferLength: 45 — 45s forward buffer for proxy streams.
      //      30s was too thin when proxy latency spikes last 3–5s.
      //   6. maxMaxBufferLength: 180 — 3min hard cap; autoCleanup keeps
      //      actual usage much lower.
      //   7. bufferSize: 64MB — IO read buffer; absorbs bursty proxy data.
      //
      const player = mpegtsLib.createPlayer({
        type: streamType, // 'mpegts' for .ts streams, 'hls' for m3u8 streams
        url: src,
        isLive: true,
        cors: true,
        // Offload TS demuxing to a Web Worker so the main thread stays free.
        enableWorker: true,
        // ENABLE stash buffer — critical for smooth playback over proxy.
        // The stash buffer is the IO↔demuxer cushion. For proxy streams,
        // the data path is: upstream → proxy server → proxy HTTP → mpegts.js IO.
        // Each hop adds latency. 768KB stash absorbs ~1–8s of proxy jitter
        // at typical IPTV bitrates (600 Kbps–5 Mbps), giving the proxy time
        // to refill before the demuxer runs dry. The proxy's 2MB burst
        // buffering works WITH this stash: burst fills it quickly, then
        // the stash cushions gaps between bursts.
        enableStashBuffer: true,
        stashInitialSize: 768 * 1024, // 768KB — absorbs proxy hop jitter + burst drain
      }, {
        // --- Live latency management ---
        // Chasing DISABLED — was the #1 cause of "আগে পিছে হওয়া" (stutter /
        // fast-forward). mpegts.js would jump the playhead forward to reduce
        // latency, creating visible video glitches.
        liveBufferLatencyChasing: false,
        liveBufferLatencyChasingOnPaused: false,
        // liveSyncDurationCount: 5 — play from 5 segments behind live edge.
        //   Value of 1 was TOO CLOSE to live edge: any proxy jitter (even
        //   200ms) caused the buffer to dry up → spinner. Value of 3 was
        //   better but still too tight for high-latency proxy chains.
        //   With 5 segments of cushion (~10–30s depending on segment
        //   duration), the player has a comfortable gap that absorbs
        //   proxy hop latency without stalling. The extra latency is
        //   imperceptible for live TV.
        liveSyncDurationCount: 5,
        // liveMaxLatencyDurationCount: 18 — if latency grows beyond 18
        //   segments, the player may attempt internal recovery. Previous
        //   value of 12 caused premature catch-up attempts → stutter.
        //   With 18, the player tolerates much more lag before trying
        //   to recover, giving the proxy time to stabilize.
        liveMaxLatencyDurationCount: 18,

        // --- Buffer management (optimized for proxy + live streams) ---
        // Through a proxy, each fetch has added server latency. We need enough
        // forward buffer to absorb this without stalling.
        // 45s forward buffer — generous for live IPTV proxy. Gives mpegts.js
        //   enough runway to refill after a proxy latency spike without
        //   stalling. 30s was too thin: a 3–5s proxy delay + segment
        //   retransmit could drain the buffer faster than it refilled.
        // 180s hard cap — prevents SourceBuffer from hitting its hard limit.
        //   The autoCleanup mechanism keeps actual usage much lower.
        maxBufferLength: 45,
        maxMaxBufferLength: 180,  // 180s hard cap — generous for proxy streams
        bufferSize: 64 * 1000 * 1000, // 64MB IO buffer — absorbs bursty proxy data

        // --- Auto cleanup of old SourceBuffer segments ---
        // Critical for long viewing: without cleanup, SourceBuffer grows until
        // it hits the browser's hard limit and playback FREEZES completely.
        // With chasing OFF, this is the only mechanism that keeps buffer bounded.
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10,

        // --- NO lazy loading — causes periodic re-buffer cycles ---
        lazyLoad: false,

        // Stash buffer (also set here for older mpegts.js versions)
        enableStashBuffer: true,
        stashInitialSize: 768 * 1024, // 768KB — matches mediaDataSource setting

        // Fix audio/video timestamp gaps (common with flaky IPTV upstreams
        // that drop frames) — prevents gradual desync over long viewing.
        fixAudioTimestampGap: true,

        // Deinterlace
        ...(deinterlace ? { deinterlace: true } : {}),

        // For HLS streams
        ...(streamType === 'hls' ? {
          customSeekHandler: undefined,
        } : {}),
      })

      player.attachMediaElement(video)
      player.load()

      // --- Initial play attempt ---
      // The video element has autoPlay + playsInline. We also call play()
      // explicitly as a fallback. The VideoPlayer's onReady callback also
      // calls play(). If the browser blocks unmuted autoplay, the user can
      // click the play button in the controls.
      video.play().catch(() => {
        // Autoplay blocked — user must click play. This is expected on some
        // browsers when there was no recent user gesture.
      })

      // --- Auto-reconnect for live streams ---
      // Many IPTV upstream servers (e.g. rgkkw.live) close the HTTP connection
      // after ~60–90s. mpegts.js fires LOADING_COMPLETE when the stream ends.
      // For live streams we manually reload the player to re-fetch the stream,
      // creating a new connection to the upstream. Without this, the video
      // would freeze when the buffer runs dry after the connection closes.
      let reconnectCount = 0
      const MAX_RECONNECTS = 50  // ~enough for hours of viewing
      const scheduleReconnect = (reason: string) => {
        if (cancelled || reconnectCount >= MAX_RECONNECTS) return
        reconnectCount++
        const delay = Math.min(500 * reconnectCount, 3000) // 0.5s → 3s backoff
        console.log(`[TsPlayer] Auto-reconnect ${reconnectCount}/${MAX_RECONNECTS} in ${delay}ms (${reason})`)
        reconnectTimer = setTimeout(() => {
          if (cancelled || !playerRef.current) return
          try {
            // Unload + reload: creates a fresh fetch to the proxy/upstream
            playerRef.current.unload()
            playerRef.current.load()
            // Try to resume playback (browser may block unmuted autoplay, but
            // since the user already interacted with the page, it should work)
            playerRef.current.play().catch(() => {})
          } catch (e) {
            console.error('[TsPlayer] Reconnect failed:', e)
          }
        }, delay)
      }

      // Events
      player.on(mpegtsLib.Events.LOADING_COMPLETE, () => {
        // For live streams, the upstream connection ended. Auto-reconnect to
        // resume playback. (For VOD this means the video finished — don't reconnect.)
        if (streamType === 'mpegts' || streamType === 'hls') {
          scheduleReconnect('upstream connection ended (LOADING_COMPLETE)')
        }
      })

      player.on(mpegtsLib.Events.METADATA_ARRIVED, () => {
        if (!readyFiredRef.current) {
          readyFiredRef.current = true
          clearTimeout(startupTimer)
          onReady?.()
        }
      })

      // Use video events for ready state as fallback
      const handleLoadedData = () => {
        if (!readyFiredRef.current) {
          readyFiredRef.current = true
          clearTimeout(startupTimer)
          onReady?.()
        }
        video.removeEventListener('loadeddata', handleLoadedData)
      }
      video.addEventListener('loadeddata', handleLoadedData)

      const handlePlaying = () => {
        if (!readyFiredRef.current) {
          readyFiredRef.current = true
          onReady?.()
        }
        onBuffering?.(false)
      }
      video.addEventListener('playing', handlePlaying)

      const handleWaiting = () => {
        onBuffering?.(true)
      }
      video.addEventListener('waiting', handleWaiting)

      const handleCanPlay = () => {
        onBuffering?.(false)
      }
      video.addEventListener('canplay', handleCanPlay)

      // Error handling with auto-retry for network errors
      player.on(mpegtsLib.Events.ERROR, (_event: string, data: { info?: string; reason?: string; type?: string } | string) => {
        console.error('[TsPlayer] mpegts.js ERROR:', JSON.stringify(data))

        // mpegts.js sometimes passes data as a plain string (e.g.
        // "MediaMSEError") and sometimes as an object { type, info, reason }.
        // Normalize both into a type + message for uniform handling.
        const isStringData = typeof data === 'string'
        const errorType = isStringData ? data : data?.type
        const errMsg = isStringData
          ? data
          : (data?.info || data?.reason || `${streamType.toUpperCase()} playback error`)

        // ── MediaMSEError: codec not supported by the browser ──
        // Most commonly this is HEVC/H.265 video (codecs="hvc1...") which
        // Chrome/Firefox/Edge cannot decode via MSE. Safari CAN, so the same
        // stream may play fine on macOS/iOS but fail here.
        //
        // If the parent provided an onCodecUnsupported callback, fire it so
        // the parent can fall back to a server-side transcoder (HEVC → H.264
        // HLS) — this makes the stream play on ALL browsers. If no callback
        // is provided, show a user-friendly error message.
        if (errorType === 'MediaMSEError' || /addSourceBuffer|codec|unsupported|hvc1|hev1|hevc/i.test(errMsg)) {
          console.error('[TsPlayer] Codec/MSE not supported:', errMsg)
          if (onCodecUnsupported) {
            onCodecUnsupported()
          } else {
            onError?.(
              'This stream uses a video codec (likely HEVC/H.265) that your browser cannot play. ' +
              'Try Safari (macOS/iOS) or switch to a different channel.'
            )
          }
          return
        }

        // Auto-retry for network/connection errors
        if ((errorType === 'NetworkError' || errMsg.includes('network') || errMsg.includes('Network') || errMsg.includes('Early-EOF') || errMsg.includes('timeout') || errMsg.includes('Interrupted')) && retryCount < maxRetries) {
          retryCount++
          console.log(`[TsPlayer] Auto-retry ${retryCount}/${maxRetries} after error: ${errMsg}`)
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 8000)
          setTimeout(() => {
            if (!cancelled && playerRef.current) {
              try {
                playerRef.current.unload()
                playerRef.current.load()
                playerRef.current.play()
              } catch {
                onError?.(errMsg)
              }
            }
          }, delay)
          return
        }

        onError?.(errMsg)
      })

      // Video element error handler with AUTO-RETRY for transient errors.
      // MEDIA_ERR_DECODE (code 3) and MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)
      // are often transient — caused by SourceBuffer overflow, codec init
      // timing, or brief network interruption during live streaming.
      // They resolve on retry (the user confirmed: retry works!), so we
      // auto-retry up to 5 times before giving up.
      let videoRetryCount = 0
      const MAX_VIDEO_RETRIES = 5
      const handleVideoError = () => {
        const err = video.error
        let msg = `${streamType.toUpperCase()} playback error`
        let isTransient = false

        if (err) {
          switch (err.code) {
            case MediaError.MEDIA_ERR_ABORTED: msg = 'Playback aborted'; break
            case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error — stream unavailable'; break
            case MediaError.MEDIA_ERR_DECODE:
              msg = 'Decode error — retrying...'
              isTransient = true  // Often transient in live streams
              break
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              msg = 'Stream format error — retrying...'
              isTransient = true  // Often transient in live streams
              break
          }
        }

        if (isTransient && videoRetryCount < MAX_VIDEO_RETRIES && playerRef.current) {
          videoRetryCount++
          const delay = Math.min(1000 * videoRetryCount, 5000)
          console.log(`[TsPlayer] Transient video error (code ${err?.code}), auto-retry ${videoRetryCount}/${MAX_VIDEO_RETRIES} in ${delay}ms`)
          onBuffering?.(true)  // Show buffering indicator during retry

          setTimeout(() => {
            if (!cancelled && playerRef.current) {
              try {
                playerRef.current.unload()
                playerRef.current.load()
                playerRef.current.play().catch(() => {})
              } catch {
                onError?.(msg)
              }
            }
          }, delay)
          return
        }

        console.error('[TsPlayer] Video element error:', msg, `(retries exhausted: ${videoRetryCount}/${MAX_VIDEO_RETRIES})`)
        onError?.(msg)
      }
      video.addEventListener('error', handleVideoError)

      playerRef.current = player
    }).catch((e) => {
      if (!cancelled) {
        console.error('[TsPlayer] Failed to load mpegts.js:', e)
        onError?.('Failed to load MPEG-TS player')
      }
    })

    return () => {
      cancelled = true
      clearTimeout(startupTimer)
      // Clear any pending reconnect timer so it doesn't fire after unmount
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      cleanup()
    }
  }, [src, cleanup, onReady, onError, onVideoRef, onBuffering, onCodecUnsupported])

  // Apply volume, muted, and playback rate
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
    video.playbackRate = playbackRate
  }, [volume, muted, playbackRate])

  // Compute video style based on aspect mode
  // For '16:9' and '4:3' we use a wrapper div with the target aspect ratio
  // so the video frames correctly even when the parent is not that ratio.
  const isFixedAspect = aspectMode === '16:9' || aspectMode === '4:3'

  const videoStyle: React.CSSProperties = (() => {
    switch (aspectMode) {
      case 'stretch':
        return { objectFit: 'fill' }
      case 'crop':
        return { objectFit: 'cover' }
      case '16:9':
        return { objectFit: 'contain' }
      case '4:3':
        return { objectFit: 'contain' }
      case 'fit':
      default:
        return { objectFit: 'contain' }
    }
  })()

  const wrapperStyle: React.CSSProperties = isFixedAspect
    ? { aspectRatio: aspectMode === '16:9' ? '16/9' : '4/3', maxWidth: '100%', maxHeight: '100%', margin: '0 auto' }
    : {}

  if (isFixedAspect) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div style={wrapperStyle} className="w-full h-full">
          <video
            ref={videoRef}
            className="w-full h-full"
            style={videoStyle}
            playsInline
            autoPlay
          />
        </div>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className="w-full h-full"
      style={videoStyle}
      playsInline
      autoPlay
    />
  )
}
