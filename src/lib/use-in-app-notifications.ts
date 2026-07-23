'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * useInAppNotifications — professional in-app notification logic.
 *
 * POLLING STRATEGY (background-tab safe):
 *   Polling runs inside a Web Worker (public/notif-worker.js), NOT on the
 *   main thread. This is critical: Chrome's "intensive throttling" caps
 *   main-thread setInterval to once-per-minute after a tab has been in
 *   the background for 5 minutes, which would delay new-notification
 *   detection (and thus the sound) by up to a minute. Web Worker timers
 *   are exempt from intensive throttling (only the milder 1/s regular
 *   throttle applies), so we detect new notifications promptly even while
 *   the site's tab is in the background. The worker posts a message to
 *   the main thread whenever genuinely-new notifications arrive; the main
 *   thread then plays the sound + shows the popup.
 *
 * SOUND STRATEGY:
 *   We use an HTMLAudioElement playing a generated WAV data URI, NOT the
 *   Web Audio API. Rationale: browsers SUSPEND AudioContext when a tab is
 *   backgrounded and resuming requires a fresh user gesture — so a
 *   notification arriving while the tab is in the background produced no
 *   sound with Web Audio. <audio> elements, once unlocked by a single
 *   user interaction, continue to play reliably in background tabs.
 *
 *   The WAV is a two-tone "ding-dong" (E5 659.25 Hz then A4 440 Hz) that
 *   OVERLAPS — A4 starts at 0.18s while E5 is still ringing (until 0.35s).
 *   This matches the original Web Audio sound exactly: master gain 0.18,
 *   sine wave, quick exponential attack (0.02s) + exponential decay, and
 *   the same frequencies/durations/peaks.
 *
 *   The <audio> element is "unlocked" by a single user gesture via a
 *   MUTED silent play (play → pause → unmute). The muted play is truly
 *   inaudible, so opening the site and clicking the bell does NOT produce
 *   a stray chime (this was a previous bug).
 *
 * BACKGROUND-TAB SOUND (the tricky part):
 *   Chrome suspends audio rendering for backgrounded tabs unless the site
 *   has high "media engagement". So even though <audio>.play() resolves,
 *   no sound is audible. We solve this with a SILENT KEEP-ALIVE loop: a
 *   near-inaudible (~-70 dB) 1-second WAV that loops continuously WHILE
 *   the tab is hidden. Chrome treats the tab as "playing audio" and keeps
 *   the audio system active, so the chime is audible when a notification
 *   arrives. The keep-alive is stopped when the tab becomes visible (so
 *   the tab's 🔊 indicator only shows while backgrounded — exactly when we
 *   need it). This is the same technique Slack/Discord web use.
 *
 * SOUND RULES (per user requirement):
 *   - Tab active  → sound plays when a new notification arrives.
 *   - Tab in background (site open in another tab) → sound plays (via the
 *     worker + <audio> + keep-alive combination).
 *   - Site NOT open (browser closed / site not loaded) → no sound. When
 *     the user later opens the site, the first fetch's notifications are
 *     treated as pre-existing and stay silent (the worker only flags
 *     "new" after its first fetch).
 */

export interface InAppNotification {
  id: string
  type: string // "channel" | "update" | "feature" | "notice"
  title: string
  body: string
  url: string
  imageUrl: string
  createdAt: string // ISO
}

const STORAGE_KEY = 'genztv:notif-last-read'
const POLL_INTERVAL = 30_000 // 30 seconds

// ── localStorage helpers ──

function readLastReadAt(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLastReadAt(iso: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, iso)
  } catch {
    // ignore storage errors (private mode, quota etc.)
  }
}

// ── Sound: HTMLAudioElement + generated WAV data URI ──

let cachedWavDataUri: string | null = null
let audioEl: HTMLAudioElement | null = null
let audioUnlocked = false
let audioUnlockAttached = false

