'use client'

import { motion } from 'framer-motion'
import { REACTION_EMOJIS } from '@/lib/use-chat'

// ─────────────────────────────────────────────────────────────────────────────
// ReactionPicker — small popover showing the 6 reaction emojis.
// Opens on message hover (desktop) or long-press (mobile).
// The PARENT handles positioning (absolute above the bubble) + outside-click.
// We only stop propagation on mousedown so clicks inside the picker don't
// trigger the parent's outside-click handler prematurely.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReactionPickerProps {
  onReact: (emoji: string) => void
  onClose: () => void
}

export function ReactionPicker({ onReact, onClose }: ReactionPickerProps) {
  const handlePick = (emoji: string) => {
    onReact(emoji)
    onClose()
  }

  return (
    <motion.div
      // Stop propagation so the parent's outside-click handler doesn't fire
      // when the user clicks inside the picker.
      onMouseDown={(e) => e.stopPropagation()}
      initial={{ opacity: 0, scale: 0.8, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: 6 }}
      transition={{ duration: 0.15 }}
      className="bg-card border border-border shadow-lg rounded-full px-2 py-1.5 flex items-center gap-1"
      role="toolbar"
      aria-label="Pick a reaction"
    >
      {REACTION_EMOJIS.map((emoji) => (
        <motion.button
          key={emoji}
          type="button"
          whileHover={{ scale: 1.3 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => handlePick(emoji)}
          className="text-xl w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </motion.button>
      ))}
    </motion.div>
  )
}
