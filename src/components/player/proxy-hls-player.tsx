'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import Hls from 'hls.js'
import {
  checkHlsCodecCompatibility,
  isHevcMseSupported,
  isSafariBrowser,
  isMobileDevice,
} from '@/lib/codec-check'
import { reactiveRefreshChannel } from '@/lib/api'

/**
 * ProxyHlsPlayer
 * ==============
 * সবসময় সার্ভার-সাইড প্রক্সি দিয়ে চলে — CORS/Referer ব্লক করা CDN-এর জন্য।
 *
 * ব্যবহার: যেসব CDN সরাসরি ব্রাউজার থেকে fetch ব্লক করে
 *  - toffeelive (Akamai hdntl signed)
 *  - strmd.st (streamed.pk — Referer: embed.st চেক করে)
 *  - bhalocast.pro
 *  - যেকোনো hotlink-protected CDN
 *
 * মূল বৈশিষ্ট্য:
 *  - URL সবসময় /api/stream-proxy?url=ENCODED হিসেবে রিলেট হয়
 *  - প্রক্সি লেটেন্সি সহ্য করতে লংগার টাইমআউট
 *  - বেশি বাফার (proxy throughput fluctuation সামাল দিতে)
 *  - বেশি retry (proxy সাময়িকভাবে স্লো হতে পারে)
 *  - liveSyncDurationCount বেশি (proxy lag কভার করতে)
 *  - Worker-enabled
 *
 * যেসব চ্যানেল এই প্লেয়ার ব্যবহার করবে তাদের streamType: 'm3u8_proxy'
 */

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

interface ProxyHlsPlayerProps {
  /** Original upstream URL (raw m3u8). Will be wrapped in /api/stream-proxy?url=... */
  src: string
  /** Channel ID — when provided, the player can trigger a reactive refresh on
   *  token-expired (403) errors. The server re-extracts a fresh m3u8 from the
   *  channel's source page and returns the new URL here. */
  channelId?: string
  /** Called when a reactive refresh succeeds — parent should update its stored
   *  streamUrl so future loads use the fresh URL. */
  onStreamUrlRefreshed?: (newUrl: string) => void
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
  onCodecUnsupported?: (info: {
    hasHevc: boolean
    hasAv1: boolean
    summary: string
    isMobile: boolean
    isSafari: boolean
    hevcMseSupported: boolean
  }) => void
}