// Keep-alive audio element: a looping near-silent track that keeps Chrome's
// audio system "active" while the tab is in the background. Without this,
// Chrome suspends audio rendering for backgrounded tabs (unless the site
// has high "media engagement"), so <audio>.play() would resolve but
// produce no audible sound. The keep-alive is started when the tab goes
// hidden and stopped when it becomes visible again.
let keepAliveEl: HTMLAudioElement | null = null
let keepAliveActive = false

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Generates the two-tone "ding-dong" WAV as a data URI. This reproduces
 * the ORIGINAL Web Audio sound exactly:
 *   - Master gain 0.18
 *   - E5 (659.25 Hz): starts at 0s, duration 0.35s, peak 0.9
 *   - A4 (440 Hz):    starts at 0.18s (OVERLAPS E5), duration 0.5s, peak 0.7
 *   - Sine wave
 *   - Exponential attack: 0.0001 → peak over 0.02s
 *   - Exponential decay:  peak → 0.0001 over the remaining duration
 *
 * The two tones overlap for ~0.17s (A4 starts at 0.18s, E5 rings until
 * 0.35s), giving the rich, bell-like chime of the original. Mono, 16-bit,
 * 44100 Hz for fidelity (the original Web Audio ran at the browser's
 * native rate, typically 44100).
 *
 * Total length: ~0.68s (A4 ends at 0.18+0.5 = 0.68s).
 */
function generateDingDongWav(): string {
  if (cachedWavDataUri) return cachedWavDataUri
  const sampleRate = 44100
  const totalDur = 0.68 // E5 0→0.35, A4 0.18→0.68
  const totalSamples = Math.floor(totalDur * sampleRate)
  const bytesPerSample = 2
  const channels = 1
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = totalSamples * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  // RIFF / WAVE header
  writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(view, 8, 'WAVE')
  writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeStr(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Master gain (matches the original Web Audio master.gain.value = 0.18).
  const master = 0.18

  // Helper: the gain envelope for a tone at absolute time t (seconds),
  // given its start time, duration, and peak. Reproduces the Web Audio
  // exponentialRamp envelope: 0.0001 → peak over 0.02s (attack), then
  // peak → 0.0001 over the rest of the duration (decay). Before the tone
  // starts or after it ends, gain is 0.
  function toneGain(t, start, duration, peak) {
    if (t < start || t > start + duration) return 0
    const local = t - start
    const attack = 0.02
    if (local < attack) {
      // Exponential attack from 0.0001 to peak. We use a linear-ish ramp
      // in the log domain to approximate exponentialRampToValueAtTime.
      const ratio = local / attack
      return 0.0001 * Math.pow(peak / 0.0001, ratio)
    }
    // Exponential decay from peak to 0.0001 over (duration - attack).
    const decayDur = duration - attack
    const decayLocal = local - attack
    const ratio = decayLocal / decayDur
    return peak * Math.pow(0.0001 / peak, ratio)
  }

  // Mix both tones sample-by-sample. E5 and A4 overlap between 0.18s and
  // 0.35s — their samples sum (then clamp to [-1, 1]).
  let off = 44
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    const e5 = Math.sin(2 * Math.PI * 659.25 * t) * toneGain(t, 0, 0.35, 0.9)
    const a4 =
      Math.sin(2 * Math.PI * 440.0 * t) * toneGain(t, 0.18, 0.5, 0.7)
    let s = (e5 + a4) * master
    // Clamp to avoid clipping when the two sines constructively sum.
    if (s > 1) s = 1
    if (s < -1) s = -1
    view.setInt16(off, s * 32767, true)
    off += 2
  }

  // ArrayBuffer → base64 data URI
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  cachedWavDataUri = 'data:audio/wav;base64,' + btoa(binary)
  return cachedWavDataUri
}

