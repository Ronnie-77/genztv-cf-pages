'use client'

// ─────────────────────────────────────────────────────────────────────────────
// StreamPlayerWrapper
//
// React wrapper around the uploaded StreamPlayer class
// (src/components/player/stream-player.ts → imported directly as a module).
// This is the new production player for M3U/HLS, M3U/HLS Proxy, and MPEG-TS
// (.ts) streams. The iframe player is unchanged.
//
// Why a wrapper instead of a from-scratch React player?
//   The uploaded player.js is a self-contained, production-tested class with
//   its own DOM, CSS, stall watchdog, CDN failover, and conservative ABR
//   tuning. Re-implementing that in React would risk regressions. Instead we
//   mount the class into a container div and bridge its events to React props.
//
// Buffer / reliability guarantees (configured in stream-player.ts HLS_CONFIG):
//   • Forward buffer  — maxBufferLength: 30s (loads 30s ahead)
//   • Stall watchdog  — 5s freeze → 3-stage auto-recovery (force-play → recoverMediaError → CDN rotate)
//   • Conservative ABR — abrBandWidthFactor 0.95, abrEwmaSlowLive 9.0 (drops quality before buffer)
//   • CDN failover    — pass streamUrls[] for auto-rotation on error
//
// Reactive Token Refresh:
//   When the player fires a fatal 'error' event (typically a 403/404 from the
//   upstream CDN because the signed-URL token expired), the wrapper calls
//   /api/channels/[id]/reactive-refresh to re-extract a fresh m3u8 from the
//   channel's source page. If a new URL is returned, the player is reloaded
//   with it — completely transparent to the viewer.
//
//   Rate limits (enforced server-side):
//     - 1 refresh per 30s per channel
//     - max 5 refreshes per 10 min per channel
//   The wrapper also caps at 2 client-side attempts per stream session.
//
// Iframe streams (streamType 'iframe' / 'redirect') are NOT handled here —
// they continue to use the existing IframePlayer component.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react'
// Import the CSS so Turbopack bundles it with the component.
import './stream-player.css'
// Import the StreamPlayer class + SP_TYPE directly as ES modules.
import { StreamPlayer, SP_TYPE } from './stream-player'
import { reactiveRefreshChannel } from '@/lib/api'

// Re-export the stream type so the parent can reference it.
export type StreamPlayerType = 'hls' | 'hls-proxy' | 'mpegts' | 'dash'

// Max client-side reactive refresh attempts per stream session.
// The server has its own rate limit (5 per 10 min), but we cap lower on the
// client so a completely dead stream doesn't keep retrying forever.
const MAX_REACTIVE_ATTEMPTS = 2

interface StreamPlayerWrapperProps {
  /** The raw stream URL (already resolved by parent). */
  src: string
  /** Stream type — maps to StreamPlayer.TYPE. */
  streamType: StreamPlayerType
  /** Proxy prefix for 'hls-proxy' type, e.g. '/api/stream-proxy?url='. */
  proxyUrl?: string
  /** Optional poster image shown before playback starts. */
  poster?: string
  /** Stream title shown in the player's title badge. */
  title?: string
  /** Accent color (hex) — defaults to GenZ TV's primary red. */
  accentColor?: string
  /** Start muted (required for autoplay on most browsers). */
  muted?: boolean
  /** Auto-start playback on load. */
  autoplay?: boolean
  /** Channel ID — used for reactive token refresh on 403 errors. */
  channelId?: string
  /** Called when a reactive refresh produces a new stream URL — parent should
   *  update its stored channel.streamUrl so future loads use the fresh URL. */
  onStreamUrlRefreshed?: (newUrl: string) => void
  /** Called when the player fires its 'ready' event (first frame). */
  onReady?: () => void
  /** Called when playback starts. */
  onPlaying?: () => void
  /** Called when a stall is detected (retryCount is the argument). */
  onStalled?: (retryCount: number) => void
  /** Called on fatal error (message, sub). */
  onError?: (message: string, sub?: string) => void
  /** Called when quality levels are parsed from the manifest. */
  onLevelLoaded?: (levels: unknown[]) => void
  /** Called when the active quality changes. */
  onQualityChanged?: (levelIndex: number) => void
}

// Minimal type for the StreamPlayer instance we interact with.
interface StreamPlayerInstance {
  init(opts: { streamUrls?: string[]; streamType?: StreamPlayerType; proxyUrl?: string }): void
  play(): void
  pause(): void
  togglePlay(): void
  setVolume(v: number): void
  mute(): void
  toggleMute(): void
  setQuality(level: number): void
  goLive(): void
  toggleFullscreen(): void
  destroy(): void
  on(event: string, cb: (...args: unknown[]) => void): StreamPlayerInstance
  off(event: string, cb: (...args: unknown[]) => void): void
}