// Wrap URL through the server-side stream proxy.
// The proxy injects Referer/Origin/User-Agent and rewrites inner m3u8 URLs.
function buildProxyUrl(originalUrl: string): string {
  if (!originalUrl) return ''
  // If already proxied, return as-is
  if (originalUrl.includes('/api/stream-proxy?url=')) return originalUrl
  return `/api/stream-proxy?url=${encodeURIComponent(originalUrl)}`
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

export function ProxyHlsPlayer({
  src,
  channelId,
  onStreamUrlRefreshed,
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
  onCodecUnsupported,
}: ProxyHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaErrorCountRef = useRef(0)
  const fatalErrorCountRef = useRef(0)

  // ── Reactive refresh state ──
  // currentSrc is what we actually load — may be updated after a reactive
  // refresh brings back a fresh m3u8 URL (with a new token).
  const [currentSrc, setCurrentSrc] = useState(src)
  // Track how many reactive refresh attempts we've made for THIS src, so we
  // don't loop forever if the source page keeps returning the same dead URL.
  const reactiveAttemptsRef = useRef(0)
  const reactiveInFlightRef = useRef(false)
  const MAX_REACTIVE_ATTEMPTS = 2

  // Keep currentSrc in sync when parent passes a new src (e.g. user switched
  // channels). Reset reactive counters too.
  useEffect(() => {
    // Use a microtask to avoid synchronous setState inside the effect
    queueMicrotask(() => {
      setCurrentSrc(src)
      reactiveAttemptsRef.current = 0
      reactiveInFlightRef.current = false
    })
  }, [src])

  const cb = useRef({
    onReady, onError, onQualityLevels, onStatsUpdate,
    onAudioTracks, onSubtitleTracks, onCodecUnsupported,
    onStreamUrlRefreshed,
  })
  useEffect(() => {
    cb.current = {
      onReady, onError, onQualityLevels, onStatsUpdate,
      onAudioTracks, onSubtitleTracks, onCodecUnsupported,
      onStreamUrlRefreshed,
    }
  })

  const cleanup = useCallback(() => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  // ── Main Effect: Initialize PROXY HLS player ──
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentSrc) return

    onVideoRef?.(video)

    cleanup()
    mediaErrorCountRef.current = 0
    fatalErrorCountRef.current = 0

    // প্রক্সি URL তৈরি
    const proxyUrl = buildProxyUrl(currentSrc)
    console.log(`[proxy-hls] 🔀 Routing through proxy: ${currentSrc.substring(0, 80)}...`)

    // Buffering events
    const handleWaiting = () => onBuffering?.(true)
    const handlePlaying = () => onBuffering?.(false)
    const handleCanPlay = () => onBuffering?.(false)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('canplay', handleCanPlay)

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl')

    if (Hls.isSupported()) {
      // 🛡️ PROXY-OPTIMIZED HLS.js config
      // Tuned for server-side proxy throughput — proxy adds latency,
      // so we use bigger buffers, more retries, longer timeouts.
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,             // proxy লেটেন্সি আছে, LL-HLS অর্থহীন
        backBufferLength: 60,              // বড় back-buffer (proxy re-fetch এড়াতে)

        // ── বড় বাফার — proxy throughput fluctuation সামাল দিতে ──
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 120 * 1000000,
        maxBufferHole: 0.5,

        // ── ABR — proxy bandwidth কনজারভেটিভ ──
        abrEwmaDefaultEstimate: 500000,    // 500kbps default (proxy স্লো হতে পারে)
        abrBandWidthFactor: 0.7,           // কনজারভেটিভ
        abrBandWidthUpFactor: 0.5,         // ধীরে upshift
        abrMaxWithRealBitrate: true,

        // ── Live sync — proxy lag কভার ──
        liveSyncDurationCount: 4,          // ৪ segment পিছনে (proxy latency)
        liveMaxLatencyDurationCount: 12,
        liveDurationInfinity: true,
        progressive: true,

        // ── লংগার টাইমআউট + বেশি retry — proxy সাময়িকভাবে স্লো ──
        fragLoadingMaxRetry: 4,
        fragLoadingMaxRetryTimeout: 20000,
        fragLoadingTimeOut: 20000,         // ২০s (proxy round-trip + upstream)

        manifestLoadingMaxRetry: 3,
        manifestLoadingMaxRetryTimeout: 15000,
        manifestLoadingTimeOut: 15000,     // ১৫s manifest

        levelLoadingMaxRetry: 3,
        levelLoadingMaxRetryTimeout: 15000,
        levelLoadingTimeOut: 15000,

        startLevel: -1,                    // ABR auto-pick

        // প্রক্সি দিয়ে যাওয়ায় browser UA দরকার নেই (সার্ভার VLC UA পাঠায়)
        // তবে কিছু ক্ষেত্রে প্রক্সি ডিরেক্ট URL ফরওয়ার্ড করে — সেফটি
        xhrSetup: (xhr: XMLHttpRequest, reqUrl: string) => {
          if (!reqUrl.includes('/api/stream-proxy')) {
            try { xhr.setRequestHeader('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18') } catch {}
          }
        },
      })

      hls.loadSource(proxyUrl)
      hls.attachMedia(video)

      // ── Manifest Parsed ──
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log(`[proxy-hls] ✅ Manifest parsed via proxy, ${data.levels.length} levels`)

        const codecInfo = checkHlsCodecCompatibility(
          data.levels.map((l) => ({
            videoCodec: l.videoCodec,
            audioCodec: l.audioCodec,
            width: l.width || undefined,
            height: l.height || undefined,
            bitrate: l.bitrate || undefined,
          }))
        )
        console.log(`[proxy-hls] 🎞️ Codec: ${codecInfo.summary}`)

        if (!codecInfo.playable) {
          cb.current.onCodecUnsupported?.({
            hasHevc: codecInfo.hasHevc,
            hasAv1: codecInfo.hasAv1,
            summary: codecInfo.summary,
            isMobile: isMobileDevice(),
            isSafari: isSafariBrowser(),
            hevcMseSupported: isHevcMseSupported(),
          })
          return
        }

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
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (hlsRef.current) cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video)) })
      hls.on(Hls.Events.FRAG_LOADED, () => { if (hlsRef.current) cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video)) })

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

      // ── Error Handler — proxy mode, aggressive retry + reactive refresh ──
      hls.on(Hls.Events.ERROR, async (_event, data) => {
        console.error(`[proxy-hls] ❌ type=${data.type}, details=${data.details}, fatal=${data.fatal}`)

        if (!data.fatal) {
          console.warn(`[proxy-hls] Non-fatal: ${data.details}`)
          return
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          fatalErrorCountRef.current += 1
          if (fatalErrorCountRef.current <= 2) {
            // প্রক্সি সাময়িকভাবে সমস্যা হতে পারে — retry করি
            console.log(`[proxy-hls] 🔄 Network error, retrying (${fatalErrorCountRef.current}/2)`)
            setTimeout(() => {
              hls.startLoad()
            }, 1000)
          } else {
            // ── Reactive refresh: token may have expired ──
            // If we have a channelId and haven't exhausted our attempts, ask
            // the server to re-extract a fresh m3u8 from the source page.
            if (
              channelId &&
              !reactiveInFlightRef.current &&
              reactiveAttemptsRef.current < MAX_REACTIVE_ATTEMPTS
            ) {
              reactiveInFlightRef.current = true
              reactiveAttemptsRef.current += 1
              console.log(
                `[proxy-hls] 🔑 Token likely expired — triggering reactive refresh ` +
                `(attempt ${reactiveAttemptsRef.current}/${MAX_REACTIVE_ATTEMPTS}) for channel ${channelId}`
              )
              try {
                const result = await reactiveRefreshChannel(channelId)
                reactiveInFlightRef.current = false
                if (result.refreshed && result.streamUrl && result.streamUrl !== currentSrc) {
                  console.log(`[proxy-hls] ✅ Reactive refresh succeeded — reloading player with fresh URL`)
                  cb.current.onStreamUrlRefreshed?.(result.streamUrl)
                  // Update src state — the main effect will re-init the player.
                  // Reset error counters so the new URL gets a clean slate.
                  fatalErrorCountRef.current = 0
                  mediaErrorCountRef.current = 0
                  setCurrentSrc(result.streamUrl)
                  return // skip onError — we're reloading
                } else {
                  console.warn(`[proxy-hls] Reactive refresh did not return a new URL: ${result.reason || 'same URL'}`)
                }
              } catch (err) {
                reactiveInFlightRef.current = false
                const msg = err instanceof Error ? err.message : 'Unknown refresh error'
                console.warn(`[proxy-hls] Reactive refresh failed: ${msg}`)
              }
            }

            cb.current.onError?.(
              'Proxy stream failed after retries. The upstream CDN may be down, ' +
              'the token may have expired, or geo-restricted. ' +
              (channelId
                ? reactiveAttemptsRef.current >= MAX_REACTIVE_ATTEMPTS
                  ? 'Auto-refresh attempted but the source page did not return a fresh URL.'
                  : 'Try re-extracting the URL from the admin panel.'
                : 'Try re-extracting the URL.')
            )
            cleanup()
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaErrorCountRef.current += 1
          if (mediaErrorCountRef.current <= 3) {
            console.log(`[proxy-hls] Media recovery ${mediaErrorCountRef.current}/3`)
            hls.recoverMediaError()
          } else {
            cb.current.onError?.('Stream format not supported by this browser (codec error)')
            cleanup()
          }
        } else {
          cb.current.onError?.('Fatal proxy stream error')
          cleanup()
        }
      })

      hlsRef.current = hls

      // Stats timer
      statsTimerRef.current = setInterval(() => {
        if (!hlsRef.current) return
        cb.current.onStatsUpdate?.(buildStats(hlsRef.current, video))
      }, 2000)

    } else if (nativeHls) {
      // Safari/iOS native HLS — through proxy
      video.src = proxyUrl
      const handleLoadedMetadata = () => {
        cb.current.onReady?.()
        cb.current.onQualityLevels?.([])
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      }
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      const handleErrorEvent = () => {
        cb.current.onError?.('Native HLS playback error (proxy mode)')
        video.removeEventListener('error', handleErrorEvent)
      }
      video.addEventListener('error', handleErrorEvent)
    } else {
      cb.current.onError?.('HLS is not supported in this browser')
    }

    return () => {
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('canplay', handleCanPlay)
      cleanup()
    }
  }, [currentSrc, channelId, cleanup, onVideoRef, onBuffering])

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
      const isBehindLive = isLive && liveSyncPosition !== null && (liveSyncPosition - v.currentTime) > 5
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

  const videoStyle: React.CSSProperties = (() => {
    switch (aspectMode) {
      case 'stretch': return { objectFit: 'fill' }
      case 'crop': return { objectFit: 'cover' }
      case '16:9': return { objectFit: 'contain', aspectRatio: '16/9' }
      case '4:3': return { objectFit: 'contain', aspectRatio: '4/3' }
      default: return { objectFit: 'contain' }
    }
  })()

  return (
    <video ref={videoRef} className="w-full h-full" style={videoStyle} playsInline autoPlay />
  )
}
