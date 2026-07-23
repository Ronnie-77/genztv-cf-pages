'use client'

import { X, ArrowLeft, Pencil } from 'lucide-react'
import type { ChatUser } from '@/lib/use-chat'
import { GenderAvatar } from './chat-avatars'

// ─────────────────────────────────────────────────────────────────────────────
// ChatHeader — Messenger-desktop-style header for the chat box.
// Used in both 'setup' mode (name/gender form) and 'chat' mode (message list).
//
// This is a PUBLIC chat, so the title is always "Live Chat" (not the user's
// own name). Shows: avatar (gender icon) + "Live Chat" + online status, then
// an edit-profile button and a close button. Call / video / minimize buttons
// were intentionally removed per the product spec.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatHeaderProps {
  mode: 'setup' | 'chat'
  user: ChatUser | null
  connected: boolean
  onlineCount?: number
  onBack: () => void
  onEdit: () => void
  onClose: () => void
}

export function ChatHeader({
  mode,
  user,
  connected,
  onBack,
  onEdit,
  onClose,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-primary text-primary-foreground shrink-0">
      {mode === 'chat' && user ? (
        <>
          {/* Back / close button (mobile only) */}
          <button
            type="button"
            onClick={onBack}
            className="lg:hidden -ml-1 p-1 rounded-md hover:bg-primary-foreground/10 transition-colors"
            aria-label="Close chat"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {/* Avatar (gender icon) */}
          <div className="w-9 h-9 rounded-full bg-primary-foreground/15 flex items-center justify-center shrink-0">
            <GenderAvatar gender={user.avatar} className="w-6 h-6" />
          </div>

          {/* Title + status (public chat → "Live Chat") */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Live Chat</p>
            <p className="text-[11px] opacity-70 flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? 'bg-green-400' : 'bg-primary-foreground/40'
                }`}
              />
              {connected ? 'Online · Public' : 'Connecting…'}
            </p>
          </div>

          {/* Edit profile */}
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-primary-foreground/10 transition-colors"
            aria-label="Edit profile"
            title="Edit name & gender"
          >
            <Pencil className="h-4 w-4" />
          </button>

          {/* Close (desktop) */}
          <button
            type="button"
            onClick={onClose}
            className="hidden lg:inline-flex p-1.5 rounded-md hover:bg-primary-foreground/10 transition-colors"
            aria-label="Close chat"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </>
      ) : (
        <>
          {/* Setup mode: back if user exists, close otherwise */}
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 p-1 rounded-md hover:bg-primary-foreground/10 transition-colors"
            aria-label={user ? 'Back to chat' : 'Close'}
          >
            {user ? <ArrowLeft className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
          <div className="flex-1">
            <p className="text-sm font-semibold">Set up your profile</p>
            <p className="text-[11px] opacity-70">Choose a name and gender</p>
          </div>
        </>
      )}
    </div>
  )
}