export function StreamPlayerWrapper({
  src,
  streamType,
  proxyUrl,
  poster,
  title,
  accentColor = '#e63946',
  muted = true,
  autoplay = true,
  channelId,
  onStreamUrlRefreshed,
  onReady,
  onPlaying,
  onStalled,
  onError,
  onLevelLoaded,
  onQualityChanged,
}: StreamPlayerWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<StreamPlayerInstance | null>(null)
  // Keep latest callbacks in refs so we don't re-init the player on every render.
  const cbRef = useRef({ onReady, onPlaying, onStalled, onError, onLevelLoaded, onQualityChanged, onStreamUrlRefreshed })
  cbRef.current = { onReady, onPlaying, onStalled, onError, onLevelLoaded, onQualityChanged, onStreamUrlRefreshed }

  // Reactive refresh state — tracked across the stream session.
  const reactiveAttemptsRef = useRef(0)
  const reactiveInFlightRef = useRef(false)
  // Track the current src inside a ref so the error handler can read the
  // latest value without being stale (the error callback closes over `src`
  // at init time, but the parent may have updated it via onStreamUrlRefreshed).
  const currentSrcRef = useRef(src)
  currentSrcRef.current = src

  useEffect(() => {
    if (!containerRef.current) return

    // Reset reactive refresh state when the src changes (new stream session).
    reactiveAttemptsRef.current = 0
    reactiveInFlightRef.current = false

    let player: StreamPlayerInstance | null = null
    try {
      // Map our stream type to the SP_TYPE constant expected by StreamPlayer.
      const spType = streamType === 'hls-proxy'
        ? SP_TYPE.HLS_PROXY
        : streamType === 'mpegts'
          ? SP_TYPE.MPEGTS
          : streamType === 'dash'
            ? SP_TYPE.DASH
            : SP_TYPE.HLS

      // Build options. streamUrls is an array — we pass a single URL here;
      // the player's CDN-failover support is available if multiple are passed.
      const opts = {
        streamUrls: [src],
        streamType: spType,
        proxyUrl: proxyUrl || '',
        autoplay,
        muted,
        poster: poster || '',
        title: title || '',
        showTitle: !!title,
        accentColor,
        debug: false,
      }

      // StreamPlayer is a class; cast through unknown to our minimal instance type.
      player = new StreamPlayer(containerRef.current, opts) as unknown as StreamPlayerInstance
      playerRef.current = player

      // Bridge events to React callbacks.
      player.on('ready', () => cbRef.current.onReady?.())
      player.on('playing', () => cbRef.current.onPlaying?.())
      player.on('stalled', (retryCount) => cbRef.current.onStalled?.(retryCount as number))
      player.on('levelLoaded', (levels) => cbRef.current.onLevelLoaded?.(levels as unknown[]))
      player.on('qualityChanged', (level) => cbRef.current.onQualityChanged?.(level as number))

      // ── Reactive token refresh on network errors (403/404) ──
      // The StreamPlayer class fires 'networkError' IMMEDIATELY when hls.js
      // reports a fatal network error (before its internal retry loop). We
      // listen for it here and trigger a reactive refresh so the player can
      // recover from an expired token in ~1s instead of waiting for 6 retries.
      //
      // The 'error' event fires later (after all retries fail) — we also
      // handle it as a fallback in case the early refresh didn't help.
      const tryReactiveRefresh = async (errorType: string) => {
        if (
          channelId &&
          !reactiveInFlightRef.current &&
          reactiveAttemptsRef.current < MAX_REACTIVE_ATTEMPTS
        ) {
          reactiveInFlightRef.current = true
          reactiveAttemptsRef.current += 1
          console.log(
            `[StreamPlayerWrapper] 🔑 ${errorType} — triggering reactive refresh ` +
            `(attempt ${reactiveAttemptsRef.current}/${MAX_REACTIVE_ATTEMPTS}) for channel ${channelId}`
          )
          try {
            const result = await reactiveRefreshChannel(channelId)
            reactiveInFlightRef.current = false

            if (result.refreshed && result.streamUrl && result.streamUrl !== currentSrcRef.current) {
              console.log(`[StreamPlayerWrapper] ✅ Reactive refresh succeeded — reloading player with fresh URL`)
              cbRef.current.onStreamUrlRefreshed?.(result.streamUrl)
              // Parent will update `src` prop → effect re-runs → player re-inits.
              reactiveAttemptsRef.current = 0
              return true
            } else {
              console.warn(
                `[StreamPlayerWrapper] Reactive refresh did not return a new URL: ` +
                (result.reason || 'same URL or not enabled')
              )
            }
          } catch (err) {
            reactiveInFlightRef.current = false
            const errMsg = err instanceof Error ? err.message : 'Unknown refresh error'
            console.warn(`[StreamPlayerWrapper] Reactive refresh failed: ${errMsg}`)
          }
        }
        return false
      }

      // Early trigger: fires on the first fatal network error (before retries).
      player.on('networkError', async (details, response) => {
        console.log(`[StreamPlayerWrapper] Network error detected (details: ${details}, status: ${response})`)
        await tryReactiveRefresh('Network error')
      })

      // Fallback: fires after all retries are exhausted.
      player.on('error', async (msg, sub) => {
        const message = msg as string
        const subMsg = sub as string | undefined
        const refreshed = await tryReactiveRefresh('Fatal playback error')
        if (refreshed) return // re-loading — skip onError

        const refreshNote = channelId
          ? reactiveAttemptsRef.current >= MAX_REACTIVE_ATTEMPTS
            ? ' Auto-refresh was attempted but the source page did not return a fresh URL.'
            : ' The token may have expired — try again later or contact admin.'
          : ''
        cbRef.current.onError?.(message + refreshNote, subMsg)
      })
    } catch (err) {
      console.error('[StreamPlayerWrapper] Failed to init player:', err)
      cbRef.current.onError?.('Player failed to initialize.', String(err))
    }

    return () => {
      if (player) {
        try {
          player.destroy()
        } catch {
          // ignore — player may already be destroyed
        }
      }
      playerRef.current = null
    }
    // Re-init only when the stream URL or type changes — NOT on every callback change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, streamType, proxyUrl, poster, title, accentColor, muted, autoplay, channelId])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full stream-player-host"
      // The StreamPlayer class builds its own DOM inside this container.
      // tabindex lets the player receive keyboard events (space/mute/fullscreen).
      tabIndex={0}
      role="region"
      aria-label="Video player"
    />
  )
}
