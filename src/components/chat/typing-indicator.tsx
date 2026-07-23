'use client'

import { motion } from 'framer-motion'
import type { TypingUser } from '@/lib/use-chat'

// ─────────────────────────────────────────────────────────────────────────────
// TypingIndicator — "X is typing…" with animated bouncing dots.
// Placed at the bottom of the message list, left-aligned (Messenger-style).
// ─────────────────────────────────────────────────────────────────────────────

export interface TypingIndicatorProps {
  users: TypingUser[]
}

function describeTyping(users: TypingUser[]): string {
  const names = users.map((u) => u.username)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]}, ${names[1]} and others are typing…`
}

export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null

  return (
    <div className="flex items-end gap-2">
      {/* Small secondary bubble with three staggered bouncing dots */}
      <div className="bg-secondary rounded-2xl rounded-bl-md px-3 py-2.5 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-muted-foreground"
            initial={{ opacity: 0.35, scale: 0.8 }}
            animate={{ opacity: [0.35, 1, 0.35], scale: [0.8, 1.15, 0.8] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.18,
            }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground pb-0.5">
        {describeTyping(users)}
      </span>
    </div>
  )
}
