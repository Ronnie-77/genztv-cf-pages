'use client'

import { X } from 'lucide-react'
import type { ChatReplyPreview } from '@/lib/use-chat'

// ─────────────────────────────────────────────────────────────────────────────
// ReplyPreview — a bar shown ABOVE the chat input when composing a reply.
// Shows the quoted message preview + an X to cancel.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplyPreviewProps {
  replyTo: ChatReplyPreview
  onCancel: () => void
}

export function ReplyPreview({ replyTo, onCancel }: ReplyPreviewProps) {
  return (
    <div className="bg-secondary/60 border-l-2 border-primary px-3 py-2 rounded-r-lg flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-primary">
          Replying to {replyTo.username}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {replyTo.content}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
        aria-label="Cancel reply"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
