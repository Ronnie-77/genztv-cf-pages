'use client'

import { useEffect, useRef, useCallback } from 'react'
import Hls from 'hls.js'
import {
  checkHlsCodecCompatibility,
  isHevcMseSupported,
  isSafariBrowser,
  isMobileDevice,
} from '@/lib/codec-check'

/**
 * DirectHlsPlayer
 * ===============
 * সরাসরি স্ট্রিমিংয়ের জন্য অপ্টিমাইজড HLS.js প্লেয়ার।
 *
 * ব্যবহার: CORS-ওপেন CDN যেগুলো সরাসরি ব্রাউজার থেকে চলে
 * (যেমন বেশিরভাগ GitHub M3U, টোকেন-বিহীন public CDN, Cloudflare/Fastly)।
 *
 * মূল বৈশিষ্ট্য:
 *  - LL-HLS (low-latency) মোড, শর্ট বাফার, fast start
 *  - progressive লোডিং (এসে এসে প্লে)
 *  - ABR টিউনড low-latency এর জন্য
 *  - কোনো প্রক্সি fallback নেই — সরাসরি চলে না হলে error
 *  - Worker-enabled (হালকা CPU লোড)
 *  - Live edge-এ কাছাকাছি থাকে (liveSyncDurationCount: 2)
 *
 * যেসব চ্যানেল এই প্লেয়ার ব্যবহার করবে তাদের streamType: 'm3u8_direct'
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

interface DirectHlsPlayerProps {
  src: string
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

export function DirectHlsPlayer({
  src,
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
}: DirectHlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaErrorCountRef = useRef(0)

  // Stable refs for callbacks
  const cb = useRef({
    onReady, onError, onQualityLevels, onStatsUpdate,
    onAudioTracks, onSubtitleTracks, onCodecUnsupported,
  })
  useEffect(() => {
    cb.current = {
      onReady, onError, onQualityLevels, onStatsUpdate,
      onAudioTracks, onSubtitleTracks, onCodecUnsupported,
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

  // ── Main Effect: Initialize DIRECT HLS player ──
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    onVideoRef?.(video)

    cleanup()
    mediaErrorCountRef.current = 0

    // Buffering events
    const handleWaiting = () => onBuffering?.(true)
    const handlePlaying = () => onBuffering?.(false)
    const handleCanPlay = () => onBuffering?.(false)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('canplay', handleCanPlay)

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl')

    if (Hls.isSupported()) {
      // 🚀 DIRECT-OPTIMIZED HLS.js config
      // Tuned for low-latency live streaming on CORS-open CDNs.
      // No proxy fallback — if direct fails, surface error quickly.
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 20,              // শর্ট back-buffer (মেমরি সাশ্রয়)
        preferManagedMediaSource: true,    // iOS 17.1+ low-power support
        useMMS: true,
        enableSoftKfKey: true,

        // ── শর্ট বাফার — fast start, low latency ──
        maxBufferLength: 30,               // ৩০s বাফার (live এর জন্য যথেষ্ট)
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000000,
        maxBufferHole: 0.5,

        // ── ABR — smooth adaptation ──
        abrEwmaDefaultEstimate: 1000000,   // 1Mbps default (live এ ভালো শুরু)
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,

        // ── Live edge-এ কাছাকাছি ──
        liveSyncDurationCount: 2,          // live edge এর ২ segment পিছনে
        liveMaxLatencyDurationCount: 8,
        liveDurationInfinity: true,
        progressive: true,                 // এসে এসে প্লে (পুরো সেগমেন্ট না নামিয়ে)

        // ── Fast-fail timeouts — direct CDN সাধারণত fast বা dead ──
        fragLoadingMaxRetry: 2,
        fragLoadingMaxRetryTimeout: 6000,
        fragLoadingTimeOut: 6000,

        manifestLoadingMaxRetry: 1,
        manifestLoadingMaxRetryTimeout: 4000,
        manifestLoadingTimeOut: 4000,

        levelLoadingMaxRetry: 1,
        levelLoadingMaxRetryTimeout: 4000,
        levelLoadingTimeOut: 4000,

        startLevel: -1,                    // ABR auto-pick start level

        // Direct CDN-তে সাধারণত browser UA কাজ করে; তবে কিছু CDN কঠোর — VLC UA দিচ্ছি
        xhrSetup: (xhr: XMLHttpRequest, reqUrl: string) => {
          if (!reqUrl.includes('/api/stream-proxy')) {
            try { xhr.setRequestHeader('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18') } catch {}
          }
        },
      })

      hls.loadSource(src)
      hls.attachMedia(video)

      // ── Manifest Parsed ──
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        console.log(`[direct-hls] ✅ Manifest parsed, ${data.levels.length} levels`)

        // Codec compatibility check
        const codecInfo = checkHlsCodecCompatibility(
          data.levels.map((l) => ({
            videoCodec: l.videoCodec,
            audioCodec: l.audioCodec,
            width: l.width || undefined,
            height: l.height || undefined,
            bitrate: l.bitrate || undefined,
          }))
        )
        console.log(`[direct-hls] 🎞️ Codec: ${codecInfo.summary}`)

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

      // ── Error Handler — direct-only, no proxy fallback ──
      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error(`[direct-hls] ❌ type=${data.type}, details=${data.details}, fatal=${data.fatal}`)

        if (!data.fatal) {
          console.warn(`[direct-hls] Non-fatal: ${data.details}`)
          return
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaErrorCountRef.current += 1
          if (mediaErrorCountRef.current <= 3) {
            console.log(`[direct-hls] Media recovery ${mediaErrorCountRef.current}/3`)
            hls.recoverMediaError()
          } else {
            cb.current.onError?.('Stream format not supported by this browser (codec error)')
            cleanup()
          }
        } else {
          // Network বা অন্য fatal error — direct এ চলছে না মানে CDN/CORS সমস্যা
          cb.current.onError?.(
            'Direct stream failed. This channel may need the Proxy player ' +
            '(CORS/Referer blocked). Try re-importing with streamType "m3u8_proxy".'
          )
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
      // Safari/iOS native HLS — direct
      video.src = src
      const handleLoadedMetadata = () => {
        cb.current.onReady?.()
        cb.current.onQualityLevels?.([])
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      }
      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      const handleErrorEvent = () => {
        cb.current.onError?.('Native HLS playback error')
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
  }, [src, cleanup, onVideoRef, onBuffering])

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
