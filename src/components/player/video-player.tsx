'use client'

// ─────────────────────────────────────────────────────────────────────────────
// VideoPlayer — RESTORED OLD ORCHESTRATION (Task 23)
//
// The new StreamPlayer class (stream-player.ts) had persistent issues with
// m3u8 auto-fallback latency and mpegts stutter/fast-playback that config
// tuning could not resolve. This file restores the PROVEN-WORKING old
// orchestration that shipped with GenZTV-main:
//
//   • HlsPlayer  — hls.js with auto-fallback chain: direct → proxy → mpegts
//                  (5s direct timeout → proxy → mpegts.js). lowLatencyMode,
//                  maxBufferLength 60, generous ABR. This is what "auto
//                  fallback" means in the admin dropdown.
//   • TsPlayer   — mpegts.js with liveBufferLatencyChasing: FALSE (the #1
//                  fix for the stutter/fast-playback symptom — chasing was
//                  jumping the playhead forward). Generous 30s buffer,
//                  auto-reconnect on LOADING_COMPLETE.
//   • JwHlsPlayer — proxy-first HLS for m3u8_jw streams.
//   • IframePlayer / IframeDirectPlayer — unchanged.
//
// Stream type → backend map:
//   m3u / m3u8 / direct / m3u8_direct → HlsPlayer (direct-first, auto-fallback)
//   m3u8_proxy                         → HlsPlayer (proxy-first via proxyUrl)
//   m3u8_jw                            → JwHlsPlayer (proxy-first)
//   mpegts / *.ts                      → TsPlayer (via /api/stream-proxy)
//   iframe / redirect                  → IframePlayer
//   iframe_direct                      → IframeDirectPlayer
//   github_m3u                         → resolved async, then HlsPlayer/TsPlayer
//   dash / *.mpd                       → StreamPlayerWrapper (dash.js) — only
//                                        path that still uses the new player,
//                                        because the old system had no DASH.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react'
import { HlsPlayer } from './hls-player'
import type { QualityLevel, HlsStats, LiveStatus, AudioTrack, SubtitleTrack } from './hls-player'
import { IframePlayer } from './iframe-player'
import { IframeDirectPlayer } from './iframe-direct-player'
import { TsPlayer } from './ts-player'
import { JwHlsPlayer } from './jw-hls-player'
import { StreamPlayerWrapper } from './stream-player-wrapper'
import { PlayerControls } from './player-controls'
import { RotateCw } from 'lucide-react'

// Iframe reload hint — small floating button to reload iframe if video doesn't play
function IframeReloadHint() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 8000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  const handleReload = () => {
    const iframe = document.querySelector('iframe')
    if (iframe) {
      const src = iframe.src
      iframe.src = ''
      setTimeout(() => { iframe.src = src }, 100)
    }
  }

  return (
    <button
      className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors text-white/80 text-xs pointer-events-auto"
      onClick={handleReload}
    >
      <RotateCw className="h-3 w-3" />
      Tap if video doesn&apos;t load
    </button>
  )
}

// Detect raw MPEG-TS stream URLs (.ts extension, not inside m3u8)
function isTsUrl(url: string): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    return /\.ts(\?.*)?$/.test(pathname) && !pathname.includes('.m3u8')
  } catch {
    return /\.ts(\?|$)/.test(url) && !url.includes('.m3u8')
  }
}

// Detect HLS manifest URLs (.m3u8 / .m3u)
function isM3u8Url(url: string): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    return /\.m3u8?(\?.*)?$/.test(pathname)
  } catch {
    return /\.m3u8?(\?|$)/.test(url)
  }
}

// Detect DASH manifest URLs (.mpd)
function isMpdUrl(url: string): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname
    return /\.mpd(\?.*)?$/.test(pathname)
  } catch {
    return /\.mpd(\?|$)/.test(url)
  }
}

// Auto-detect the stream type from the URL when no explicit streamType is given
function detectStreamTypeFromUrl(url: string): string | undefined {
  if (!url) return undefined
  if (isTsUrl(url)) return 'mpegts'
  if (isM3u8Url(url)) return 'm3u8'
  if (isMpdUrl(url)) return 'dash'
  if (/(?:youtube\.com\/embed|youtu\.be|player\.twitch\.tv|player\.vimeo\.com|dailymotion\.com\/embed|facebook\.com\/plugins\/video|iframe\.|\/embed\/)/i.test(url)) {
    return 'iframe'
  }
  if (/github\.com\/.*\.m3u/i.test(url) || /raw\.githubusercontent\.com\/.*\.m3u/i.test(url)) {
    return 'github_m3u'
  }
  return undefined
}

interface VideoPlayerProps {
  streamUrl: string
  streamType: string // m3u, iframe, github_m3u, direct, redirect, m3u8_jw, m3u8_direct, m3u8_proxy, mpegts, dash
  channelId?: string
  onStreamUrlRefreshed?: (newUrl: string) => void
  title?: string
  isLive?: boolean
  poster?: string
  onStreamResolved?: (url: string) => void
}

// Route redirect URLs through our iframe proxy (used for 'redirect' type which always proxies)
function proxyIframeUrl(url: string): string {
  if (!url) return url
  return `/api/iframe-proxy?url=${encodeURIComponent(url)}`
}

// Route all streams through Next.js stream-proxy.
function proxyStreamUrl(url: string): string {
  if (!url) return url
  return `/api/stream-proxy?url=${encodeURIComponent(url)}`
}

const KNOWN_STREAM_TYPES = new Set([
  'm3u', 'm3u8', 'm3u8_direct', 'm3u8_proxy', 'm3u8_jw',
  'iframe', 'iframe_direct', 'mpegts', 'dash', 'github_m3u', 'fifalive', 'fifalive_proxy', 'direct', 'redirect',
])

