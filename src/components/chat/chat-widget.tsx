'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useChat, AVATAR_OPTIONS, type ChatMessage, type ChatReplyPreview } from '@/lib/use-chat'
import { useAppStore } from '@/lib/store'
import { ChatBubbleIcon } from './chat-bubble-icon'
import { ChatHeader } from './chat-header'
import { ChatSetup } from './chat-setup'
import { ChatEmptyState } from './chat-empty-state'
import { MessageBubble } from './message-bubble'
import { ChatInput } from './chat-input'
import { TypingIndicator } from './typing-indicator'

// ─────────────────────────────────────────────────────────────────────────────
// ChatWidget — Messenger-style floating public chat (replaces FeedbackButton).
//
// Both desktop AND mobile now use the SAME toggle behavior:
//  - Click the floating chat button → opens the chat box directly (popup).
//  - Click the button again (or outside the box, or press Esc) → closes it.
//  - No intermediate "chat head" step on mobile anymore — the box opens
//    immediately as a popup (bottom-anchored sheet on mobile, ~92vw × 78vh;
//    classic 340×480 bottom-right popup on desktop).
//
// Shared behavior:
//  - On first open: show name + gender setup screen (stored in localStorage).
//  - Unread badge on the FAB (messages from others since last open).
//  - Messages auto-delete after 4h (reaper in the mini-service + API).
//  - Real-time via socket.io (port 3004); REST fallback for send/history/react.
//  - Emoji reactions (👍❤️😆😮😢😡), replies (with quote preview), typing
//    indicator, emoji picker — all Messenger-style.
//  - Theme auto-syncs (uses shadcn variables → dark/light mode).
//
// The chat box is rendered via a React portal to document.body with
// position:fixed — same pattern as NotificationBell. The toggle uses the
// split-ref pattern (fabWrapperRef + boxRef) so clicking the FAB while the
// box is open is NOT treated as an outside-click (1st click opens, 2nd closes).
// ─────────────────────────────────────────────────────────────────────────────

