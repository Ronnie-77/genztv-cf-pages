'use client'

import { ChatBubbleIcon } from './chat-bubble-icon'

// ─────────────────────────────────────────────────────────────────────────────
// ChatEmptyState — friendly empty state shown when there are no messages yet.
// (No demo messages.)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatEmptyStateProps {
  className?: string
}

export function ChatEmptyState({ className }: ChatEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center h-full text-center px-6 ${
        className ?? ''
      }`}
    >
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
        <ChatBubbleIcon className="h-7 w-7 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground">No messages yet</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[240px] leading-relaxed text-center">
        Be the first to say hi! Messages here are public and disappear after 4 hours.
      </p>
    </div>
  )
}