// Compute the resolved URL + backend type synchronously to avoid a flash of wrong UI.
// IMPORTANT: .ts URL detection wins over everything (a .ts file is never iframe/m3u8).
function getInitialResolved(url: string, type: string): { resolvedUrl: string; resolvedType: string } {
  if (!url) return { resolvedUrl: url, resolvedType: type }
  // .ts URLs → mpegts (routed through /api/stream-proxy by TsPlayer's caller)
  if (type === 'mpegts' || isTsUrl(url)) return { resolvedUrl: url, resolvedType: 'mpegts' }

  // .mpd URLs → dash (only path that uses the new StreamPlayer / dash.js)
  if (isMpdUrl(url) || type === 'dash') {
    return { resolvedUrl: url, resolvedType: 'dash' }
  }

  // .m3u8 URLs → force HLS (never iframe). Preserve explicit sub-types.
  if (isM3u8Url(url)) {
    if (type === 'm3u8_direct') return { resolvedUrl: url, resolvedType: 'm3u8_direct' }
    if (type === 'm3u8_proxy') return { resolvedUrl: url, resolvedType: 'm3u8_proxy' }
    if (type === 'm3u8_jw') return { resolvedUrl: url, resolvedType: 'm3u8_jw' }
    return { resolvedUrl: url, resolvedType: 'm3u8' }
  }

  if (type === 'redirect') return { resolvedUrl: url, resolvedType: 'iframe' }
  if (type === 'iframe') return { resolvedUrl: url, resolvedType: 'iframe' }
  if (type === 'iframe_direct') return { resolvedUrl: url, resolvedType: 'iframe_direct' }
  if (type === 'github_m3u') return { resolvedUrl: url, resolvedType: 'github_m3u' }
  if (type === 'fifalive') return { resolvedUrl: '', resolvedType: 'fifalive' } // async-resolved below
  if (type === 'fifalive_proxy') return { resolvedUrl: url, resolvedType: 'm3u8_proxy' } // /api/fifalive proxy URL — treat as proxied HLS
  if (type === 'm3u8_direct') return { resolvedUrl: url, resolvedType: 'm3u8_direct' }
  if (type === 'm3u8_proxy') return { resolvedUrl: url, resolvedType: 'm3u8_proxy' }
  if (type === 'm3u8_jw') return { resolvedUrl: url, resolvedType: 'm3u8_jw' }
  if (type === 'direct' || type === 'm3u' || type === 'm3u8') {
    return { resolvedUrl: url, resolvedType: type === 'direct' ? 'm3u' : type }
  }
  if (!KNOWN_STREAM_TYPES.has(type)) {
    const detected = detectStreamTypeFromUrl(url)
    if (detected) return { resolvedUrl: url, resolvedType: detected }
  }
  return { resolvedUrl: url, resolvedType: type }
}

