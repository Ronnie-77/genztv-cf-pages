'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'

let lastTrackedKey = ''
let lastTrackedTime = 0

export function trackPageView(
  page: string,
  channelId?: string,
  matchId?: string
) {
  // Debounce: don't send same page+channel+match within 5 seconds
  const key = `${page}:${channelId || ''}:${matchId || ''}`
  const now = Date.now()
  if (key === lastTrackedKey && now - lastTrackedTime < 5000) return
  lastTrackedKey = key
  lastTrackedTime = now

  fetch('/api/analytics/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page,
      channelId: channelId || undefined,
      matchId: matchId || undefined,
      referrer: typeof document !== 'undefined' ? document.referrer : '',
    }),
  }).catch(() => {
    // Silently ignore analytics errors
  })
}

/**
 * Lightweight "I'm still watching" ping. Updates ONLY the visitor's
 * lastSeen + currentChannelId + currentMatchId on the server — does NOT
 * create a PageView or inflate view counts. Called every ~15s by
 * useAnalytics while the visitor is on the watch page so the admin's
 * "live viewers" count stays accurate and near real-time.
 */
export function trackHeartbeat(channelId?: string, matchId?: string) {
  fetch('/api/analytics/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId: channelId || undefined,
      matchId: matchId || undefined,
    }),
  }).catch(() => {
    // Silently ignore heartbeat errors
  })
}

export function useAnalytics() {
  const { currentPage, currentChannelId, currentMatchId } = useAppStore()
  const initialized = useRef(false)
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Track page view on navigation change. When on the watch page we pass
  // both channelId and matchId (whichever is set) so the server can
  // attribute the view to the right entity for live-viewer counting.
  useEffect(() => {
    const isWatch = currentPage === 'watch'
    const channelId = isWatch ? currentChannelId || undefined : undefined
    const matchId = isWatch ? currentMatchId || undefined : undefined
    trackPageView(currentPage, channelId, matchId)
  }, [currentPage, currentChannelId, currentMatchId])

  // Track initial page load
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      const isWatch = currentPage === 'watch'
      const channelId = isWatch ? currentChannelId || undefined : undefined
      const matchId = isWatch ? currentMatchId || undefined : undefined
      trackPageView(currentPage, channelId, matchId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Heartbeat: while on the watch page, ping the server every 15s so the
  // admin's "live viewers" count reflects that this visitor is still
  // watching and updates near real-time. When the visitor navigates away
  // from watch, send one final heartbeat with no ids (clears the
  // attribution) and stop the interval.
  useEffect(() => {
    // Clear any previous timer
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current)
      heartbeatTimer.current = null
    }

    if (currentPage !== 'watch') {
      // Not watching — clear attribution on the server (so the admin's live
      // count drops this visitor from whatever they were watching before).
      // Only send if we previously had a watch target.
      if (currentChannelId || currentMatchId) {
        trackHeartbeat()
      }
      return
    }

    const channelId = currentChannelId || undefined
    const matchId = currentMatchId || undefined

    // Send an immediate heartbeat on entering the watch page, then every
    // 15s. The 60-second active window on the server side is forgiving
    // enough that several missed heartbeats won't drop the viewer from
    // the live count, while still making counts update near real-time.
    trackHeartbeat(channelId, matchId)
    heartbeatTimer.current = setInterval(() => {
      trackHeartbeat(channelId, matchId)
    }, 15_000)

    return () => {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current)
        heartbeatTimer.current = null
      }
    }
  }, [currentPage, currentChannelId, currentMatchId])

  // When the tab is being closed / hidden, send a final heartbeat to clear
  // attribution promptly (otherwise the visitor lingers in the live count
  // for up to 60 seconds).
  useEffect(() => {
    const onUnload = () => {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(
          '/api/analytics/heartbeat',
          JSON.stringify({})
        )
      }
    }
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('pagehide', onUnload)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
}
