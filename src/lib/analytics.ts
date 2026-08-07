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

/** No-op — heartbeat endpoint was removed. */
export function trackHeartbeat(_channelId?: string, _matchId?: string) {
  // no-op
}

export function useAnalytics() {
  const { currentPage, currentChannelId, currentMatchId } = useAppStore()
  const initialized = useRef(false)

  // Track page view on navigation change. When on the watch page we pass
  // both channelId and matchId (whichever is set) so the server can
  // attribute the view to the right entity.
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
}
