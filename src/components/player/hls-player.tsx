'use client'

import { useEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'
import {
  checkHlsCodecCompatibility,
  isHevcMseSupported,
  isSafariBrowser,
  isMobileDevice,
} from '@/lib/codec-check'

export interface QualityLevel {
  index: number
  width: number
  height: number
  bitrate: number
  label: string
}

export interface HlsStats {
  bandwidth: number
  bufferLength: number
  droppedFrames: number
  currentLevel: number
  autoLevelEnabled: boolean
}

export interface LiveStatus {
  isLive: boolean
  liveSyncPosition: number | null
  isBehindLive: boolean
}

export interface AudioTrack {
  id: number
  lang: string
  name: string
  default: boolean
}

export interface SubtitleTrack {
  id: number
  lang: string
  name: string
  default: boolean
}

export type LoadMode = 'direct' | 'proxy' | 'mpegts'

interface HlsPlayerProps {
  src: string
  originalUrl?: string
  proxyUrl?: string
  onReady?: () => void
  onError?: (error: string) => void
  onQualityLevels?: (levels: QualityLevel[]) => void
  onStatsUpdate?: (stats: HlsStats) => void
  onVideoRef?: (video: HTMLVideoElement | null) => void
  selectedQuality?: number
  volume?: number
  muted?: boolean
  playbackRate?: number
  aspectMode?: 'fit' | 'stretch' | 'crop' | '16:9' | '4:3'
  onLiveStatus?: (status: LiveStatus) => void
  seekToLive?: boolean
  onSeekedToLive?: () => void
  onBuffering?: (isBuffering: boolean) => void
  selectedAudioTrack?: number
  onAudioTracks?: (tracks: AudioTrack[]) => void
  selectedSubtitleTrack?: number
  onSubtitleTracks?: (tracks: SubtitleTrack[]) => void
  onLoadModeChange?: (mode: LoadMode) => void
  onRequestMpegts?: () => void
  /** Called whenever hls.js switches to a different quality level (via ABR
   *  auto-selection OR manual selection). The parent uses this to display
   *  "Auto (1080p)" in the settings Quality row — showing the user which
   *  resolution ABR has currently chosen, even when the user selected "Auto". */
  onCurrentLevelChange?: (level: number) => void
  /** Called when codec detection proves the browser can't decode this stream
   *  (typically HEVC on mobile Chrome/Firefox). Parent should offer iframe
   *  fallback or a clear error message. */
  onCodecUnsupported?: (info: {
    hasHevc: boolean
    hasAv1: boolean
    summary: string
    isMobile: boolean
    isSafari: boolean
    hevcMseSupported: boolean
  }) => void
}

function buildQualityLabel(height: number, bitrate: number): string {
  let label = ''
  if (height >= 2160) label = '4K'
  else if (height >= 1440) label = '1440p'
  else if (height >= 1080) label = '1080p'
  else if (height >= 720) label = '720p'
  else if (height >= 480) label = '480p'
  else if (height >= 360) label = '360p'
  else if (height >= 240) label = '240p'
  else label = `${height}p`

  if (bitrate > 0) {
    const mbps = (bitrate / 1000000).toFixed(1)
    label += ` · ${mbps}Mbps`
  }
  return label
}

function buildStats(hlsInstance: Hls, video: HTMLVideoElement): HlsStats {
  const buffered = video.buffered
  let bufferLength = 0
  if (buffered.length > 0) {
    bufferLength = buffered.end(buffered.length - 1) - video.currentTime
  }
  return {
    bandwidth: hlsInstance.bandwidthEstimate || 0,
    bufferLength: Math.max(0, bufferLength),
    droppedFrames: (video as HTMLVideoElement & { getVideoPlaybackQuality?: () => { droppedVideoFrames?: number } }).getVideoPlaybackQuality?.()?.droppedVideoFrames || 0,
    currentLevel: hlsInstance.currentLevel,
    autoLevelEnabled: hlsInstance.autoLevelEnabled,
  }
}

export function HlsPlayer({
  src,
  originalUrl,
  proxyUrl,
  onReady,
  onError,
  onQualityLevels,
  onStatsUpdate,
  onVideoRef,
  selectedQuality = -1,
  volume = 1,
  muted = false,
  playbackRate = 1,
  aspectMode = 'fit',
  onLiveStatus,
  seekToLive,
  onSeekedToLive,
  onBuffering,
  selectedAudioTrack = -1,
  onAudioTracks,
  selectedSubtitleTrack = -1,
  onSubtitleTracks,
  onLoadModeChange,
  onRequestMpegts,
  onCurrentLevelChange,
  onCodecUnsupported,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadModeRef = useRef<LoadMode>('direct')
  const triedProxyRef = useRef(false)
  const triedMpegtsRef = useRef(false)
  const directTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manifestParsedRef = useRef(false)
  const fatalErrorCountRef = useRef(0)
  const mediaErrorCountRef = useRef(0)

  // ── Auto-reconnect / stall-detection state ──
  // When a live stream stops delivering segments (upstream goes down,
  // CDN stalls, or the video element fires "ended" unexpectedly), hls.js
  // may not always emit a fatal error. The stream just freezes. We detect
  // this by watching currentTime: if it hasn't advanced in 10s while the
  // video claims to be playing, we attempt an automatic reconnect.
  const stallWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCurrentTimeRef = useRef(0)
  const stalledSinceRef = useRef<number | null>(null)  // timestamp when stall started
  const reconnectCountRef = useRef(0)
  const MAX_AUTO_RECONNECTS = 5
  const STALL_THRESHOLD_SEC = 10  // seconds of no progress before reconnect
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable refs for callbacks
  const cb = useRef({
    onReady, onError, onQualityLevels, onStatsUpdate,
    onAudioTracks, onSubtitleTracks, onLoadModeChange, onRequestMpegts,
    onCurrentLevelChange, onCodecUnsupported, proxyUrl,
  })
  useEffect(() => {
    cb.current = {
      onReady, onError, onQualityLevels, onStatsUpdate,
      onAudioTracks, onSubtitleTracks, onLoadModeChange, onRequestMpegts,
      onCurrentLevelChange, onCodecUnsupported, proxyUrl,
    }
  })

  const cleanup = useCallback(() => {
    if (directTimeoutRef.current) {
      clearTimeout(directTimeoutRef.current)
      directTimeoutRef.current = null
    }
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (stallWatchdogRef.current) {
      clearInterval(stallWatchdogRef.current)
      stallWatchdogRef.current = null
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    lastCurrentTimeRef.current = 0
    stalledSinceRef.current = null
  }, [])

  // Create HLS.js instance — configuration MATCHES hls.js demo page defaults.
  //
  // Previous versions had aggressive overrides (low retries, short timeouts,
  // small backBuffer) that caused buffering on CDN streams that played smoothly
  // on the hls.js demo page. The demo uses hls.js built-in defaults with only
  // 4 overrides: debug, enableWorker, lowLatencyMode, backBufferLength=90.
  // We now match that philosophy: use hls.js defaults for everything except
  // what we genuinely need to customize (iOS MMS, fallback chain, proxy).
  //
  // Key differences from PREVIOUS config that caused buffering:
  //   backBufferLength: 30→90 (demo uses 60*1.5)
  //   fragLoadingMaxRetry: 1→6 (hls.js default)
  //   levelLoadingMaxRetry: 0→4 (hls.js default)
  //   manifestLoadingMaxRetry: 0→1 (hls.js default)
  //   fragLoadingTimeOut: 10000→32000 (hls.js default)
  //   levelLoadingTimeOut: 8000→10000 (hls.js default)
  //   manifestLoadingTimeOut: 8000→10000 (hls.js default)
  //   abrEwmaDefaultEstimate: 1500000→524288 (hls.js default — ABR auto-upswitches fast)
  //   abrMaxWithRealBitrate: true→false (hls.js default — avoids aggressive downswitch)
  //   xhrSetup: VLC UA → removed for direct mode (browsers ignore it anyway)
  function createHls(url: string, video: HTMLVideoElement, isDirect: boolean): Hls | null {
    if (!Hls.isSupported()) return null

    // ── hls.js demo page defaults (from github.com/video-dev/hls.js/demo/main.js) ──
    // The demo only overrides these 4 values; everything else uses hls.js built-in defaults.
    const demoDefaults = {
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90, // demo: 60 * 1.5 = 90
    }

    // ── Our custom overrides on top of demo defaults ──
    // Only override what we genuinely need for our app's fallback chain,
    // iOS support, and proxy mode. DO NOT override hls.js defaults that
    // we previously set too aggressively (retries, timeouts, ABR).
    const ourOverrides: Record<string, unknown> = {
      // ── iOS / Managed Media Source ──
      // These only affect iOS 17.1+ and are harmless on other platforms.
      preferManagedMediaSource: true,
      useMMS: true,
      enableSoftKfKey: true,

      // ── Live sync — tuned for smooth m3u8 playback ──
      // liveSyncDurationCount: 3 (hls.js default) — start after 3 segments.
      //   Lower values (1) cause frequent rebuffering on slow CDNs because
      //   the player tries to start before enough data is buffered.
      // liveMaxLatencyDurationCount: Infinity — MUST stay Infinity!
      //   Any finite value causes hls.js to forcefully seek the playhead
      //   forward when latency exceeds the threshold, creating the "আগে
      //   পিছে হওয়া" (stutter/jump) symptom the user reported for m3u8.
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: Infinity, // MUST be Infinity — any finite value causes forced seek-forward stutters
      liveDurationInfinity: true,
      progressive: true,
      startLevel: -1,

      // ── Buffer management for m3u8 streams ──
      // These help reduce buffering on CDN streams with variable latency.
      // maxBufferLength: 30 — 30s forward buffer, enough to absorb CDN jitter.
      //   hls.js default is 30s which is fine, but we make it explicit.
      // maxMaxBufferLength: 600 — allows the buffer to grow when bandwidth
      //   is good, preventing the "buffer spinner during high-bitrate segments"
      //   issue. hls.js default is 600s.
      // backBufferLength: 90 — keeps 90s of backward buffer for seeking,
      //   auto-cleans anything older (same as demo page).
      maxBufferLength: 30,
      maxMaxBufferLength: 600,

      // ── Proxy mode: faster timeouts for fallback chain ──
      // In PROXY mode only, we reduce retries/timeouts because the proxy adds
      // latency and we want to fail-fast to mpegts fallback.
      // In DIRECT mode, we use hls.js BUILT-IN defaults (6 retries, 32s timeout)
      // which match the demo page and give CDN streams the best chance.
      ...(isDirect ? {} : {
        fragLoadingMaxRetry: 2,
        fragLoadingMaxRetryTimeout: 6000,
        fragLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 0,
        manifestLoadingMaxRetryTimeout: 5000,
        manifestLoadingTimeOut: 5000,
        levelLoadingMaxRetry: 1,
        levelLoadingMaxRetryTimeout: 5000,
        levelLoadingTimeOut: 5000,
      }),
    }

    return new Hls({ ...demoDefaults, ...ourOverrides })
  }

  // Initialize HLS with URL and attach all event handlers
  function initHls(url: string, video: HTMLVideoElement, isDirect: boolean): Hls | null {
    const hls = createHls(url, video, isDirect)
    if (!hls) return null

    hls.loadSource(url)
    hls.attachMedia(video)

    // ── Manifest Parsed ──
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      console.log(`[hls-player] ✅ Manifest parsed (${loadModeRef.current}), ${data.levels.length} levels`)

      // ── Codec compatibility check ──
      // This is the critical fix for the mobile Chrome "stream format not
      // supported" bug: Toffee Live ships HEVC, which desktop Chrome can
      // hardware-decode but mobile Chrome cannot feed through MSE.
      // Detect this BEFORE we attach the video element, so we can fall
      // back to iframe / mpegts / a clear error message instead of
      // surfacing a confusing mediaError 5 seconds later.
      const codecInfo = checkHlsCodecCompatibility(
        data.levels.map((l) => ({
          videoCodec: l.videoCodec,
          audioCodec: l.audioCodec,
          width: l.width || undefined,
          height: l.height || undefined,
          bitrate: l.bitrate || undefined,
        }))
      )
      console.log(`[hls-player] 🎞️ Codec check: ${codecInfo.summary}`)

      if (!codecInfo.playable) {
        // Browser cannot decode ANY level's codec via MSE.
        // Notify parent BEFORE we try to play, so the parent can show
        // an iframe fallback / clear error.
        cb.current.onCodecUnsupported?.({
          hasHevc: codecInfo.hasHevc,
          hasAv1: codecInfo.hasAv1,
          summary: codecInfo.summary,
          isMobile: isMobileDevice(),
          isSafari: isSafariBrowser(),
          hevcMseSupported: isHevcMseSupported(),
        })

        // If the suggested fallback is mpegts, request it (mpegts.js has
        // its own demuxer and may handle MPEG-TS HEVC on some platforms).
        // If it's iframe, the parent will swap the player — we just stop.
        if (codecInfo.fallback === 'mpegts' && !triedMpegtsRef.current) {
          console.log('[hls-player] 🔄 Codec unsupported → requesting mpegts.js fallback')
          switchToMpegts()
          return
        }
        // Iframe fallback or no fallback — let parent decide. We do NOT
        // call onReady here, so the player stays in "loading" state until
        // the parent swaps the player.
        return
      }

      // Mark manifest as parsed and clear the direct-mode timeout
      manifestParsedRef.current = true
      if (directTimeoutRef.current) {
        clearTimeout(directTimeoutRef.current)
        directTimeoutRef.current = null
      }

      // Start the stall watchdog now that the stream is live.
      // This detects when the stream freezes without a fatal error
      // (e.g., upstream stops sending segments, CDN stalls).
      startStallWatchdogFnRef.current?.(video)

      const levels: QualityLevel[] = data.levels.map((level, index) => ({
        index, width: level.width || 0, height: level.height || 0, bitrate: level.bitrate || 0,
        label: buildQualityLabel(level.height || 0, level.bitrate || 0),
      }))
      cb.current.onQualityLevels?.(levels)

      if (hls.audioTracks?.length > 0) {
        cb.current.onAudioTracks?.(hls.audioTracks.map((t, i) => ({
          id: i, lang: t.lang || '', name: t.name || t.lang || `Track ${i + 1}`, default: t.default || false,
        })))
      }
      if (hls.subtitleTracks?.length > 0) {
        cb.current.onSubtitleTracks?.(hls.subtitleTracks.map((t, i) => ({
          id: i, lang: t.lang || '', name: t.name || t.lang || `Subtitle ${i + 1}`, default: t.default || false,
        })))
      }

      cb.current.onReady?.()
    })

    // ── Stats Updates ──
    // LEVEL_SWITCHED fires whenever hls.js switches to a different quality
    // level — either via ABR auto-selection OR a manual `currentLevel` set.
    // We report the new level index to the parent so it can display
    // "Auto (1080p)" in the settings Quality row, showing the user which
    // resolution ABR has currently chosen.
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      if (hlsRef.current) {
        cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video))
        const levelIndex = data?.level ?? hlsRef.current.currentLevel
        if (levelIndex !== undefined && levelIndex >= 0) {
          cb.current.onCurrentLevelChange?.(levelIndex)
        }
      }
    })
    hls.on(Hls.Events.FRAG_LOADED, () => { if (hlsRef.current) cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video)) })

    // ── Track Updates ──
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (!hlsRef.current) return
      const inst = hlsRef.current
      if (inst.audioTracks?.length > 0) {
        cb.current.onAudioTracks?.(inst.audioTracks.map((t: { lang?: string; name?: string; default?: boolean }, i: number) => ({
          id: i, lang: t.lang || '', name: t.name || t.lang || `Track ${i + 1}`, default: t.default || false,
        })))
      }
    })
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      if (!hlsRef.current) return
      const inst = hlsRef.current
      if (inst.subtitleTracks?.length > 0) {
        cb.current.onSubtitleTracks?.(inst.subtitleTracks.map((t: { lang?: string; name?: string; default?: boolean }, i: number) => ({
          id: i, lang: t.lang || '', name: t.name || t.lang || `Subtitle ${i + 1}`, default: t.default || false,
        })))
      }
    })

    // ── Error Handler with aggressive fallback ──
    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error(`[hls-player] ❌ Error: type=${data.type}, details=${data.details}, fatal=${data.fatal}, mode=${loadModeRef.current}`)

      if (!data.fatal) {
        console.warn(`[hls-player] Non-fatal: ${data.details}`)
        return
      }

      // Fatal error — take action
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        handleFatalNetworkError(video)
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        handleFatalMediaError(hls, video)
      } else {
        cb.current.onError?.('Fatal stream error — try a different channel')
        cleanup()
      }
    })

    return hls
  }

  // Handle fatal network errors with aggressive fallback
  // Fallback chain: direct → proxy → mpegts
  function handleFatalNetworkError(video: HTMLVideoElement) {
    fatalErrorCountRef.current += 1
    const mode = loadModeRef.current

    if (mode === 'direct') {
      // KEY: Direct connection failed — switch to proxy mode IMMEDIATELY
      // The browser couldn't reach the stream directly, try through our server proxy
      if (!triedProxyRef.current && cb.current.proxyUrl) {
        console.log('[hls-player] 🔄 Direct failed → trying proxy connection')
        triedProxyRef.current = true
        loadModeRef.current = 'proxy'
        cb.current.onLoadModeChange?.('proxy')
        fatalErrorCountRef.current = 0
        mediaErrorCountRef.current = 0

        // Destroy direct HLS and create proxy HLS
        cleanup()
        const proxyHls = initHls(cb.current.proxyUrl, video, false)
        if (proxyHls) {
          hlsRef.current = proxyHls
        } else {
          cb.current.onError?.('Failed to create proxy HLS player')
        }
      } else if (!triedMpegtsRef.current) {
        // Skip proxy if already tried, go to mpegts
        console.log('[hls-player] 🔄 Direct failed → trying mpegts.js')
        switchToMpegts()
      } else {
        finalError('Direct connection failed and no fallback available')
      }
    } else if (mode === 'proxy') {
      // In proxy mode — switch to mpegts.js on first fatal error
      if (!triedMpegtsRef.current) {
        console.log('[hls-player] 🔄 Proxy failed → trying mpegts.js')
        switchToMpegts()
      } else {
        finalError('Could not connect to stream server. It may be offline or blocking connections.')
      }
    } else {
      finalError('Network error — stream unavailable')
    }
  }

  // Handle fatal media errors
  function handleFatalMediaError(hls: Hls, video: HTMLVideoElement) {
    mediaErrorCountRef.current += 1
    if (mediaErrorCountRef.current <= 3) {
      console.log(`[hls-player] Media error recovery ${mediaErrorCountRef.current}/3`)
      hls.recoverMediaError()
    } else {
      // Try recreating the player
      const mode = loadModeRef.current
      console.log(`[hls-player] Media error too many times, recreating player (mode=${mode})`)
      const url = mode === 'direct' ? src : (cb.current.proxyUrl || hlsRef.current?.url || src)
      cleanup()
      mediaErrorCountRef.current = 0
      const newHls = initHls(url, video, mode === 'direct')
      if (newHls) {
        hlsRef.current = newHls
      } else {
        cb.current.onError?.('Media error — stream format not supported')
      }
    }
  }

  // Switch to mpegts.js mode
  function switchToMpegts() {
    triedMpegtsRef.current = true
    loadModeRef.current = 'mpegts'
    cb.current.onLoadModeChange?.('mpegts')
    cleanup()
    cb.current.onRequestMpegts?.()
  }

  // Show final error after all methods exhausted
  function finalError(msg: string) {
    console.error(`[hls-player] 💀 ${msg}`)
    cb.current.onError?.(msg)
    cleanup()
  }

  // ── Auto-reconnect / stall-detection functions ──
  // We use refs to break the circular dependency between autoReconnect
  // and startStallWatchdog (each calls the other).
  const autoReconnectFnRef = useRef<(video: HTMLVideoElement, reason: string) => void>()
  const startStallWatchdogFnRef = useRef<(video: HTMLVideoElement) => void>()

  // ── Auto-reconnect: destroy current HLS instance and recreate ──
  // This is called when the stall watchdog detects the stream has frozen
  // or when the video element fires "ended" on a live stream.
  const autoReconnect = useCallback((video: HTMLVideoElement, reason: string) => {
    if (reconnectCountRef.current >= MAX_AUTO_RECONNECTS) {
      console.error(`[hls-player] 💀 Max reconnects (${MAX_AUTO_RECONNECTS}) reached after: ${reason}`)
      cb.current.onError?.('Stream stopped — click Retry to reconnect')
      return
    }

    reconnectCountRef.current += 1
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current - 1), 16000)
    console.log(`[hls-player] 🔄 Auto-reconnect #${reconnectCountRef.current}/${MAX_AUTO_RECONNECTS} in ${delay}ms — reason: ${reason}`)

    // Clear stall state
    lastCurrentTimeRef.current = 0
    stalledSinceRef.current = null

    reconnectTimerRef.current = setTimeout(() => {
      if (!videoRef.current) return
      const mode = loadModeRef.current
      const url = mode === 'proxy' ? (cb.current.proxyUrl || src) : src

      // Destroy and recreate (partial cleanup — keep refs intact)
      if (statsTimerRef.current) { clearInterval(statsTimerRef.current); statsTimerRef.current = null }
      if (stallWatchdogRef.current) { clearInterval(stallWatchdogRef.current); stallWatchdogRef.current = null }
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }

      const newHls = initHls(url, videoRef.current, mode === 'direct')
      if (newHls) {
        hlsRef.current = newHls
        // Restart stats timer
        statsTimerRef.current = setInterval(() => {
          if (!hlsRef.current) return
          cb.current.onStatsUpdate?.(buildStats(hlsRef.current, videoRef.current!))
        }, 2000)
        // Restart stall watchdog via ref (breaks circular dep)
        startStallWatchdogFnRef.current?.(videoRef.current)
      } else {
        cb.current.onError?.('Failed to reconnect — click Retry')
      }
    }, delay)
  }, [src])

  // Keep ref in sync
  autoReconnectFnRef.current = autoReconnect

  // ── Stall watchdog: detects when video stops advancing ──
  const startStallWatchdog = useCallback((video: HTMLVideoElement) => {
    if (stallWatchdogRef.current) {
      clearInterval(stallWatchdogRef.current)
      stallWatchdogRef.current = null
    }
    lastCurrentTimeRef.current = 0
    stalledSinceRef.current = null

    stallWatchdogRef.current = setInterval(() => {
      // Only check if HLS instance exists and manifest has been parsed
      if (!hlsRef.current || !manifestParsedRef.current) return

      const currentTime = video.currentTime
      const isPaused = video.paused
      const isEnded = video.ended

      // Reset reconnect count on successful progress
      if (currentTime !== lastCurrentTimeRef.current && !isPaused) {
        if (reconnectCountRef.current > 0) {
          console.log(`[hls-player] ✅ Stream recovered after ${reconnectCountRef.current} reconnect(s) — resetting counter`)
          reconnectCountRef.current = 0
        }
        lastCurrentTimeRef.current = currentTime
        stalledSinceRef.current = null
        return
      }

      // Video is progressing but paused — not a stall
      if (isPaused || isEnded) {
        lastCurrentTimeRef.current = currentTime
        stalledSinceRef.current = null
        return
      }

      // currentTime hasn't changed while playing → possible stall
      if (currentTime === lastCurrentTimeRef.current) {
        const now = Date.now()
        if (stalledSinceRef.current === null) {
          stalledSinceRef.current = now
        }
        const stallDuration = (now - stalledSinceRef.current) / 1000
        if (stallDuration >= STALL_THRESHOLD_SEC) {
          console.warn(`[hls-player] ⚠️ Stall detected: no progress for ${stallDuration.toFixed(1)}s`)
          // Call autoReconnect via ref (breaks circular dep)
          autoReconnectFnRef.current?.(video, `Stream stalled for ${stallDuration.toFixed(0)}s`)
        }
      } else {
        lastCurrentTimeRef.current = currentTime
        stalledSinceRef.current = null
      }
    }, 3000)  // Check every 3s
  }, [])

  // Keep ref in sync — this is a standard "latest ref" pattern used to break
  // circular useCallback dependencies. The eslint-disable is necessary because
  // the strict immutability rule doesn't recognize this intentional mutation.
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { startStallWatchdogFnRef.current = startStallWatchdog })

  // ── Main Effect: Initialize player ──
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    onVideoRef?.(video)

    // Reset state
    cleanup()
    fatalErrorCountRef.current = 0
    mediaErrorCountRef.current = 0
    triedProxyRef.current = false
    triedMpegtsRef.current = false
    manifestParsedRef.current = false
    reconnectCountRef.current = 0
    loadModeRef.current = 'direct'
    cb.current.onLoadModeChange?.('direct')

    // Buffering events
    const handleWaiting = () => onBuffering?.(true)
    const handlePlaying = () => onBuffering?.(false)
    const handleCanPlay = () => onBuffering?.(false)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('canplay', handleCanPlay)

    // Handle unexpected "ended" event on a live stream.
    // For live content, the video should never end. If it does, the
    // upstream server likely dropped the connection — auto-reconnect.
    const handleEnded = () => {
      if (!manifestParsedRef.current) return
      console.warn('[hls-player] ⚠️ Video "ended" event on live stream — auto-reconnecting')
      autoReconnectFnRef.current?.(video, 'Live stream ended unexpectedly')
    }
    video.addEventListener('ended', handleEnded)

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl')

    if (Hls.isSupported()) {
      // Start with DIRECT URL (src is the original stream URL)
      // If direct fails or takes too long (10s), fall back to proxy mode
      const directUrl = src
      const hls = initHls(directUrl, video, true)
      if (!hls) {
        cb.current.onError?.('HLS.js not supported')
        return () => { video.removeEventListener('waiting', handleWaiting); video.removeEventListener('playing', handlePlaying); video.removeEventListener('canplay', handleCanPlay); cleanup() }
      }
      hlsRef.current = hls

      // 15-second timeout: if manifest not parsed within 15s, switch to proxy mode.
      // Since we now use hls.js default retries (manifestLoadingMaxRetry=1),
      // hls.js will retry the manifest once on failure — this takes up to
      // manifestLoadingTimeOut (10s) × 2 attempts = up to 20s. But 15s is a
      // good balance: most working CDN streams respond within 10s, and if hls.js
      // hasn't parsed the manifest by 15s, the stream is likely blocked by CORS
      // and needs proxy. Previous 8s was too short — it killed legitimate
      // connections that were still retrying.
      directTimeoutRef.current = setTimeout(() => {
        if (manifestParsedRef.current) return // already parsed, no need to switch
        if (triedProxyRef.current) return // already tried proxy
        console.log('[hls-player] ⏱️ Direct mode timed out (15s) → switching to proxy')
        triedProxyRef.current = true
        loadModeRef.current = 'proxy'
        cb.current.onLoadModeChange?.('proxy')
        fatalErrorCountRef.current = 0
        mediaErrorCountRef.current = 0
        cleanup()
        if (cb.current.proxyUrl) {
          const proxyHls = initHls(cb.current.proxyUrl, video, false)
          if (proxyHls) {
            hlsRef.current = proxyHls
          } else {
            cb.current.onError?.('Failed to create proxy HLS player')
          }
        } else if (!triedMpegtsRef.current) {
          switchToMpegts()
        } else {
          finalError('Direct connection timed out and no proxy fallback available')
        }
      }, 15000)

      // Stats timer
      statsTimerRef.current = setInterval(() => {
        if (!hlsRef.current) return
        cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video))
      }, 2000)

    } else if (nativeHls) {
      // Safari/iOS native HLS — try direct first, then proxy
      video.src = src
      const handleLoadedMetadata = () => {
        manifestParsedRef.current = true
        if (directTimeoutRef.current) {
          clearTimeout(directTimeoutRef.current)
          directTimeoutRef.current = null
        }
        cb.current.onReady?.()
        cb.current.onQualityLevels?.([])
        // Start stall watchdog for native HLS too
        startStallWatchdogFnRef.current?.(video)
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      }
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      const handleError = () => {
        // Direct failed — try proxy URL if available
        const proxyFallback = cb.current.proxyUrl
        if (proxyFallback && video.src !== proxyFallback) {
          console.log('[hls-player] Native HLS direct failed, trying proxy')
          triedProxyRef.current = true
          loadModeRef.current = 'proxy'
          cb.current.onLoadModeChange?.('proxy')
          video.src = proxyFallback
          video.play().catch(() => {})
        } else {
          cb.current.onError?.('Native HLS playback error')
        }
        video.removeEventListener('error', handleError)
      }
      video.addEventListener('error', handleError)
    } else {
      cb.current.onError?.('HLS is not supported in this browser')
    }

    return () => {
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('ended', handleEnded)
      cleanup()
    }
  }, [src, cleanup, onVideoRef, onBuffering, originalUrl])

  // Quality level changes
  useEffect(() => {
    if (!hlsRef.current) return
    hlsRef.current.currentLevel = selectedQuality === -1 ? -1 : selectedQuality
  }, [selectedQuality])

  // Audio track changes
  useEffect(() => {
    if (!hlsRef.current || selectedAudioTrack < 0) return
    if (hlsRef.current.audioTracks?.length > 0) hlsRef.current.audioTrack = selectedAudioTrack
  }, [selectedAudioTrack])

  // Subtitle track changes
  useEffect(() => {
    if (!hlsRef.current) return
    hlsRef.current.subtitleTrack = selectedSubtitleTrack >= 0 ? selectedSubtitleTrack : -1
  }, [selectedSubtitleTrack])

  // Volume/muted/playbackRate
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = volume
    v.muted = muted
    v.playbackRate = playbackRate
  }, [volume, muted, playbackRate])

  // Live status
  useEffect(() => {
    const timer = setInterval(() => {
      const v = videoRef.current, h = hlsRef.current
      if (!v || !h) return
      const isLive = h.liveSyncPosition !== undefined && h.liveSyncPosition !== null
      const liveSyncPosition = h.liveSyncPosition ?? null
      const isBehindLive = isLive && liveSyncPosition !== null && (liveSyncPosition - v.currentTime) > 3
      onLiveStatus?.({ isLive, liveSyncPosition, isBehindLive })
    }, 1000)
    return () => clearInterval(timer)
  }, [onLiveStatus])

  // Seek to live
  useEffect(() => {
    if (!seekToLive) return
    const v = videoRef.current, h = hlsRef.current
    if (!v || !h) return
    const livePos = h.liveSyncPosition
    if (livePos !== undefined && livePos !== null) { v.currentTime = livePos; v.play().catch(() => {}) }
    onSeekedToLive?.()
  }, [seekToLive, onSeekedToLive])

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
