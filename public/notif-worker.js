/**
 * Notification polling worker.
 *
 * Runs a setInterval that is NOT subject to the main-thread background-tab
 * throttling (Chrome's "intensive throttling" caps main-thread timers to
 * 1/min after 5 min in the background; Web Worker timers are exempt and
 * only subject to the milder 1/s regular throttle). This lets us detect
 * new notifications promptly while the site's tab is in the background,
 * so the <audio> chime can play (the user is in another tab but the site
 * is still open).
 *
 * The worker does NOT play sound itself (no DOM access). It fetches the
 * notifications endpoint, diffs the ID set against the previous fetch, and
 * posts a message to the main thread whenever there are genuinely-new
 * notifications. The main thread then plays the sound + shows the popup.
 *
 * Messages (main → worker):
 *   { type: 'start', interval: number }   — begin polling
 *   { type: 'stop' }                       — stop polling
 *   { type: 'pause' }                      — pause polling (tab hidden AND
 *                                            no need to poll — saves battery)
 *   { type: 'resume' }                     — resume polling
 *
 * Messages (worker → main):
 *   { type: 'notifications', data: Notif[] }
 *     — full list from a fetch (main thread recomputes unread + popup)
 *   { type: 'new', data: Notif[] }
 *     — subset of notifications that are genuinely new (not in the previous
 *       fetch's ID set). Main thread plays sound + popup for data[0].
 *       `new` is only sent for fetches AFTER the first one (the first
 *       fetch's notifications are pre-existing and must stay silent).
 *   { type: 'error', message: string }
 */

self.onmessage = (e) => {
  const msg = e.data || {}
  switch (msg.type) {
    case 'start':
      startPolling(msg.interval || 30000)
      break
    case 'stop':
      stopPolling()
      break
    case 'pause':
      paused = true
      break
    case 'resume':
      paused = false
      // Trigger an immediate fetch on resume so the user sees fresh data
      // right away when they return to the tab.
      fetchOnce()
      break
  }
}

let timer = null
let prevIds = new Set()
let isFirstFetch = true
let paused = false
let inFlight = false

function startPolling(interval) {
  stopPolling()
  // Fetch immediately on start.
  fetchOnce()
  timer = setInterval(fetchOnce, interval)
}

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function fetchOnce() {
  // Skip while paused (tab hidden) — the main thread will send 'resume'
  // on visibilitychange, which triggers an immediate fetch.
  if (paused) return
  // Prevent overlapping fetches if the interval fires faster than the
  // fetch completes.
  if (inFlight) return
  inFlight = true
  try {
    const res = await fetch('/api/notifications?limit=30', {
      cache: 'no-store',
    })
    if (!res.ok) return
    const data = await res.json()
    if (!Array.isArray(data)) return

    // Always send the full list so the main thread can recompute unread.
    self.postMessage({ type: 'notifications', data })

    // Detect genuinely-new IDs (not in the previous fetch). Only flag as
    // "new" AFTER the first fetch — the first fetch's notifications are
    // pre-existing and must NOT trigger sound/popup (the user who opens
    // the site later should not hear old notifications).
    if (!isFirstFetch) {
      const newOnes = data.filter((n) => !prevIds.has(n.id))
      if (newOnes.length > 0) {
        self.postMessage({ type: 'new', data: newOnes })
      }
    }
    prevIds = new Set(data.map((n) => n.id))
    isFirstFetch = false
  } catch (err) {
    // Network errors are non-fatal — keep the previous ID set and retry
    // on the next interval.
    self.postMessage({ type: 'error', message: String(err && err.message || err) })
  } finally {
    inFlight = false
  }
}
