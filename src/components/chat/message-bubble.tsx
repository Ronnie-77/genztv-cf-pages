'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Reply as ReplyIcon, Smile } from 'lucide-react'
import type { ChatMessage } from '@/lib/use-chat'
import { ReactionPicker } from './reaction-picker'
import { GenderAvatar } from './chat-avatars'

// ─────────────────────────────────────────────────────────────────────────────
// MessageBubble — a single chat message bubble.
// Features:
//  - Sent (isMe) → right-aligned, bg-primary.
//  - Received → left-aligned with avatar slot, bg-secondary.
//  - Reply quote preview INSIDE the bubble (when message.replyTo is set).
//  - Reactions row BELOW the bubble; clicking a pill toggles the current
//    user's reaction (calls onReact(messageId, emoji)).
//  - Hover (desktop) or long-press (mobile) reveals a reaction-trigger button
//    + a reply button. Clicking the trigger (or completing the long-press)
//    opens the ReactionPicker positioned above the bubble.
// ─────────────────────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  message: ChatMessage
  isMe: boolean
  showAvatar: boolean
  onReact: (messageId: string, emoji: string) => void
  onReply: (message: ChatMessage) => void
  meUsername: string
}

export function MessageBubble({
  message,
  isMe,
  showAvatar,
  onReact,
  onReply,
  meUsername,
}: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Clean up any pending long-press timer on unmount.
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

  // Close the reaction picker on outside-click (document mousedown).
  // Uses a ref + document listener instead of a fixed backdrop to avoid
  // z-index/stacking-context conflicts with the chat box's overflow-hidden.
  useEffect(() => {
    if (!showReactions) return
    const handleMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowReactions(false)
      }
    }
    // Defer attaching so the click that opened the picker doesn't close it.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [showReactions])

  const startLongPress = () => {
    longPressFiredRef.current = false
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      setShowReactions(true)
    }, 500)
  }

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleRowPointerDown = () => {
    startLongPress()
  }
  const handleRowPointerUp = () => {
    cancelLongPress()
  }
  const handleRowPointerLeave = () => {
    cancelLongPress()
  }

  // If the user actually triggered the long-press, swallow the next click so
  // we don't open the picker AND e.g. trigger something else.
  const handleRowClickCapture = (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      e.stopPropagation()
      e.preventDefault()
      longPressFiredRef.current = false
    }
  }

  const reactionEntries = Object.entries(message.reactions || {}).filter(
    ([, users]) => Array.isArray(users) && users.length > 0
  )

  return (
    <div
      className={`group relative flex items-end gap-2 ${
        isMe ? 'flex-row-reverse' : 'flex-row'
      }`}
      onPointerDown={handleRowPointerDown}
      onPointerUp={handleRowPointerUp}
      onPointerLeave={handleRowPointerLeave}
      onPointerCancel={cancelLongPress}
      onClickCapture={handleRowClickCapture}
    >
      {/* Avatar slot (received only) */}
      {!isMe && (
        <div className="w-7 h-7 shrink-0">
          {showAvatar && (
            <div className="w-7 h-7 rounded-full bg-secondary text-foreground flex items-center justify-center">
              <GenderAvatar gender={message.avatar} className="w-5 h-5" />
            </div>
          )}
        </div>
      )}

      {/* Bubble column (relative so the picker + trigger can be positioned) */}
      <div className="relative max-w-[75%]">
        {/* Reaction + reply trigger buttons (hover on desktop, long-press on mobile) */}
        <div
          className={`absolute -top-2 ${
            isMe ? 'right-0' : 'left-0'
          } flex items-center gap-1 z-20 transition-opacity ${
            showReactions
              ? 'opacity-0 pointer-events-none'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setShowReactions((v) => !v)
            }}
            className="w-6 h-6 rounded-full bg-card border border-border shadow flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            aria-label="Add reaction"
            title="Add reaction"
          >
            <Smile className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReply(message)
            }}
            className="w-6 h-6 rounded-full bg-card border border-border shadow flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            aria-label="Reply"
            title="Reply"
          >
            <ReplyIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Reaction picker popover (above the bubble) */}
        <AnimatePresence>
          {showReactions && (
            <div
              ref={pickerRef}
              className={`absolute bottom-full mb-1 z-[60] ${
                isMe ? 'right-0' : 'left-0'
              }`}
            >
              <ReactionPicker
                onReact={(emoji) => onReact(message.id, emoji)}
                onClose={() => setShowReactions(false)}
              />
            </div>
          )}
        </AnimatePresence>

        {/* The bubble itself */}
        <div
          className={`px-3 py-2 rounded-2xl text-sm break-words ${
            isMe
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-secondary text-foreground rounded-bl-md'
          }`}
        >
          {/* Reply quote preview (inside the bubble, before the content) */}
          {message.replyTo && (
            <div
              className={`rounded-md px-2 py-1 mb-1 text-[11px] ${
                isMe ? 'bg-primary-foreground/10' : 'bg-black/5 dark:bg-white/10'
              }`}
            >
              <p className="text-primary font-semibold truncate">
                {message.replyTo.username}
              </p>
              <p className="text-muted-foreground truncate">
                {message.replyTo.content}
              </p>
            </div>
          )}

          {/* Sender name (received only, first message in a group) */}
          {!isMe && showAvatar && (
            <p className="text-[11px] font-semibold text-primary mb-0.5">
              {message.username}
            </p>
          )}

          <p className="whitespace-pre-wrap leading-snug">{message.content}</p>
        </div>

        {/* Reactions row (below the bubble, aligned to the bubble's side) */}
        {reactionEntries.length > 0 && (
          <div
            className={`flex flex-wrap gap-1 mt-1 ${
              isMe ? 'justify-end' : 'justify-start'
            }`}
          >
            {reactionEntries.map(([emoji, users]) => {
              const mine = users.includes(meUsername)
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReact(message.id, emoji)
                  }}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                    mine
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-secondary border-border text-foreground hover:bg-secondary/70'
                  }`}
                  aria-pressed={mine}
                  aria-label={`Reaction ${emoji}: ${users.length}`}
                  title={`${users.join(', ')} reacted with ${emoji}`}
                >
                  <span>{emoji}</span>
                  <span>{users.length}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
