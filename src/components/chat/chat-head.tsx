'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChatBubbleIcon } from './chat-bubble-icon'
import { GenderAvatar } from './chat-avatars'

// ─────────────────────────────────────────────────────────────────────────────
// ChatHead — a Messenger-style floating, draggable chat-head bubble (mobile only).
//
// Behavior (mirrors Facebook Messenger's chat heads):
//  - Renders as a fixed circular bubble (w-14 h-14) that floats above all UI.
//  - DRAG: press + move to reposition anywhere on screen (clamped to viewport).
//  - TAP (press + release without significant movement): opens the chat sheet.
//  - LONG-PRESS (~500ms hold without movement): dismisses the head entirely
//    (back to the FAB state).
//  - Shows the user's emoji avatar (or the ChatBubbleIcon if no profile yet).
//  - Unread badge (top-right) when there are unread messages from others.
//  - Online status dot (bottom-right, green when connected).
//
// The head's position persists in component state (not localStorage) for the
// session; it defaults to the bottom-right on first appearance.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatHeadProps {
  /** The user's avatar emoji, or empty/null if no profile is set yet. */
  avatar: string | null
  /** Number of unread messages (from others) — shown as a badge. */
  unreadCount: number
  /** Whether the socket is connected (green dot vs grey dot). */
  connected: boolean
  /** Called when the head is TAPPED (not dragged). Opens the chat sheet. */
  onTap: () => void
  /** Called when the head is LONG-PRESSED. Removes the head (back to FAB). */
  onDismiss: () => void
}

const HEAD_SIZE = 56 // w-14 h-14 = 56px
const EDGE_MARGIN = 8
const DRAG_THRESHOLD = 8 // px of movement before we consider it a drag (not a tap)
const LONG_PRESS_MS = 500

interface Pos {
  x: number
  y: number
}

export function ChatHead({
  avatar,
  unreadCount,
  connected,
  onTap,
  onDismiss,
}: ChatHeadProps) {
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const [dragging, setDragging] = useState(false)

  // Drag bookkeeping (refs — no re-renders during move).
  const dragStartRef = useRef<{ x: number; y: number; headX: number; headY: number } | null>(null)
  const movedRef = useRef(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)

  // ── Mount gate (portal is client-only) + initial position ──
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // Initialize position to bottom-right once the head first appears.
  useEffect(() => {
    if (mounted && !pos && typeof window !== 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos({
        x: window.innerWidth - HEAD_SIZE - EDGE_MARGIN - 16,
        y: window.innerHeight - HEAD_SIZE - EDGE_MARGIN - 80,
      })
    }
  }, [mounted, pos])

  // ── Clamp a position to the viewport ──
  const clamp = useCallback((p: Pos): Pos => {
    if (typeof window === 'undefined') return p
    const maxX = window.innerWidth - HEAD_SIZE - EDGE_MARGIN
    const maxY = window.innerHeight - HEAD_SIZE - EDGE_MARGIN
    return {
      x: Math.max(EDGE_MARGIN, Math.min(p.x, maxX)),
      y: Math.max(EDGE_MARGIN + 40, Math.min(p.y, maxY)), // keep below the status bar
    }
  }, [])

  // ── Pointer handlers ──
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to the primary pointer (ignore right-click etc.).
    if (e.button !== 0 && e.pointerType === 'mouse') return
    pointerIdRef.current = e.pointerId
    movedRef.current = false
    longPressFiredRef.current = false
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      headX: pos?.x ?? 0,
      headY: pos?.y ?? 0,
    }
    // Capture the pointer so we keep getting move events even outside the head.
    e.currentTarget.setPointerCapture(e.pointerId)
    // Start the long-press timer (cancelled on move or up).
    longPressTimerRef.current = setTimeout(() => {
      // Only fire long-press if the pointer hasn't moved.
      if (!movedRef.current) {
        longPressFiredRef.current = true
        onDismiss()
      }
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    const start = dragStartRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (!movedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      // Crossed the drag threshold — it's a drag, not a tap.
      movedRef.current = true
      // Cancel the long-press timer.
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      setDragging(true)
    }
    if (movedRef.current) {
      setPos(clamp({ x: start.headX + dx, y: start.headY + dy }))
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    setDragging(false)
    // If it was a tap (no significant movement + no long-press), open the chat.
    if (!movedRef.current && !longPressFiredRef.current) {
      onTap()
    }
  }

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return
    pointerIdRef.current = null
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    setDragging(false)
  }

  if (!mounted || !pos) return null

  return createPortal(
    <motion.div
      // `touch-action: none` prevents the browser from scrolling/zooming while
      // dragging the head on touch devices.
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: HEAD_SIZE,
        height: HEAD_SIZE,
        touchAction: 'none',
        zIndex: 50,
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: dragging ? 1.1 : 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: 'spring', damping: 22, stiffness: 320 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="select-none cursor-pointer"
      role="button"
      aria-label="Open chat"
      tabIndex={-1}
    >
      {/* The bubble itself */}
      <div className="relative w-full h-full">
        {/* White ring around the head (Messenger-style) */}
        <div className="absolute inset-0 rounded-full bg-background" />
        {/* Inner colored circle */}
        <div className="absolute inset-[3px] rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
          {avatar ? (
            <GenderAvatar gender={avatar} className="w-7 h-7" />
          ) : (
            <ChatBubbleIcon className="h-6 w-6" />
          )}
        </div>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none ring-2 ring-background">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Online status dot */}
        <span
          className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-2 ring-background ${
            connected ? 'bg-green-500' : 'bg-muted-foreground/50'
          }`}
          aria-hidden="true"
        />
      </div>
    </motion.div>,
    document.body
  )
}

// Re-export AnimatePresence so the parent can wrap the head in it for exit anim.
export { AnimatePresence as ChatHeadAnimatePresence }
