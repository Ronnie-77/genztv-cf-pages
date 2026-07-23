'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Smile } from 'lucide-react'
import type { ChatReplyPreview } from '@/lib/use-chat'
import { EmojiPicker } from './emoji-picker'
import { ReplyPreview } from './reply-preview'

// ─────────────────────────────────────────────────────────────────────────────
// ChatInput — the message input area.
// Emoji picker toggle button + text input + send button.
// If `replyTo` is set, a ReplyPreview bar is shown above the input.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatInputProps {
  draft: string
  setDraft: (v: string) => void
  onSend: () => void
  onTyping: () => void
  disabled: boolean
  replyTo: ChatReplyPreview | null
  onCancelReply: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export function ChatInput({
  draft,
  setDraft,
  onSend,
  onTyping,
  disabled,
  replyTo,
  onCancelReply,
  inputRef,
}: ChatInputProps) {
  const [showEmoji, setShowEmoji] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)

  // Close the emoji picker on outside-click (document mousedown).
  // Uses a ref + document listener instead of a fixed backdrop to avoid
  // z-index/stacking-context conflicts with the chat box's overflow-hidden.
  useEffect(() => {
    if (!showEmoji) return
    const handleMouseDown = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [showEmoji])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value)
    onTyping()
  }

  const handlePickEmoji = (emoji: string) => {
    setDraft((draft + emoji).slice(0, 1000))
    onTyping()
  }

  const canSend = draft.trim().length > 0 && !disabled

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 py-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyPreview replyTo={replyTo} onCancel={onCancelReply} />
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Emoji toggle */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowEmoji((v) => !v)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label="Toggle emoji picker"
            aria-expanded={showEmoji}
          >
            <Smile className="h-5 w-5" />
          </button>

          <AnimatePresence>
            {showEmoji && (
              <div
                ref={emojiPickerRef}
                className="absolute bottom-full mb-2 left-0 z-[60]"
              >
                <EmojiPicker
                  onPick={handlePickEmoji}
                  onClose={() => setShowEmoji(false)}
                />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          maxLength={1000}
          className="flex-1 h-10 px-3 rounded-full bg-secondary text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
          aria-label="Message"
        />

        {/* Send button */}
        <motion.button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          whileTap={canSend ? { scale: 0.9 } : undefined}
          className="w-10 h-10 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-transform btn-press"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  )
}
