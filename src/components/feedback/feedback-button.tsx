'use client'

import { useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { FeedbackDialog } from './feedback-dialog'
import { useAppStore } from '@/lib/store'

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackButton — floating action button (FAB) for submitting feedback.
//
// Shows a small "Feedback" pill button fixed to the bottom-right of the screen.
// Clicking it opens the FeedbackDialog modal. The button is hidden on the
// admin page and in fullscreen (to avoid covering video).
//
// A dismiss "X" lets the user hide the button for the current session.
// ─────────────────────────────────────────────────────────────────────────────

const DISMISS_KEY = 'zeng-feedback-dismissed'

export function FeedbackButton() {
  const { currentPage } = useAppStore()
  const [open, setOpen] = useState(false)
  // Use a lazy initializer so we read sessionStorage during the first render
  // (no setState-in-effect needed). SSR-safe — returns false on the server.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return !!sessionStorage.getItem(DISMISS_KEY)
    } catch {
      return false
    }
  })

  // Don't show on admin page
  if (currentPage === 'admin' || dismissed) return null

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
  }

  return (
    <>
      {/* Floating button — bottom right, above bottom nav on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 lg:bottom-6 right-4 z-40 flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-105 transition-all duration-200 btn-press group"
        aria-label="Send feedback"
      >
        <MessageCircle className="h-4 w-4" />
        <span className="text-xs font-semibold hidden sm:inline">Feedback</span>
        {/* Dismiss X — appears on hover (desktop only).
            pointer-events-none by default so the invisible X never catches
            touch/click on mobile (where hover doesn't exist). The X overlaps
            the feedback button's top-right corner, so without this guard,
            tapping the button on mobile would hit the invisible X and dismiss
            the button instead of opening the dialog. */}
        <span
          onClick={handleDismiss}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-secondary border border-border flex items-center justify-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </span>
      </button>

      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
