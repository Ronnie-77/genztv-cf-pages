'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink, Megaphone, Loader2 } from 'lucide-react'
import { type Notice } from '@/lib/api'

const DISMISS_KEY_PREFIX = 'genztv:notice-dismissed:'

interface DismissedRecord {
  // ISO timestamp of when the notice was last dismissed
  at: string
  // The `updatedAt` value of the notice when it was dismissed — if the admin
  // edits the notice, updatedAt changes and we re-show the popup.
  updatedAt: string
}

/**
 * SiteNoticePopup — fetches active popup-type notices from the backend and
 * shows the most recent one as a modal popup on website entry.
 *
 * Dismissal behavior:
 *   - When the user closes the popup, we record { at, updatedAt } in
 *     localStorage under `genztv:notice-dismissed:<noticeId>`.
 *   - On subsequent site entries, we re-show the popup only if:
 *       (a) the notice's `updatedAt` has changed (admin edited it), OR
 *       (b) the dismissal is older than 7 days (re-remind cycle).
 *   - This ensures the admin's notice reaches users, but doesn't nag them
 *     every single page load.
 *
 * The popup is completely hidden when there are no active popup notices —
 * exactly what the user requested ("শুধু অ্যাডমিন প্যানেল থেকে কোনো নোটিস
 * অ্যাড করলেই কেবল নোটিশ দেখাবে").
 */
export function SiteNoticePopup() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)

  // Fetch the most recent active popup notice on mount.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/notices?scope=popup', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const all: Notice[] = data.notices || []
        if (all.length === 0) {
          setLoading(false)
          return
        }
        // Pick the most recently updated active popup notice.
        const candidate = all[0] // backend already sorts by updatedAt desc
        // Check dismissal record.
        const raw = localStorage.getItem(DISMISS_KEY_PREFIX + candidate.id)
        if (raw) {
          try {
            const rec: DismissedRecord = JSON.parse(raw)
            const sameVersion = rec.updatedAt === candidate.updatedAt
            const dismissedDate = new Date(rec.at).getTime()
            const sevenDays = 7 * 24 * 60 * 60 * 1000
            const fresh = Date.now() - dismissedDate < sevenDays
            if (sameVersion && fresh) {
              // User already dismissed this version recently → don't show.
              setLoading(false)
              return
            }
          } catch {
            // Corrupt record → ignore, show the popup.
          }
        }
        setNotice(candidate)
        setLoading(false)
      } catch {
        // Network error → silently skip (don't bother the user).
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleDismiss = () => {
    if (!notice) return
    setClosing(true)
    try {
      const rec: DismissedRecord = {
        at: new Date().toISOString(),
        updatedAt: notice.updatedAt,
      }
      localStorage.setItem(DISMISS_KEY_PREFIX + notice.id, JSON.stringify(rec))
    } catch {
      // localStorage might be unavailable (private mode) — ignore.
    }
    // Brief fade-out animation before unmounting.
    setTimeout(() => {
      setNotice(null)
      setClosing(false)
    }, 180)
  }

  // Don't render anything while loading or if there's no notice to show.
  if (loading || !notice) return null

  const hasUrl = notice.url && notice.url.trim().length > 0
  const isExternalUrl = hasUrl && /^https?:\/\//.test(notice.url)
  const href = hasUrl
    ? isExternalUrl
      ? notice.url
      : notice.url.startsWith('/#/')
        ? notice.url
        : `/#/${notice.url.replace(/^\/+/, '')}`
    : undefined

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${
        closing ? 'opacity-0' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-notice-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close notice"
        onClick={handleDismiss}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-background/80 hover:bg-background flex items-center justify-center transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Banner image (optional) */}
        {notice.imageUrl && (
          <div className="w-full aspect-[2/1] bg-secondary overflow-hidden">
            <img
              src={notice.imageUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                // Hide broken image containers gracefully.
                ;(e.target as HTMLImageElement).parentElement!.style.display = 'none'
              }}
            />
          </div>
        )}

        {/* Header */}
        <div className="px-5 pt-5 pb-2 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Megaphone className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Announcement
          </span>
        </div>

        {/* Title + body */}
        <div className="px-5 pb-4">
          <h3 id="site-notice-title" className="text-base font-bold leading-snug mb-2 break-words">
            {notice.title}
          </h3>
          {notice.body && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
              {notice.body}
            </p>
          )}
        </div>

        {/* Footer / actions */}
        <div className="px-5 pb-5 pt-1 flex items-center gap-2">
          {hasUrl && (
            <a
              href={href}
              target={isExternalUrl ? '_blank' : undefined}
              rel={isExternalUrl ? 'noreferrer' : undefined}
              onClick={handleDismiss}
              className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              View Details
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
              hasUrl
                ? 'px-4 bg-secondary text-foreground hover:bg-muted'
                : 'flex-1 bg-primary text-primary-foreground hover:opacity-90'
            }`}
          >
            {hasUrl ? 'Later' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Re-export for the loading spinner used during admin operations.
export { Loader2 }
