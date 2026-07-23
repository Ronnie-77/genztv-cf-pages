'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNotifications } from '@/lib/use-notifications'
import { useInAppNotifications } from '@/lib/use-in-app-notifications'
import { useAppStore } from '@/lib/store'
import { Bell, BellOff, X, BellRing, ExternalLink, AlertCircle, CheckCheck, Tv, Sparkles, Megaphone, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'

/**
 * Notification prompt banner that slides up from bottom
 * Shows on first visit to encourage enabling notifications
 */
export function NotificationPrompt() {
  const { permission, isSubscribed, subscribe, isLoading, error, isRestricted } = useNotifications()
  // Initialize dismissed from localStorage directly (lazy initializer, no effect needed)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!localStorage.getItem('zeng-notif-dismissed')
  })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // If already dismissed, subscribed, permission not default, or restricted, don't schedule
    if (dismissed || permission !== 'default' || isRestricted) return
    // Show after a short delay
    const timer = setTimeout(() => {
      setVisible(true)
    }, 5000)
    return () => clearTimeout(timer)
  }, [dismissed, permission, isRestricted])

  const handleEnable = async () => {
    const success = await subscribe()
    if (success) {
      setVisible(false)
    }
    // Error feedback is handled by toast in useNotifications
  }

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDismissed(true)
    localStorage.setItem('zeng-notif-dismissed', 'true')
  }, [])

  const handleOpenDirect = () => {
    window.open(window.location.href, '_blank')
    handleDismiss()
  }

  // Don't show if already subscribed, denied, or unsupported
  if (permission === 'granted' || permission === 'denied' || permission === 'unsupported') {
    return null
  }

  return (
    <AnimatePresence>
      {visible && !dismissed && permission === 'default' && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:max-w-sm z-50"
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 relative overflow-hidden">
            {/* Background accent */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary/50" />

            <button
              onClick={handleDismiss}
              className="absolute top-2 right-2 p-1 rounded-full hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <BellRing className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0 pr-4">
                <h4 className="text-sm font-semibold mb-1">Stay Updated!</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Enable notifications to get instant alerts when new matches are added.
                </p>

                {isRestricted ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Open the site directly to enable notifications
                    </p>
                    <Button
                      size="sm"
                      onClick={handleOpenDirect}
                      className="h-8 text-xs gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in New Tab
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleEnable}
                      disabled={isLoading}
                      className="h-8 text-xs gap-1.5"
                    >
                      {isLoading ? (
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <Bell className="h-3.5 w-3.5" />
                      )}
                      Enable Notifications
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDismiss}
                      className="h-8 text-xs"
                    >
                      Maybe Later
                    </Button>
                  </div>
                )}

                {error && !isRestricted && (
                  <p className="text-xs text-destructive mt-2">{error}</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Format relative time like "2m", "1h", "3d", or "Just now". */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  // Older than a week — show the date.
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Icon for each notification type. */
function TypeIcon({ type }: { type: string }) {
  const cls = 'h-3.5 w-3.5'
  if (type === 'channel') return <Tv className={cls} />
  if (type === 'feature') return <Sparkles className={cls} />
  if (type === 'update') return <RefreshCw className={cls} />
  return <Megaphone className={cls} />
}

/**
 * Notification bell button for the top nav / sidebar.
 *
 * Clicking the bell opens a dropdown listing the site's in-app notifications
 * (created by admin). An unread-count badge is shown on the bell when there
 * are notifications newer than the visitor's `lastReadAt` timestamp. A short
 * "ding" sound plays when a new notification arrives.
 *
 * When a genuinely NEW notification arrives (detected by ID between polls),
 * a brief popup toast slides in near the bell for 3 seconds, then auto-
 * dismisses. After that the user must click the bell to see the full list.
 *
 * `dropdownAlign` controls which side the dropdown opens toward:
 *   - "right" (default): dropdown opens leftward — for a bell on the RIGHT
 *     side of the screen (e.g. TopNav).
 *   - "left": dropdown opens rightward — for a bell on the LEFT side of the
 *     screen (e.g. the desktop Sidebar header).
 *
 * Push subscription toggle lives in the dropdown footer (so the bell's main
 * click action is always "open the list", not "toggle push").
 */
export function NotificationBell({
  dropdownAlign = 'right',
}: {
  dropdownAlign?: 'right' | 'left'
} = {}) {
  const { permission, isSubscribed, toggleSubscription, subscribe, isLoading, isRestricted } = useNotifications()
  const { notifications, unreadCount, lastReadAt, markAllRead, refetch, latestNewNotification, dismissLatestNew } = useInAppNotifications()
  const { setCurrentPage, setCurrentChannelId, setCurrentMatchId } = useAppStore()
  const [open, setOpen] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  // mounted: gates `createPortal` so it only runs on the client (avoids SSR
  // hydration mismatch). The popup toast AND the dropdown are rendered via a
  // portal to document.body — this is necessary because the Sidebar uses
  // `transition-transform`, which creates a containing block for `position:
  // fixed` elements (per CSS spec). Without the portal, the popup/dropdown
  // would be positioned relative to the 256px-wide sidebar instead of the
  // viewport, and appear off-screen to the left.
  const [mounted, setMounted] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Ref on the bell button's wrapper div. We need a SEPARATE ref from
  // `dropdownRef` (which points to the portal-rendered dropdown when open)
  // so the outside-click handler can tell "click on the bell" apart from
  // "click outside everything". Without this, clicking the bell while the
  // dropdown is open would: (1) mousedown → outside-click closes dropdown,
  // (2) click → bell toggle reopens it — so the user could never close it
  // by clicking the bell a second time.
  const bellWrapperRef = useRef<HTMLDivElement>(null)
  // Computed fixed position for the dropdown, relative to the bell button.
  // Null until the dropdown is open and we've measured the bell's rect.
  // This fixes the "popup gets cut off on the side" issue on mobile, where
  // the bell is the rightmost icon and a right-aligned 380px dropdown would
  // overflow the viewport's right edge.
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  // Ref on the bell button so we can measure its on-screen position and
  // anchor the 3-second popup toast to it (to the bell's right, flipping to
  // the left if there's no room on the right).
  const bellRef = useRef<HTMLButtonElement>(null)
  // Computed fixed position for the popup toast, relative to the bell.
  // Null when no popup should show (e.g. this bell is hidden on the current
  // viewport size — only one of the two bells is visible at a time).
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null)
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0

  useEffect(() => {
    setMounted(true)
  }, [])

  // ── Compute popup position anchored to the bell button ──
  // When a genuinely-new notification arrives, measure the bell button's
  // bounding rect and place the popup to its RIGHT (left = bellRight + 12).
  // If that would overflow the viewport (bell is near the right edge, e.g.
  // the mobile TopNav bell), flip to the LEFT of the bell. If the bell is
  // hidden (display:none — the other bell is the visible one on this
  // viewport), its rect has zero width → we set popupPos=null so THIS bell
  // doesn't render a popup; the visible bell handles it.
  useEffect(() => {
    if (!latestNewNotification) {
      setPopupPos(null)
      return
    }
    const bell = bellRef.current
    if (!bell) {
      setPopupPos(null)
      return
    }
    const rect = bell.getBoundingClientRect()
    // Hidden bell (display:none) → zero-size rect. Let the visible bell
    // render the popup instead.
    if (rect.width === 0 || rect.height === 0) {
      setPopupPos(null)
      return
    }
    const popupWidth = Math.min(window.innerWidth * 0.92, 360)
    const margin = 12
    let left = rect.right + margin
    // No room on the right → flip to the left of the bell.
    if (left + popupWidth > window.innerWidth - 8) {
      left = rect.left - popupWidth - margin
    }
    // Clamp into the viewport.
    left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8))
    // Vertically align with the bell's top, clamped below the top edge.
    const top = Math.max(8, rect.top)
    setPopupPos({ top, left })
  }, [latestNewNotification])

  // ── Compute dropdown position anchored to the bell button ──
  // When the dropdown opens, measure the bell's on-screen rect and place
  // the 380px dropdown so it stays fully within the viewport. On mobile
  // the bell is the rightmost icon, so the dropdown flips to the LEFT of
  // the bell (dropdownAlign='left') to avoid overflowing the right edge.
  // On desktop (PC topnav), dropdownAlign='right' opens to the right edge
  // of the bell. Both are clamped to stay on-screen.
  useEffect(() => {
    if (!open) {
      setDropdownPos(null)
      return
    }
    const bell = bellRef.current
    if (!bell) {
      setDropdownPos(null)
      return
    }
    const rect = bell.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      // Hidden bell (e.g. this is the desktop bell on mobile viewport) —
      // don't render the dropdown from this bell instance.
      setDropdownPos(null)
      return
    }
    const dropdownWidth = Math.min(window.innerWidth * 0.92, 380)
    const margin = 8
    let left: number
    if (dropdownAlign === 'left') {
      // Open to the LEFT of the bell (bell is rightmost icon).
      left = rect.right - dropdownWidth
    } else {
      // Open to the RIGHT edge of the bell (bell is leftmost icon, e.g. PC).
      left = rect.right - dropdownWidth
    }
    // Clamp into the viewport so the dropdown never gets cut off.
    left = Math.max(margin, Math.min(left, window.innerWidth - dropdownWidth - margin))
    // Vertically: just below the bell, clamped below the top edge.
    const top = Math.max(8, rect.bottom + 8)
    setDropdownPos({ top, left })
  }, [open, dropdownAlign])

  // Recompute dropdown position on viewport resize / scroll while open.
  useEffect(() => {
    if (!open) return
    const handle = () => {
      const bell = bellRef.current
      if (!bell) return
      const rect = bell.getBoundingClientRect()
      if (rect.width === 0) return
      const dropdownWidth = Math.min(window.innerWidth * 0.92, 380)
      const margin = 8
      let left = dropdownAlign === 'left' ? rect.right - dropdownWidth : rect.right - dropdownWidth
      left = Math.max(margin, Math.min(left, window.innerWidth - dropdownWidth - margin))
      const top = Math.max(8, rect.bottom + 8)
      setDropdownPos({ top, left })
    }
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)
    return () => {
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [open, dropdownAlign])

  // ── 3-second popup toast for new notifications ──
  // When `latestNewNotification` is set (a genuinely new notification arrived),
  // show a popup for 3 seconds, then auto-dismiss. The user can also click it
  // (to open the dropdown / navigate) or close it manually.
  //
  // IMPORTANT: the auto-dismiss timer only runs while the tab is VISIBLE.
  // If the notification arrived while the user was in another tab (tab
  // hidden), background-tab setTimeout throttling would delay the 3s timer
  // unpredictably, and the user wouldn't see the popup anyway. By pausing
  // the timer while hidden and restarting it when the tab becomes visible,
  // we guarantee the popup is shown for a full 3 seconds AFTER the user
  // returns to the tab, so they actually see it.
  useEffect(() => {
    if (!latestNewNotification) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const startTimer = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        dismissLatestNew()
      }, 3000)
    }
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible — start the 3s timer so the user sees the
        // popup for a full 3 seconds after returning.
        startTimer()
      } else {
        // Tab became hidden — clear the timer so it doesn't fire while
        // the user can't see the popup.
        clearTimer()
      }
    }

    // If the tab is already visible, start the timer immediately.
    if (document.visibilityState === 'visible') {
      startTimer()
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [latestNewNotification, dismissLatestNew])

  // Close dropdown on outside click / Escape.
  // IMPORTANT: a click on the bell button itself must NOT be treated as an
  // "outside click" — the bell's onClick handler toggles `open`, so if we
  // closed here on bell clicks, the sequence would be: mousedown closes →
  // click reopens → the dropdown never actually closes. By checking
  // `bellWrapperRef` here, we let the bell's own onClick handle the toggle
  // cleanly: 1st click opens, 2nd click closes.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      // Click inside the dropdown → keep open.
      if (dropdownRef.current && dropdownRef.current.contains(target)) return
      // Click on the bell button / its wrapper → let the bell's onClick
      // toggle `open` (don't pre-emptively close here).
      if (bellWrapperRef.current && bellWrapperRef.current.contains(target)) return
      // Genuinely outside → close.
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  // When the dropdown is opened, do nothing to unread count — the user must
  // explicitly click "Mark all read" to clear the badge. This matches the
  // behavior of most notification UIs (Slack, GitHub, etc.) where opening the
  // list doesn't auto-mark everything read.

  const handleBellClick = () => {
    setOpen((prev) => !prev)
  }

  const handleNotificationClick = (n: { url: string; id: string }) => {
    if (!n.url) {
      setOpen(false)
      return
    }
    // The app uses Zustand for navigation. Notification URLs are stored as
    // hash-routes like `#/channel/<id>` or `#/watch`. Parse and dispatch.
    const hash = n.url.startsWith('#') ? n.url : `#${n.url}`
    const match = hash.match(/^#\/channel\/(.+)$/)
    if (match) {
      setCurrentChannelId(match[1])
      setCurrentMatchId(null)
      setCurrentPage('watch')
      return
    }
    if (hash.startsWith('#/watch')) {
      setCurrentPage('watch')
      return
    }
    if (hash.startsWith('#/home') || hash === '#/') {
      setCurrentPage('home')
      return
    }
    // Unknown — try a real navigation as a last resort.
    if (n.url.startsWith('http')) {
      window.open(n.url, '_blank', 'noopener')
    }
  }

  // Clicking the 3-second popup toast: dismiss it, open the dropdown, and
  // navigate to the notification's URL (same as clicking an item in the list).
  const handlePopupClick = (n: InAppNotificationLike) => {
    dismissLatestNew()
    setOpen(true)
    handleNotificationClick(n)
  }

  const handleMarkAllRead = () => {
    markAllRead()
    toast.success('Marked all as read')
  }

  const handlePushToggle = async () => {
    setPushBusy(true)
    try {
      if (isRestricted) {
        toast.info('Open the site directly to enable push notifications')
        return
      }
      if (permission === 'granted' && isSubscribed) {
        await toggleSubscription()
      } else {
        await subscribe()
      }
    } finally {
      setPushBusy(false)
    }
  }

  const pushEnabled = permission === 'granted' && isSubscribed

  return (
    <div className="relative" ref={bellWrapperRef}>
      <Button
        ref={bellRef}
        variant="ghost"
        size="icon"
        className="relative"
        onClick={handleBellClick}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {/* ── 3-second new-notification popup toast ──
          Anchored to the bell button (to its right, flipping left if no
          room). Rendered via a React portal to document.body so `position:
          fixed` works relative to the VIEWPORT, not the Sidebar's
          transform-containing block. Only the VISIBLE bell renders the
          popup — the hidden bell (display:none on this viewport) has a
          zero-size rect and sets popupPos=null. Auto-dismisses after 3s. */}
      {mounted && popupPos && createPortal(
        <AnimatePresence>
          {latestNewNotification && (
            <motion.div
              key={latestNewNotification.id}
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.96 }}
              transition={{ type: 'spring', damping: 24, stiffness: 320 }}
              style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, zIndex: 60 }}
              className="w-[min(92vw,360px)]"
              role="status"
              aria-live="polite"
            >
              <div className="bg-card border border-primary/40 rounded-xl shadow-2xl p-3 pr-9 relative overflow-hidden cursor-pointer hover:border-primary/60 transition-colors">
                {/* Top accent bar */}
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
                {/* Close (X) button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissLatestNew()
                  }}
                  className="absolute top-2 right-2 p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handlePopupClick(latestNewNotification)}
                  className="flex items-start gap-2.5 w-full text-left"
                >
                  <div className="shrink-0 mt-0.5">
                    {latestNewNotification.imageUrl ? (
                      <img
                        src={latestNewNotification.imageUrl}
                        alt=""
                        className="w-8 h-8 rounded-lg object-cover bg-secondary"
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <TypeIcon type={latestNewNotification.type} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {latestNewNotification.title}
                    </p>
                    {latestNewNotification.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {latestNewNotification.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                      <BellRing className="h-3 w-3" />
                      Tap bell to view all
                    </p>
                  </div>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Notifications dropdown (rendered via portal to document.body) ──
          Using a portal + fixed positioning ensures the dropdown is positioned
          relative to the VIEWPORT (not a transformed ancestor like the
          sidebar), and the position is computed to stay fully on-screen even
          when the bell is the rightmost icon on a narrow phone. This fixes the
          "popup gets cut off on the side" bug. */}
      {mounted && open && dropdownPos && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 60 }}
              className="w-[min(92vw,380px)] bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
              role="dialog"
              aria-label="Notifications"
            >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded-md hover:bg-secondary transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => refetch()}
                  className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Refresh"
                  aria-label="Refresh notifications"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="w-12 h-12 mx-auto rounded-full bg-secondary flex items-center justify-center mb-3">
                    <Bell className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">No notifications yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    New channels and updates from the admin will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((n) => {
                    const isUnread = new Date(n.createdAt).getTime() > lastReadTime
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => handleNotificationClick(n)}
                          className="w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors flex gap-3 group"
                        >
                          {/* Icon / image */}
                          <div className="shrink-0">
                            {n.imageUrl ? (
                              <img
                                src={n.imageUrl}
                                alt=""
                                className="w-9 h-9 rounded-lg object-cover bg-secondary"
                                onError={(e) => {
                                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                                }}
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                <TypeIcon type={n.type} />
                              </div>
                            )}
                          </div>
                          {/* Body */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              {isUnread && (
                                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                              )}
                              <p className="text-sm font-medium text-foreground truncate">
                                {n.title}
                              </p>
                            </div>
                            {n.body && (
                              <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                                {n.body}
                              </p>
                            )}
                            <p className="text-[11px] text-muted-foreground/70">
                              {formatRelativeTime(n.createdAt)}
                            </p>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer: push subscription toggle */}
            <div className="border-t border-border px-4 py-2.5 flex items-center justify-between gap-2 bg-secondary/30">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    pushEnabled ? 'bg-green-500' : 'bg-muted-foreground/40'
                  }`}
                />
                <span className="text-xs text-muted-foreground truncate">
                  {pushEnabled
                    ? 'Push notifications on'
                    : permission === 'denied'
                      ? 'Push blocked in browser'
                      : 'Push notifications off'}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs px-2 shrink-0"
                onClick={handlePushToggle}
                disabled={pushBusy || isLoading}
                title={
                  pushEnabled
                    ? 'Disable push notifications'
                    : 'Enable push notifications'
                }
              >
                {pushBusy ? (
                  <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                ) : pushEnabled ? (
                  <>
                    <BellOff className="h-3.5 w-3.5 mr-1" />
                    Turn off
                  </>
                ) : (
                  <>
                    <Bell className="h-3.5 w-3.5 mr-1" />
                    Turn on
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

type InAppNotificationLike = {
  url: string
  id: string
  type: string
  title: string
  body: string
  imageUrl: string
  createdAt: string
}