/**
 * Generates a 1-second WAV of very-low-amplitude white noise (~-70 dB,
 * effectively inaudible on any normal speaker). Used as a looping
 * keep-alive track so Chrome considers the tab as "playing audio" and
 * doesn't suspend audio rendering when the tab goes to the background.
 * A pure-silence WAV (all zeros) does NOT work — Chrome detects it as
 * silent and still suspends. The tiny noise keeps the audio renderer
 * genuinely active while remaining inaudible to humans.
 */
let cachedSilentWavDataUri: string | null = null
function generateSilentWav(): string {
  if (cachedSilentWavDataUri) return cachedSilentWavDataUri
  const sampleRate = 8000
  const numSamples = sampleRate * 1 // 1 second
  const dataSize = numSamples * 2 // 16-bit
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(view, 8, 'WAVE')
  writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  // Very low amplitude noise: ±10 out of 32767 ≈ -70 dB (inaudible).
  for (let i = 0; i < numSamples; i++) {
    const noise = (Math.random() * 2 - 1) * 10
    view.setInt16(44 + i * 2, noise, true)
  }
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  cachedSilentWavDataUri = 'data:audio/wav;base64,' + btoa(binary)
  return cachedSilentWavDataUri
}

/**
 * Lazily creates the keep-alive <audio> element (looping silent WAV at
 * very low volume). Returns null if the DOM isn't available.
 */
function ensureKeepAliveElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!keepAliveEl) {
    try {
      keepAliveEl = new Audio(generateSilentWav())
      keepAliveEl.loop = true
      keepAliveEl.volume = 0.001 // near-silent
    } catch {
      return null
    }
  }
  return keepAliveEl
}

/**
 * Starts the keep-alive loop. Only works after the audio has been
 * unlocked by a prior user gesture (otherwise play() is blocked by the
 * autoplay policy). Idempotent.
 */
function startKeepAlive() {
  if (typeof window === 'undefined') return
  if (!audioUnlocked) return // not yet unlocked by user gesture
  const el = ensureKeepAliveElement()
  if (!el || keepAliveActive) return
  keepAliveActive = true
  el.currentTime = 0
  el.play().catch(() => {
    keepAliveActive = false
  })
}

/**
 * Stops the keep-alive loop. Idempotent. Called when the tab becomes
 * visible so the tab's 🔊 indicator disappears.
 */
function stopKeepAlive() {
  if (!keepAliveEl || !keepAliveActive) return
  keepAliveActive = false
  keepAliveEl.pause()
}

/**
 * Lazily creates the shared <audio> element and attaches a one-time unlock
 * listener. The unlock does a MUTED silent play (play → pause → unmute)
 * which satisfies the browser autoplay policy WITHOUT producing any
 * audible sound — so clicking the bell right after page load does NOT
 * play a stray chime. After unlock, play() works even when the tab is in
 * the background.
 */
function ensureAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!audioEl) {
    try {
      audioEl = new Audio(generateDingDongWav())
      audioEl.volume = 1.0
      audioEl.preload = 'auto'
    } catch {
      return null
    }
  }
  if (!audioUnlockAttached) {
    audioUnlockAttached = true
    const unlock = () => {
      if (!audioEl) return
      // Muted silent play — truly inaudible. This unlocks the element so
      // subsequent play() calls (including from worker messages while the
      // tab is in the background) succeed.
      audioEl.muted = true
      audioEl
        .play()
        .then(() => {
          audioEl.pause()
          audioEl.currentTime = 0
          audioEl.muted = false
          audioUnlocked = true
          // Also unlock the keep-alive element with the SAME user gesture.
          // This is critical: the keep-alive needs to be unlocked now so it
          // can start playing later (when the tab goes to the background)
          // WITHOUT needing another gesture — background tabs can't fire
          // user gestures.
          const ka = ensureKeepAliveElement()
          if (ka) {
            ka.muted = true
            ka.play()
              .then(() => {
                ka.pause()
                ka.currentTime = 0
                ka.muted = false
                // If the tab is ALREADY hidden when the user first
                // interacts (rare), start the keep-alive immediately.
                if (document.visibilityState === 'hidden') {
                  startKeepAlive()
                }
              })
              .catch(() => {
                ka.muted = false
              })
          }
          // If a notification arrived while audio was locked, replay its
          // sound now. This handles the case where the user was in another
          // tab when the notification arrived and hadn't yet interacted
          // with the page.
          if (pendingSoundNotifId) {
            const pendingId = pendingSoundNotifId
            pendingSoundNotifId = null
            // Mark as played so the dedup doesn't skip it.
            lastSoundNotifId = pendingId
            // Now play the sound (audio is unlocked, so play() will
            // succeed). FIXED: was `el` (undefined ReferenceError) — now
            // `audioEl`.
            audioEl.currentTime = 0
            audioEl.play().catch(() => {
              // best effort — if this still fails, there's nothing more
              // we can do.
            })
          }
        })
        .catch(() => {
          // Autoplay still blocked — reset so we retry on the next gesture.
          audioEl.muted = false
          audioUnlockAttached = false
        })
      window.removeEventListener('click', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
    window.addEventListener('click', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    window.addEventListener('touchstart', unlock, { once: true })
  }
  return audioEl
}

// Module-level dedup for SOUND only. The app mounts two bells (mobile
// TopNav + desktop Sidebar); both hooks set `latestNewNotification` so the
// visible bell renders the popup, but sound must play only ONCE.
let lastSoundNotifId: string | null = null

// When play() fails because the audio isn't unlocked yet (autoplay
// policy), we store the pending notification ID here. The audio unlock
// callback (on first user gesture) checks this and replays the sound.
// This ensures that a notification that arrived while the user hadn't
// yet interacted with the page STILL plays its sound once they do
// interact — even if they're in another tab when it arrived.
let pendingSoundNotifId: string | null = null

/**
 * Plays the notification chime. Works in background tabs once the element
 * has been unlocked by a prior user interaction. If play() fails (audio
 * not yet unlocked), the notification ID is stored as pending and the
 * sound is replayed when the user first interacts with the page.
 *
 * Returns true if the sound played (or was already played for this ID),
 * false if it's pending (will replay on unlock).
 */
function playNotificationSound(notifId: string): boolean {
  if (typeof window === 'undefined') return true
  try {
    const el = ensureAudioElement()
    if (!el) return true
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // Sound played successfully — clear any pending retry for this ID.
        if (pendingSoundNotifId === notifId) pendingSoundNotifId = null
      }).catch(() => {
        // Autoplay blocked — the user hasn't interacted with the page yet.
        // Store this as pending so the unlock callback can replay it.
        pendingSoundNotifId = notifId
      })
    }
    return true
  } catch {
    // best effort — treat as played to avoid retry loops
    return true
  }
}