export function ChatWidget() {
  const { currentPage } = useAppStore()
  const {
    messages,
    connected,
    unreadCount,
    typingUsers,
    send,
    react,
    notifyTyping,
    markRead,
    user,
    setUser,
  } = useChat()

  // Unified open state for both desktop and mobile.
  const [open, setOpen] = useState(false)

  // `mode`: 'setup' (name/gender form) | 'chat' (message list + input)
  const [mode, setMode] = useState<'setup' | 'chat'>('chat')
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [mounted, setMounted] = useState(false)

  // Setup form state.
  const [nameInput, setNameInput] = useState('')
  const [avatarInput, setAvatarInput] = useState<string>(AVATAR_OPTIONS[0])

  // Message input.
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refs for outside-click handling (split-ref pattern, mirrors NotificationBell).
  const fabWrapperRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // ── Mount gate (portal is client-only) ──
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // ── Auto-scroll to bottom on new messages (if user is near bottom) ──
  useEffect(() => {
    if (!open || mode !== 'chat') return
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    if (nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }
  }, [messages, open, mode])

  // ── Outside-click + Esc to close ──
  // The box is a popup on both desktop and mobile; clicking outside (on the
  // backdrop or anywhere else not in the box/FAB) closes it.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (boxRef.current?.contains(target)) return
      if (fabWrapperRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  // ── Unified FAB toggle (desktop + mobile): 1st click opens, 2nd closes ──
  const handleFabClick = () => {
    if (open) {
      setOpen(false)
      return
    }
    if (user) {
      setMode('chat')
      markRead()
    } else {
      setMode('setup')
    }
    setOpen(true)
  }

  // ── Mobile header back/close ──
  const handleMobileBack = () => {
    setOpen(false)
  }

  // ── Setup: switch to setup mode (header "Edit" button) ──
  const enterSetup = () => {
    setNameInput(user?.name || '')
    setAvatarInput(user?.avatar || AVATAR_OPTIONS[0])
    setMode('setup')
  }

  // ── Setup form submit ──
  const handleSetupSubmit = useCallback(() => {
    const name = nameInput.trim().slice(0, 20)
    if (!name) return
    setUser({ name, avatar: avatarInput })
    setMode('chat')
    markRead()
    setTimeout(() => inputRef.current?.focus(), 120)
  }, [nameInput, avatarInput, setUser, markRead])

  // ── Send a message (with optional reply) ──
  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text || !user || sending) return
    setSending(true)
    const replyId = replyingTo?.id ?? null
    const ok = send(text, replyId)
    if (ok) {
      setDraft('')
      setReplyingTo(null)
      markRead()
    }
    setTimeout(() => setSending(false), 300)
  }, [draft, user, sending, send, markRead, replyingTo])

  // ── Reply to a message ──
  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyingTo(msg)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // ── React to a message ──
  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      react(messageId, emoji)
    },
    [react]
  )

  // ── Hide on admin page (after all hooks, to satisfy rules-of-hooks) ──
  if (currentPage === 'admin') return null

  // Convert the replyingTo ChatMessage into the ChatReplyPreview shape.
  const replyPreview: ChatReplyPreview | null = replyingTo
    ? {
        id: replyingTo.id,
        username: replyingTo.username,
        content: replyingTo.content.slice(0, 200),
      }
    : null

  // Shared FAB button markup (used by both desktop and mobile wrappers).
  const fabButton = (
    <motion.button
      onClick={handleFabClick}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.05 }}
      className="relative w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 flex items-center justify-center btn-press"
      aria-label={open ? 'Close chat' : 'Open chat'}
      aria-expanded={open}
    >
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.span
            key="x"
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <X className="h-6 w-6" />
          </motion.span>
        ) : (
          <motion.span
            key="chat"
            initial={{ rotate: 90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: -90, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ChatBubbleIcon className="h-6 w-6" />
          </motion.span>
        )}
      </AnimatePresence>

      {/* Unread badge (only when closed) */}
      {unreadCount > 0 && !open && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none ring-2 ring-background">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {/* Online dot (only when closed) */}
      {!open && (
        <span
          className={`absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full ring-2 ring-background ${
            connected ? 'bg-green-500' : 'bg-muted-foreground/50'
          }`}
          aria-hidden="true"
        />
      )}
    </motion.button>
  )

  return (
    <>
      {/* ── Desktop FAB (≥lg): toggle the chat popup ── */}
      <div ref={fabWrapperRef} className="fixed bottom-6 right-4 z-40 hidden lg:block">
        {fabButton}
      </div>

      {/* ── Mobile FAB (<lg): toggle the chat popup directly ──
          Positioned above the bottom nav. */}
      <div className="fixed bottom-20 right-4 z-40 lg:hidden">
        {fabButton}
      </div>

      {/* ── Chat box (portal to document.body, position:fixed) ──
          One component, responsive:
            Mobile (<lg): bottom-anchored popup (~92vw × min(78vh,560px)) with a
              light backdrop for outside-click. NOT full-screen.
            Desktop (≥lg): 340×480 popup, bottom-right above the FAB. */}
      {mounted && open && createPortal(
        <AnimatePresence>
          {open && (
            <>
              {/* Backdrop (mobile only — signals "popup" + gives a clear
                  outside-click target). Desktop has no backdrop (popup floats). */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-40 bg-black/30 lg:hidden"
                aria-hidden="true"
              />

              {/* The chat box */}
              <motion.div
                ref={boxRef}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.96 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="fixed z-50 flex flex-col overflow-hidden bg-card border border-border shadow-2xl rounded-2xl left-3 right-3 bottom-3 h-[min(78vh,560px)] lg:left-auto lg:right-4 lg:bottom-24 lg:w-[340px] lg:h-[min(80vh,480px)]"
                role="dialog"
                aria-label="Live Chat"
              >
                {/* ── Header ── */}
                <ChatHeader
                  mode={mode}
                  user={user}
                  connected={connected}
                  onBack={handleMobileBack}
                  onEdit={enterSetup}
                  onClose={() => setOpen(false)}
                />

                {/* ── Body: setup or chat ── */}
                {mode === 'setup' ? (
                  <ChatSetup
                    nameInput={nameInput}
                    setNameInput={setNameInput}
                    avatarInput={avatarInput}
                    setAvatarInput={setAvatarInput}
                    onSubmit={handleSetupSubmit}
                    hasUser={!!user}
                  />
                ) : (
                  <>
                    {/* Messages list */}
                    <div
                      ref={listRef}
                      className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-background scroll-smooth"
                    >
                      {messages.length === 0 ? (
                        <ChatEmptyState />
                      ) : (
                        messages.map((m, i) => {
                          const isMe = m.username === user?.name
                          const prev = messages[i - 1]
                          const showAvatar =
                            !isMe && (!prev || prev.username !== m.username)
                          return (
                            <MessageBubble
                              key={m.id}
                              message={m}
                              isMe={isMe}
                              showAvatar={showAvatar}
                              onReact={handleReact}
                              onReply={handleReply}
                              meUsername={user?.name ?? ''}
                            />
                          )
                        })
                      )}

                      {/* Typing indicator (at the bottom of the list) */}
                      <TypingIndicator users={typingUsers} />
                    </div>

                    {/* Input area */}
                    <ChatInput
                      draft={draft}
                      setDraft={setDraft}
                      onSend={handleSend}
                      onTyping={notifyTyping}
                      disabled={!user || sending}
                      replyTo={replyPreview}
                      onCancelReply={() => setReplyingTo(null)}
                      inputRef={inputRef}
                    />
                  </>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
