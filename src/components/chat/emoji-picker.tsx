'use client'

import { motion } from 'framer-motion'

// ─────────────────────────────────────────────────────────────────────────────
// EmojiPicker — popover grid of common emojis for composing messages.
// (NOT reactions — this is for typing emojis into the input.)
// Picks don't close the picker (user can pick multiple); the parent closes
// on outside-click or blur.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmojiPickerProps {
  onPick: (emoji: string) => void
  onClose: () => void
}

// ~48 common emojis organized by category (kept as a single flat array for the
// 8-column grid).
const EMOJIS: string[] = [
  // faces
  '😀', '😂', '🥹', '😊', '😍', '🤩', '😘', '🤗',
  '😎', '🤓', '🧐', '🤔', '🤨', '😐', '😶', '🙄',
  '😏', '😬', '😴', '🤤', '🤒', '🤧', '🥳', '🤠',
  '😇', '🤪', '😜', '😝', '😋', '😌', '🙃', '😭',
  '😢', '😡', '😠', '🤬', '😤', '😰', '😨', '😱',
  '🥶', '🥵', '🤯', '😳', '🫣',
  // gestures
  '👍', '👎', '👏', '🙌', '🙏', '🤝', '💪', '✌️',
  '🤟',
  // hearts
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '💖', '💘', '💝',
  // objects
  '🔥', '⭐', '✨', '💯', '🎉', '🎊', '💥', '💫',
]

export function EmojiPicker({ onPick }: EmojiPickerProps) {
  return (
    <motion.div
      // Stop propagation so the parent's outside-click handler doesn't fire
      // when the user clicks inside the picker.
      onMouseDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="bg-card border border-border shadow-xl rounded-xl w-[280px] max-h-[240px] overflow-y-auto p-2"
      role="listbox"
      aria-label="Emoji picker"
    >
      <div className="grid grid-cols-8 gap-1">
        {EMOJIS.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            onClick={() => onPick(emoji)}
            className="text-xl w-8 h-8 flex items-center justify-center rounded-md hover:bg-secondary cursor-pointer transition-colors"
            aria-label={`Insert ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