export function VideoPlayer({
  streamUrl,
  streamType,
  channelId,
  onStreamUrlRefreshed,
  title,
  isLive = true,
  poster,
  onStreamResolved,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Compute initial state synchronously
  const initial = getInitialResolved(streamUrl, streamType)
  const [resolvedUrl, setResolvedUrl] = useState(initial.resolvedUrl)
  const [resolvedType, setResolvedType] = useState(initial.resolvedType)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controlsVisible, setControlsVisible] = useState(
    streamType === 'iframe' || streamType === 'redirect' || streamType === 'iframe_direct' || streamType === 'mpegts' ? false : true
  )
  const [controlsBusy, setControlsBusy] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Iframe touch overlay state — on mobile, a transparent overlay blocks ad clicks
  const [iframeTouchLocked, setIframeTouchLocked] = useState(() => {
    if (typeof window === 'undefined') return true
    const isMobile = 'ontouchstart' in window
    return isMobile // mobile = locked, desktop = unlocked
  })
  const iframeUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMobileDevice = typeof window !== 'undefined' && 'ontouchstart' in window

  // Determine player type early (derived from state)
  const isIframe = resolvedType === 'iframe'
  const isIframeDirect = resolvedType === 'iframe_direct'
  const isMpegTs = resolvedType === 'mpegts'
  const isDash = resolvedType === 'dash'
  // HLS = m3u, m3u8, m3u8_direct, m3u8_proxy, m3u8_jw, or github_m3u after resolve
  const isHls = resolvedType === 'm3u' || resolvedType === 'm3u8' ||
                resolvedType === 'm3u8_direct' || resolvedType === 'm3u8_proxy' ||
                resolvedType === 'm3u8_jw'
  // fifalive resolves to an m3u8 (toffeelive) → treat as HLS once resolved.
  // Until resolved, resolvedType stays 'fifalive' and isHls is false, so no
  // player renders until we have a real URL.
  const isJw = resolvedType === 'm3u8_jw'

  // HLS load mode tracking (direct → proxy → mpegts fallback chain inside HlsPlayer)
  const [hlsLoadMode, setHlsLoadMode] = useState<'direct' | 'proxy' | 'mpegts'>('direct')
  // When HLS falls back to mpegts mode, switch the player type to TsPlayer
  const [hlsFallbackMpegts, setHlsFallbackMpegts] = useState(false)

  // HEVC transcode fallback: when TsPlayer reports the browser can't decode
  // the stream's codec (e.g. HEVC/H.265 on Chrome/Firefox/Edge), switch to
  // HlsPlayer fed by the server-side transcode service (HEVC → H.264 HLS).
  // This makes HEVC streams play on ALL browsers, not just Safari.
  const [hevcTranscodeFallback, setHevcTranscodeFallback] = useState(false)
  const [transcodePlaylistUrl, setTranscodePlaylistUrl] = useState<string | null>(null)
  const [transcodeLoading, setTranscodeLoading] = useState(false)

  // HLS quality & stats state
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentQuality, setCurrentQuality] = useState(-1) // -1 = auto (user's selection)
  // The ACTUAL level hls.js is currently playing (from LEVEL_SWITCHED).
  // Differs from currentQuality when in Auto mode: currentQuality stays -1
  // but currentLevel tracks which resolution ABR has chosen (e.g. 1080p).
  // Used to display "Auto (1080p)" in the settings Quality row.
  const [currentLevel, setCurrentLevel] = useState(-1)
  const [hlsStats, setHlsStats] = useState<HlsStats | null>(null)

  // VLC-like controls
  const [playbackRate, setPlaybackRate] = useState(1)
  const [aspectMode, setAspectMode] = useState<'fit' | 'stretch' | 'crop' | '16:9' | '4:3'>('fit')

  // Live status & Back to Live
  const [isBehindLive, setIsBehindLive] = useState(false)
  const [seekToLive, setSeekToLive] = useState(false)

  // Audio tracks
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [currentAudioTrack, setCurrentAudioTrack] = useState(-1)

  // Subtitle tracks
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState(-1)

  // Deinterlace (TsPlayer)
  const [deinterlace, setDeinterlace] = useState(false)

  // Screenshot toast
  const [screenshotFlash, setScreenshotFlash] = useState(false)

  // fifalive auto-re-resolve: when the toffeelive hdntl token expires
  // (~24h) the HLS stream errors. Bumping this nonce re-runs the resolve
  // effect to fetch a fresh token from /api/resolve-fifalive. Also bumped
  // once shortly after load as a safety net in case the cached token was
  // already stale when the player opened. (Task 29)
  const [fifaliveResolveNonce, setFifaliveResolveNonce] = useState(0)
  // Caps re-resolve attempts to avoid infinite loops if the stream is
  // genuinely down (not just an expired token). Reset when the user
  // manually switches channel.
  const fifaliveRetryCountRef = useRef(0)

  // Cursor visibility in fullscreen
  const [cursorVisible, setCursorVisible] = useState(true)
  const cursorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-relock iframe after 10 seconds of being unlocked — MOBILE ONLY.
  // Desktop stays unlocked so the user can interact with the embedded player.
  useEffect(() => {
    if (isMobileDevice && isIframe && !iframeTouchLocked) {
      if (iframeUnlockTimerRef.current) clearTimeout(iframeUnlockTimerRef.current)
      iframeUnlockTimerRef.current = setTimeout(() => {
        setIframeTouchLocked(true)
      }, 10000)
    }
    return () => {
      if (iframeUnlockTimerRef.current) clearTimeout(iframeUnlockTimerRef.current)
    }
  }, [isIframe, iframeTouchLocked, isMobileDevice])

  // Auto-hide controls after 3s on ALL devices & ALL stream types.
  // (Task 26) Previously only iframe/mpegts auto-hid via this effect;
  // HLS relied on showControls()'s timer which only fired when playing.
  // Now every stream type hides 3s after controls become visible,
  // unless the settings menu is open (controlsBusy).
  useEffect(() => {
    if (controlsVisible && !controlsBusy) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false)
      }, 3000)
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [controlsVisible, controlsBusy])

  // Resolve stream URLs — handle github_m3u async resolution + .ts detection.
  // Re-runs whenever the user switches stream (streamUrl/streamType change).
  useEffect(() => {
    async function resolve() {
      // Reset all transient state so the new stream starts fresh.
      setError(null)
      setLoading(true)
      setBuffering(false)
      setQualityLevels([])
      setHlsStats(null)
      setCurrentQuality(-1)
      setCurrentLevel(-1)
      setHlsLoadMode('direct')
      setHlsFallbackMpegts(false)
      // Reset HEVC transcode fallback so a new stream starts with the direct
      // TsPlayer (only fall back to transcode if the new stream is also HEVC).
      setHevcTranscodeFallback(false)
      setTranscodePlaylistUrl(null)
      setTranscodeLoading(false)
      setPlaying(false)
      setIsBehindLive(false)
      setAudioTracks([])
      setCurrentAudioTrack(-1)
      setSubtitleTracks([])
      setCurrentSubtitleTrack(-1)
      // Reset fifalive retry counter on a fresh channel switch (not on
      // nonce-driven re-resolves, which are themselves retries).
      if (fifaliveResolveNonce === 0) {
        fifaliveRetryCountRef.current = 0
      }

      if (streamType === 'github_m3u' && streamUrl) {
        try {
          let url = streamUrl
          if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
            url = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
          }
          const res = await fetch('/api/m3u-parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          })
          const data = await res.json()
          if (data.channels && data.channels.length > 0) {
            const channelUrl = data.channels[0].url
            if (isTsUrl(channelUrl)) {
              setResolvedUrl(channelUrl)
              setResolvedType('mpegts')
            } else {
              setResolvedUrl(channelUrl)
              setResolvedType('m3u')
            }
            onStreamResolved?.(channelUrl)
          } else {
            setError('No streams found in M3U file')
          }
        } catch {
          setError('Failed to parse M3U file')
        } finally {
          setLoading(false)
        }
      } else if (streamType === 'fifalive') {
        // fifalive.click/play embeds a toffeelive m3u8 with an hdntl token
        // that expires ~every 24h. The /api/resolve-fifalive endpoint
        // fetches the page server-side, extracts the m3u8 URL + token, and
        // caches it for 20h. On token-expiry errors the player bumps
        // fifaliveResolveNonce which re-runs this effect to re-resolve
        // (with force=1 to bypass cache, so a genuinely fresh token is
        // fetched). Retry is capped at 3 to avoid infinite loops if the
        // stream is genuinely down. (Task 29)
        const isRetry = fifaliveResolveNonce > 0
        try {
          const url = isRetry
            ? `/api/resolve-fifalive?force=1&_=${fifaliveResolveNonce}`
            : `/api/resolve-fifalive?_=${fifaliveResolveNonce}`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`resolve-fifalive HTTP ${res.status}`)
          const data = await res.json()
          if (data.url) {
            setResolvedUrl(data.url)
            setResolvedType('m3u8') // resolved → HLS player takes over
            onStreamResolved?.(data.url)
          } else {
            setError(data.error || 'Failed to resolve fifalive stream')
          }
        } catch {
          setError('Failed to resolve fifalive stream')
        } finally {
          setLoading(false)
        }
      } else if (streamType === 'redirect' && streamUrl) {
        // redirect → iframe proxy, UNLESS the URL is .m3u8 or .ts (URL wins)
        if (isTsUrl(streamUrl)) {
          setResolvedUrl(streamUrl)
          setResolvedType('mpegts')
        } else if (isM3u8Url(streamUrl)) {
          setResolvedUrl(streamUrl)
          setResolvedType('m3u8')
        } else {
          setResolvedType('iframe')
          setResolvedUrl(streamUrl)
        }
        setLoading(false)
      } else {
        const resolved = getInitialResolved(streamUrl, streamType)
        setResolvedUrl(resolved.resolvedUrl)
        setResolvedType(resolved.resolvedType)
        setLoading(false)
      }
    }
    resolve()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, streamType, fifaliveResolveNonce])

  // Fullscreen change listener
  useEffect(() => {
    function handleFullscreenChange() {
      const isFs = !!document.fullscreenElement
      setFullscreen(isFs)
      if (isFs) {
        setCursorVisible(true)
        if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
        cursorHideTimerRef.current = setTimeout(() => {
          setCursorVisible(false)
        }, 3000)
      } else {
        setCursorVisible(true)
        if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
      }
    }

    // iOS Safari uses webkitfullscreenchange on video elements
    function handleWebkitFullscreenChange() {
      const video = document.querySelector('video') as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }
      const isFs = video?.webkitDisplayingFullscreen ?? false
      setFullscreen(isFs)
      if (isFs) {
        setCursorVisible(true)
        if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
        cursorHideTimerRef.current = setTimeout(() => {
          setCursorVisible(false)
        }, 3000)
      } else {
        setCursorVisible(true)
        if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    // iOS Safari fullscreen events
    document.addEventListener('webkitfullscreenchange', handleWebkitFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleWebkitFullscreenChange)
    }
  }, [])

  // Show controls with auto-hide timer (3s, all devices, all stream types).
  // (Task 26) Removed the old isIframe/playing condition — controls now
  // auto-hide after 3s regardless of play state, matching the user's
  // "tap to show, tap to hide, 3s auto-hide" requirement.
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (fullscreen) {
      setCursorVisible(true)
      if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
      cursorHideTimerRef.current = setTimeout(() => {
        setCursorVisible(false)
      }, 3000)
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!controlsBusy) setControlsVisible(false)
    }, 3000)
  }, [controlsBusy, fullscreen])

  const toggleControlsVisibility = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    } else {
      showControls()
    }
  }, [controlsVisible, showControls])

  const handleMouseMove = useCallback(() => {
    showControls()
    if (fullscreen) {
      setCursorVisible(true)
      if (cursorHideTimerRef.current) clearTimeout(cursorHideTimerRef.current)
      cursorHideTimerRef.current = setTimeout(() => {
        setCursorVisible(false)
      }, 3000)
    }
  }, [showControls, fullscreen])

  const togglePlay = useCallback(() => {
    const video = videoRef.current || containerRef.current?.querySelector('video')
    if (video) {
      if (video.paused) {
        video.play()
        setPlaying(true)
      } else {
        video.pause()
        setPlaying(false)
      }
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return

    // Detect iOS Safari / iPhone / iPad
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    // Get the video element for iOS fullscreen
    const video = videoRef.current || containerRef.current?.querySelector('video') as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void
      webkitExitFullscreen?: () => void
    }

    if (document.fullscreenElement) {
      // Exit fullscreen
      try {
        const screen = window.screen as Screen & { orientation?: { unlock?: () => void } }
        screen.orientation?.unlock?.()
      } catch {}
      try {
        document.exitFullscreen()
      } catch {}
      // iOS webkit exit
      if (isIOS && video?.webkitExitFullscreen) {
        try {
          video.webkitExitFullscreen()
        } catch {}
      }
    } else {
      // Enter fullscreen
      if (isIOS && video?.webkitEnterFullscreen) {
        // iOS Safari: use webkitEnterFullscreen on the video element
        // This triggers native iOS video fullscreen with automatic landscape rotation
        try {
          video.webkitEnterFullscreen()
        } catch {}
      } else {
        // Standard browsers: use requestFullscreen on container
        try {
          await containerRef.current.requestFullscreen()
          // Try to lock orientation to landscape (Android Chrome, etc.)
          try {
            const screen = window.screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }
            if (screen.orientation?.lock) {
              await screen.orientation.lock('landscape')
            }
          } catch {}
        } catch {}
      }
    }
  }, [])

  const toggleMute = useCallback(() => setMuted(m => !m), [])

  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v)
    if (v > 0 && muted) setMuted(false)
  }, [muted])

  const handleRetry = useCallback(() => {
    setError(null)
    setLoading(true)
    setBuffering(false)
    setQualityLevels([])
    setHlsStats(null)
    setCurrentQuality(-1)
    setCurrentLevel(-1)
    setHlsLoadMode('direct')
    setHlsFallbackMpegts(false)
    const currentUrl = resolvedUrl
    setResolvedUrl('')
    requestAnimationFrame(() => {
      setResolvedUrl(currentUrl)
    })
  }, [resolvedUrl])

  const handleReady = useCallback(() => {
    setLoading(false)
    setBuffering(false)
    const video = videoRef.current || containerRef.current?.querySelector('video')
    if (video) {
      video.play().then(() => setPlaying(true)).catch(() => {})
    }
  }, [])

  const handleError = useCallback((err: string) => {
    setError(err)
    setLoading(false)
    setBuffering(false)
    // If this is a fifalive stream, auto-trigger a re-resolve so a fresh
    // hdntl token is fetched. The error string often contains "403"/"forbidden"/
    // "token"/"load" when Akamai rejects an expired token. We re-resolve
    // regardless of the exact message because the only failure mode for
    // fifalive is token expiry (the page itself is always reachable).
    // Capped at 3 retries to avoid infinite loops if the stream is
    // genuinely down. (Task 29)
    if (streamType === 'fifalive' && fifaliveRetryCountRef.current < 3) {
      fifaliveRetryCountRef.current += 1
      // Small delay to avoid hammering the resolver on rapid error bursts.
      setTimeout(() => setFifaliveResolveNonce(n => n + 1), 1500)
    }
  }, [streamType])

  // ── HEVC codec fallback ──
  // When TsPlayer detects the browser can't decode the stream's codec (e.g.
  // HEVC on Chrome/Firefox/Edge), request the server-side transcode service
  // to start transcoding HEVC → H.264 HLS, then swap to HlsPlayer so the
  // stream plays on ALL browsers.
  const handleCodecUnsupported = useCallback(async () => {
    // Guard against double-trigger (mpegts.js can fire ERROR multiple times)
    if (hevcTranscodeFallback || transcodeLoading) return
    const originalUrl = resolvedUrl || streamUrl
    if (!originalUrl) {
      setError('Unable to play this stream.')
      setLoading(false)
      return
    }
    setTranscodeLoading(true)
    console.log('[VideoPlayer] Codec unsupported — starting HEVC transcode fallback for', originalUrl.slice(0, 80))
    try {
      // Call the Next.js API route which proxies to the transcode mini-service
      // on port 3032. This works in BOTH environments (gateway + localhost).
      const res = await fetch(`/api/transcode?url=${encodeURIComponent(originalUrl)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Transcode service error (${res.status})`)
      }
      const data = await res.json()
      if (!data.playlist) throw new Error('No playlist URL returned')
      console.log('[VideoPlayer] Transcode playlist:', data.playlist)

      // ── Wait for the transcode playlist to be ready ──
      // FFmpeg takes a few seconds to start producing HLS segments. If we hand
      // the playlist URL to hls.js immediately, it gets a 503 → fatal error.
      // Poll the playlist URL until it returns 200 (max 30s).
      const playlistUrl = data.playlist
      let playlistReady = false
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const check = await fetch(playlistUrl)
          if (check.ok) {
            playlistReady = true
            console.log(`[VideoPlayer] Transcode playlist ready after ${(attempt + 1) * 2}s`)
            break
          }
        } catch { /* ignore fetch errors during polling */ }
        await new Promise(r => setTimeout(r, 2000)) // wait 2s between checks
      }
      if (!playlistReady) {
        throw new Error('Transcode playlist not ready after 60s')
      }

      setTranscodePlaylistUrl(playlistUrl)
      setHevcTranscodeFallback(true)
      setError(null)
      setLoading(true)
      setBuffering(false)
    } catch (err) {
      console.error('[VideoPlayer] Transcode fallback failed:', err)
      setError(
        'This stream uses HEVC/H.265 video which your browser cannot play, ' +
        'and the transcoding service is unavailable. Try Safari or a different channel.'
      )
      setLoading(false)
    } finally {
      setTranscodeLoading(false)
    }
  }, [hevcTranscodeFallback, transcodeLoading, resolvedUrl, streamUrl])

  const handleVideoRef = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video
  }, [])

  const handleQualityLevels = useCallback((levels: QualityLevel[]) => {
    setQualityLevels(levels)
  }, [])

  const handleStatsUpdate = useCallback((stats: HlsStats) => {
    setHlsStats(stats)
  }, [])

  const handleQualityChange = useCallback((level: number) => {
    setCurrentQuality(level)
  }, [])

  // hls.js reports the actual level currently being played (via LEVEL_SWITCHED).
  // This tracks ABR auto-selection so we can show "Auto (1080p)" in settings.
  const handleCurrentLevelChange = useCallback((level: number) => {
    setCurrentLevel(level)
  }, [])

  const handleLiveStatus = useCallback((status: LiveStatus) => {
    setIsBehindLive(status.isLive && status.isBehindLive)
  }, [])

  const handleBuffering = useCallback((isBuffering: boolean) => {
    setBuffering(isBuffering)
    if (!isBuffering) {
      const video = videoRef.current || containerRef.current?.querySelector('video')
      if (video && !video.paused) {
        setPlaying(true)
      }
    }
  }, [])

  const handleSeekedToLive = useCallback(() => {
    setSeekToLive(false)
    setPlaying(true)
  }, [])

  const handleBackToLive = useCallback(() => {
    setSeekToLive(true)
  }, [])

  // HLS load mode change handler — tracks direct → proxy → mpegts fallback
  const handleHlsLoadModeChange = useCallback((mode: 'direct' | 'proxy' | 'mpegts') => {
    setHlsLoadMode(mode)
    if (mode === 'proxy') {
      // Show loading indicator for proxy connection attempt (direct failed/timed out)
      setLoading(true)
      setBuffering(true)
    }
  }, [])

  // HLS requests mpegts.js fallback — switch player type to TsPlayer
  const handleRequestMpegts = useCallback(() => {
    setHlsFallbackMpegts(true)
  }, [])

  // Audio track handlers
  const handleAudioTracks = useCallback((tracks: AudioTrack[]) => {
    setAudioTracks(tracks)
    const defaultTrack = tracks.find(t => t.default)
    if (defaultTrack) setCurrentAudioTrack(defaultTrack.id)
    else if (tracks.length > 0) setCurrentAudioTrack(0)
  }, [])

  const handleAudioTrackChange = useCallback((trackId: number) => {
    setCurrentAudioTrack(trackId)
  }, [])

  // Subtitle track handlers
  const handleSubtitleTracks = useCallback((tracks: SubtitleTrack[]) => {
    setSubtitleTracks(tracks)
  }, [])

  const handleSubtitleTrackChange = useCallback((trackId: number) => {
    setCurrentSubtitleTrack(trackId)
  }, [])

  // Screenshot handler
  const handleScreenshot = useCallback(() => {
    const video = videoRef.current || containerRef.current?.querySelector('video')
    if (!video) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      setScreenshotFlash(true)
      setTimeout(() => setScreenshotFlash(false), 300)
      const link = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      link.download = `screenshot-${timestamp}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('[video-player] Screenshot failed:', e)
    }
  }, [])

  // Check if seeking is possible (for showing skip buttons)
  const [seekable, setSeekable] = useState(!isLive)
  useEffect(() => {
    if (isMpegTs) {
      setSeekable(false)
      return
    }
    const video = videoRef.current || containerRef.current?.querySelector('video')
    if (!video) return
    const check = () => {
      try {
        const seekableRanges = video.seekable
        if (seekableRanges && seekableRanges.length > 0) {
          const seekableDuration = seekableRanges.end(seekableRanges.length - 1) - seekableRanges.start(0)
          setSeekable(seekableDuration > 1)
        } else {
          setSeekable(false)
        }
      } catch {
        setSeekable(!isLive)
      }
    }
    const timer = setInterval(check, 2000)
    check()
    return () => clearInterval(timer)
  }, [resolvedUrl, isLive, isMpegTs])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture player shortcuts when the user is typing in a
      // text field (search bar, input, textarea, contentEditable).
      // (Task 29) Previously 'f'/'q'/'s'/'k'/'m'/','/'.' were captured
      // globally even while typing in the channel search bar, so the
      // characters never reached the input. Now we bail out if the
      // active element is any kind of text input.
      const ae = document.activeElement
      if (ae) {
        const tag = ae.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          (ae as HTMLElement).isContentEditable
        ) {
          return
        }
      }
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
          e.preventDefault()
          setMuted(m => !m)
          break
        case 'arrowup':
          e.preventDefault()
          setVolume(v => Math.min(1, v + 0.1))
          break
        case 'arrowdown':
          e.preventDefault()
          setVolume(v => Math.max(0, v - 0.1))
          break
        case 'escape':
          if (fullscreen) toggleFullscreen()
          break
        case 'q':
          e.preventDefault()
          if (qualityLevels.length > 0) {
            if (currentQuality === -1) {
              setCurrentQuality(0)
            } else {
              const nextIdx = currentQuality + 1
              if (nextIdx >= qualityLevels.length) {
                setCurrentQuality(-1)
              } else {
                setCurrentQuality(nextIdx)
              }
            }
          }
          break
        case 's':
          if (e.shiftKey) {
            e.preventDefault()
            handleScreenshot()
          } else {
            e.preventDefault()
            {
              const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
              const currentIdx = speeds.indexOf(playbackRate)
              const nextIdx = currentIdx === -1 ? 2 : (currentIdx + 1) % speeds.length
              setPlaybackRate(speeds[nextIdx])
            }
          }
          break
        case 'arrowleft':
          if (seekable) {
            e.preventDefault()
            const video = videoRef.current || containerRef.current?.querySelector('video')
            if (video) video.currentTime = Math.max(0, video.currentTime - 10)
          }
          break
        case 'arrowright':
          if (seekable) {
            e.preventDefault()
            const video = videoRef.current || containerRef.current?.querySelector('video')
            if (video) {
              if (video.duration && isFinite(video.duration)) {
                video.currentTime = Math.min(video.duration, video.currentTime + 10)
              } else {
                video.currentTime += 10
              }
            }
          }
          break
        case '>':
        case '.':
          e.preventDefault()
          {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
            const currentIdx = speeds.indexOf(playbackRate)
            if (currentIdx < speeds.length - 1) {
              setPlaybackRate(speeds[currentIdx + 1])
            } else if (currentIdx === -1) {
              setPlaybackRate(1.25)
            }
          }
          break
        case '<':
        case ',':
          e.preventDefault()
          {
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]
            const currentIdx = speeds.indexOf(playbackRate)
            if (currentIdx > 0) {
              setPlaybackRate(speeds[currentIdx - 1])
            } else if (currentIdx === -1) {
              setPlaybackRate(0.75)
            }
          }
          break
      }
      showControls()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen, showControls, qualityLevels, currentQuality, playbackRate, handleScreenshot, seekable, togglePlay, toggleFullscreen])

  // ── Determine final URLs + type for the active player backend ──
  // For mpegts: route the .ts through /api/stream-proxy (raw .ts is CORS-blocked)
  // For m3u8_proxy: pass proxyUrl to HlsPlayer so it loads the manifest through proxy first
  // For m3u/m3u8/m3u8_direct: HlsPlayer tries direct first, falls back to proxyUrl
  // For m3u8_jw: JwHlsPlayer handles proxy-first
  // For dash: StreamPlayerWrapper (dash.js) with proxyUrl
  // For fifalive / github_m3u: streamUrl is the SOURCE page / file URL, but
  // the actual m3u8 is in `resolvedUrl`. Proxy must wrap the resolved URL,
  // not the source URL, so HlsPlayer can fall back direct→proxy correctly.
  // (Task 29)
  const hlsProxyUrl = proxyStreamUrl(resolvedUrl || streamUrl)
  const tsUrl = proxyStreamUrl(resolvedUrl) // .ts always through proxy
  const tsSrcForFallback = hlsFallbackMpegts ? proxyStreamUrl(resolvedUrl || streamUrl) : tsUrl

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden group ${
        fullscreen ? `fixed inset-0 z-50 ${cursorVisible ? 'cursor-default' : 'cursor-none'}` : 'rounded-none md:rounded-2xl'
      }`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        // Hide controls immediately when the pointer leaves the player.
        // (Task 26) Simplified — previously had isIframe/playing branches;
        // now consistent for all stream types.
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        setControlsVisible(false)
      }}
      onClick={() => {
        if (isIframe) showControls()
      }}
      onDoubleClick={(e) => { e.stopPropagation() }}
      onContextMenu={(e) => { if (isIframe || isIframeDirect) e.preventDefault() }}
      style={fullscreen ? {} : { aspectRatio: '16/9' }}
    >
      {/* Poster / placeholder */}
      {!resolvedUrl && !loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-black">
          <div className="text-center">
            <p className="text-white/50 text-sm">No stream URL configured</p>
          </div>
        </div>
      )}

      {/* ── HLS Player (hls.js with auto-fallback: direct → proxy → mpegts) ── */}
      {/* Used for: m3u, m3u8, m3u8_direct, m3u8_proxy, github_m3u (after resolve) */}
      {/* When hlsFallbackMpegts is true, TsPlayer takes over below. */}
      {isHls && !isJw && resolvedUrl && !hlsFallbackMpegts && !error && (
        <div className="absolute inset-0 overflow-hidden">
          <HlsPlayer
            src={resolvedUrl}
            originalUrl={streamUrl}
            proxyUrl={hlsProxyUrl}
            onReady={handleReady}
            onError={handleError}
            onQualityLevels={handleQualityLevels}
            onStatsUpdate={handleStatsUpdate}
            onVideoRef={handleVideoRef}
            selectedQuality={currentQuality}
            volume={volume}
            muted={muted}
            playbackRate={playbackRate}
            aspectMode={aspectMode}
            onLiveStatus={handleLiveStatus}
            seekToLive={seekToLive}
            onSeekedToLive={handleSeekedToLive}
            onBuffering={handleBuffering}
            selectedAudioTrack={currentAudioTrack}
            onAudioTracks={handleAudioTracks}
            selectedSubtitleTrack={currentSubtitleTrack}
            onLoadModeChange={handleHlsLoadModeChange}
            onRequestMpegts={handleRequestMpegts}
            onCurrentLevelChange={handleCurrentLevelChange}
            onSubtitleTracks={handleSubtitleTracks}
          />
        </div>
      )}

      {/* ── JW-style HLS Player (proxy-first) for m3u8_jw ── */}
      {isJw && resolvedUrl && !error && (
        <div className="absolute inset-0 overflow-hidden">
          <JwHlsPlayer
            src={streamUrl}
            proxySrc={proxyStreamUrl(streamUrl) + '&timeout=30000'}
            onReady={handleReady}
            onError={handleError}
            onVideoRef={handleVideoRef}
            volume={volume}
            muted={muted}
            playbackRate={playbackRate}
            aspectMode={aspectMode}
            onBuffering={handleBuffering}
          />
        </div>
      )}

      {/* ── MPEG-TS Player (mpegts.js) for raw .ts streams + HLS→mpegts fallback ── */}
      {/* liveBufferLatencyChasing: FALSE — proven working, no stutter/fast-playback. */}
      {/* When HEVC is detected, TsPlayer fires onCodecUnsupported → we swap to
          the HlsPlayer block below (fed by the transcode service). */}
      {(isMpegTs || hlsFallbackMpegts) && resolvedUrl && !error && !hevcTranscodeFallback && (
        <div className="absolute inset-0 overflow-hidden">
          <TsPlayer
            src={tsSrcForFallback}
            onReady={handleReady}
            onError={handleError}
            onVideoRef={handleVideoRef}
            volume={volume}
            muted={muted}
            playbackRate={playbackRate}
            aspectMode={aspectMode}
            onBuffering={handleBuffering}
            deinterlace={deinterlace}
            onCodecUnsupported={handleCodecUnsupported}
          />
        </div>
      )}

      {/* ── HEVC Transcode Fallback (HlsPlayer fed by transcode service) ── */}
      {/* When the browser can't decode HEVC, the transcode service converts
          HEVC → H.264 HLS in real-time. HlsPlayer plays the transcoded HLS
          on ALL browsers (Chrome, Firefox, Edge, Safari). */}
      {hevcTranscodeFallback && transcodePlaylistUrl && !error && (
        <div className="absolute inset-0 overflow-hidden">
          <HlsPlayer
            src={transcodePlaylistUrl}
            proxyUrl={transcodePlaylistUrl}
            onReady={handleReady}
            onError={handleError}
            onVideoRef={handleVideoRef}
            volume={volume}
            muted={muted}
            playbackRate={playbackRate}
            aspectMode={aspectMode}
            onBuffering={handleBuffering}
          />
        </div>
      )}

      {/* ── DASH Player (dash.js via StreamPlayerWrapper) ── */}
      {/* Only path that still uses the new StreamPlayer — old system had no DASH. */}
      {isDash && resolvedUrl && !error && (
        <StreamPlayerWrapper
          src={resolvedUrl}
          streamType="dash"
          poster={poster}
          muted={muted}
          autoplay={true}
          onReady={handleReady}
          onPlaying={() => { setLoading(false); setError(null) }}
          onError={(msg) => handleError(msg)}
        />
      )}

      {/* ── Iframe Direct Player — raw iframe embed, NO controls/lock/proxy ── */}
      {isIframeDirect && resolvedUrl && !error && (
        <IframeDirectPlayer
          src={resolvedUrl}
          title={title}
          onReady={() => setLoading(false)}
          onError={(e) => { setError(e); setLoading(false) }}
        />
      )}

      {/* ── Iframe Player — proxied iframe with controls/lock ── */}
      {isIframe && resolvedUrl && (
        <IframePlayer
          src={resolvedType === 'redirect' ? proxyIframeUrl(resolvedUrl) : resolvedUrl}
          originalUrl={streamUrl}
          onReady={() => setLoading(false)}
          onError={(e) => { setError(e); setLoading(false) }}
        />
      )}

      {/* Iframe reload hint */}
      {isIframe && !loading && !error && (
        <IframeReloadHint />
      )}

      {/* ── Mobile Iframe Touch Overlay ── */}
      {isIframe && isMobileDevice && iframeTouchLocked && !loading && (
        <div
          className="absolute inset-0 z-[5] cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            showControls()
          }}
          onTouchStart={(e) => {
            e.stopPropagation()
          }}
        />
      )}

      {/* Loading/buffering indicator */}
      {(loading || buffering) && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
        </div>
      )}

      {/* Screenshot flash effect */}
      {screenshotFlash && (
        <div className="absolute inset-0 z-40 bg-white animate-in fade-out duration-300 pointer-events-none" />
      )}

      {/* ── Tap-to-toggle overlay (mobile + desktop) ──
          PlayerControls sits at z-10 with pointer-events-none when hidden,
          so taps/clicks pass through to this z-5 layer. When controls are
          hidden, a tap here calls showControls() to reveal them. When
          controls are visible, PlayerControls (z-10) is on top and handles
          single-tap-to-hide / double-tap-to-fullscreen internally.
          This is what makes "tap to show, tap to hide" work on mobile. */}
      {!isIframe && !isIframeDirect && !isDash && resolvedUrl && (
        <div
          className="absolute inset-0 z-[5]"
          onClick={() => {
            if (!controlsVisible) {
              showControls()
            }
          }}
        />
      )}

      {/* ── Player Controls (for HLS / TS / JW — NOT iframe_direct, which has its own) ── */}
      {/* iframe gets its own PlayerControls instance below with isIframe=true. */}
      {/* DASH uses StreamPlayerWrapper which has its own controls — skip here. */}
      {!isIframe && !isIframeDirect && !isDash && resolvedUrl && (
        <PlayerControls
          isPlaying={playing}
          onTogglePlay={togglePlay}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          isMuted={muted}
          onToggleMute={toggleMute}
          isFullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onToggleControlsVisibility={toggleControlsVisibility}
          title={title}
          isLive={isLive}
          isLoading={loading}
          hasError={!!error}
          errorMessage={error || undefined}
          visible={controlsVisible}
          isIframe={false}
          iframeTouchLocked={false}
          onToggleIframeTouchLock={() => {}}
          onControlsBusy={setControlsBusy}
          qualityLevels={qualityLevels}
          currentQuality={currentQuality}
          onQualityChange={handleQualityChange}
          currentLevel={currentLevel}
          isHls={isHls}
          hlsStats={hlsStats || undefined}
          canSeek={seekable}
          isBehindLive={isBehindLive}
          onBackToLive={handleBackToLive}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          aspectMode={aspectMode}
          onAspectModeChange={setAspectMode}
          audioTracks={audioTracks}
          currentAudioTrack={currentAudioTrack}
          onAudioTrackChange={handleAudioTrackChange}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={currentSubtitleTrack}
          onSubtitleTrackChange={handleSubtitleTrackChange}
          onScreenshot={handleScreenshot}
          onRetry={handleRetry}
          deinterlace={deinterlace}
          onDeinterlaceChange={setDeinterlace}
        />
      )}

      {/* Iframe controls overlay — only for iframe mode */}
      {isIframe && (
        <PlayerControls
          isPlaying={false}
          onTogglePlay={() => {/* iframe controls its own playback */}}
          volume={1}
          onVolumeChange={() => {/* iframe volume not controllable */}}
          isMuted={false}
          onToggleMute={() => {}}
          isFullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onToggleControlsVisibility={toggleControlsVisibility}
          title={title}
          isLive={isLive}
          isLoading={loading}
          hasError={!!error}
          errorMessage={error || undefined}
          visible={controlsVisible}
          isIframe={true}
          iframeTouchLocked={iframeTouchLocked}
          onToggleIframeTouchLock={() => setIframeTouchLocked(v => !v)}
        />
      )}

      {/* Error overlay (for non-iframe streams where the player failed to load) */}
      {error && !isIframe && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90 p-6 text-center">
          <div className="text-white/60 text-sm font-medium">{error}</div>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Transcoding overlay — shown while the server transcodes HEVC → H.264.
          Tells the user why there's a short delay so they don't think it's
          stuck/buffering. */}
      {transcodeLoading && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90 p-6 text-center">
          <div className="h-8 w-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <div className="text-white/80 text-sm font-medium">Converting stream for your browser…</div>
          <div className="text-white/40 text-xs">This takes a few seconds for HEVC streams.</div>
        </div>
      )}

      {/* Suppress unused-prop warnings — these are kept for API compatibility
          with the previous StreamPlayer-based version but not used by the old
          orchestration. The reactive-refresh flow is handled inside HlsPlayer's
          own error path. */}
      {channelId === undefined && onStreamUrlRefreshed === undefined ? null : null}
    </div>
  )
}