export function useInAppNotifications() {
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  // Lazy initializer: read from localStorage on the client during the first
  // render. This avoids a setState-in-effect (which React 19's lint rule
  // flags as a cascading-render risk) and ensures the very first paint
  // already has the correct lastReadAt value.
  const [lastReadAt, setLastReadAtState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return readLastReadAt()
  })
  const [isLoading, setIsLoading] = useState(true)
  // The most recent genuinely-new notification — drives the 3-second popup.
  const [latestNewNotification, setLatestNewNotification] =
    useState<InAppNotification | null>(null)

  // Refs (stable across renders, don't trigger re-renders):
  // Initialize from localStorage lazily too, so ref + state stay in sync
  // from the very first render (no mount effect needed).
  const lastReadAtRef = useRef<string | null>(
    typeof window !== 'undefined' ? readLastReadAt() : null
  )
  const workerRef = useRef<Worker | null>(null)

  // Prepare the audio element on mount. The lastReadAt state + ref are
  // already initialized via lazy initializers above, so no setState here.
  useEffect(() => {
    ensureAudioElement()
  }, [])

  // Recompute unread count from a notification list using the current
  // lastReadAt. Used by the worker-message handler and the storage event.
  const recomputeUnread = useCallback((list: InAppNotification[]) => {
    const lastRead = lastReadAtRef.current
    const lastReadTime = lastRead ? new Date(lastRead).getTime() : 0
    return list.filter(
      (n) => new Date(n.createdAt).getTime() > lastReadTime
    ).length
  }, [])

  // Start the polling Web Worker. The worker fetches on its own timer
  // (NOT subject to main-thread background throttling) and posts messages
  // back: 'notifications' (full list) and 'new' (genuinely-new subset).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.Worker) return // fallback: no polling (rare)

    let worker: Worker
    try {
      worker = new Worker('/notif-worker.js')
    } catch {
      return // worker creation failed — no polling
    }
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data || {}
      if (msg.type === 'notifications' && Array.isArray(msg.data)) {
        const data = msg.data as InAppNotification[]
        setNotifications(data)
        setUnreadCount(recomputeUnread(data))
        setIsLoading(false)
      } else if (msg.type === 'new' && Array.isArray(msg.data)) {
        const newOnes = msg.data as InAppNotification[]
        if (newOnes.length > 0) {
          // Both bells set the popup state — the visible one renders it.
          setLatestNewNotification(newOnes[0])
          // Sound: dedup so only one bell plays it. Pass the notification
          // ID so playNotificationSound can store it as pending if play()
          // fails (autoplay not yet unlocked).
          if (lastSoundNotifId !== newOnes[0].id) {
            lastSoundNotifId = newOnes[0].id
            playNotificationSound(newOnes[0].id)
          }
        }
      }
      // 'error' messages are ignored (non-fatal).
    }

    worker.postMessage({ type: 'start', interval: POLL_INTERVAL })

    return () => {
      worker.postMessage({ type: 'stop' })
      worker.terminate()
      workerRef.current = null
    }
  }, [recomputeUnread])

  // When the tab's visibility changes:
  //   - visible → hidden: START the keep-alive loop so Chrome doesn't
  //     suspend audio rendering while the tab is in the background. This
  //     is the KEY fix that makes the chime audible in background tabs.
  //   - hidden → visible: STOP the keep-alive (so the tab's 🔊 indicator
  //     disappears) and trigger an immediate fetch (via 'resume') so the
  //     user sees fresh data right away.
  // We do NOT pause the worker when the tab is hidden — the worker keeps
  // polling in the background precisely so that new notifications trigger
  // the sound WHILE the user is in another tab (per the user's
  // requirement).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        stopKeepAlive()
        const w = workerRef.current
        if (w) w.postMessage({ type: 'resume' })
      } else {
        startKeepAlive()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () =>
      document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Cross-tab sync: if another tab marks all read, clear this tab's badge.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const newVal = e.newValue
      lastReadAtRef.current = newVal
      setLastReadAtState(newVal)
      setNotifications((prev) => {
        setUnreadCount(recomputeUnread(prev))
        return prev
      })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [recomputeUnread])

  /**
   * Marks all current notifications as read: persists `now` to localStorage,
   * updates the ref + state, and clears the badge.
   */
  const markAllRead = useCallback(() => {
    const now = new Date().toISOString()
    writeLastReadAt(now)
    lastReadAtRef.current = now
    setLastReadAtState(now)
    setUnreadCount(0)
  }, [])

  const dismissLatestNew = useCallback(() => {
    setLatestNewNotification(null)
  }, [])

  // Manual refetch (used by the dropdown "refresh" button). Posts a
  // 'resume' to the worker, which triggers an immediate fetch.
  const refetch = useCallback(() => {
    const w = workerRef.current
    if (w) w.postMessage({ type: 'resume' })
  }, [])

  return {
    notifications,
    unreadCount,
    lastReadAt,
    isLoading,
    latestNewNotification,
    dismissLatestNew,
    refetch,
    markAllRead,
  }
}
