'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'

// ─────────────────────────────────────────────────────────────────────────────
// useChat — real-time public chat hook (Messenger-style).
//
// Connects to the socket.io mini-service on port 3004 (via Caddy's
// XTransformPort forwarding) and provides:
//   - messages: ChatMessage[] (initial load from REST + live updates via WS)
//   - connected: boolean (socket connection state)
//   - unreadCount: number (messages from OTHERS since lastReadAt)
//   - typingUsers: TypingUser[] (other users currently typing, deduped + auto-expiring)
//   - send(content, replyToId?): emit a message via socket.io (REST POST fallback)
//   - react(messageId, emoji): toggle an emoji reaction on a message
//   - notifyTyping(): tell the server the local user is typing (debounced)
//   - markRead(): reset unreadCount + update lastReadAt
//   - user / setUser: the visitor's display name + emoji avatar (localStorage)
//
// ── Socket event contract ──
// Client → Server:
//   message  { username, avatar, content, replyToId? } → ack { ok, id?, error? }
//   react    { messageId, emoji, username }            → ack { ok }
//   typing   { username, avatar }                       (broadcast to OTHERS)
//   stopTyping { username }                             (broadcast to OTHERS)
//   history  ()                                         → server emits `history`
// Server → Client:
//   history   ChatMessage[]
//   message   ChatMessage
//   reaction  { messageId, reactions }                  (full reactions object)
//   typing    { username, avatar }
//   stopTyping { username }
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatReplyPreview {
  id: string
  username: string
  content: string
}

/** A single chat message. `reactions` maps emoji → usernames who reacted. */
export interface ChatMessage {
  id: string
  username: string
  avatar: string
  content: string
  createdAt: string
  replyToId?: string | null
  replyTo?: ChatReplyPreview | null
  reactions: Record<string, string[]>
}

export interface ChatUser {
  name: string
  avatar: string
}

export interface TypingUser {
  username: string
  avatar: string
}

const USER_KEY = 'genztv:chat-user'
const LAST_READ_KEY = 'genztv:chat-last-read'

/**
 * Avatar options shown in the setup screen.
 * The visitor picks a gender; the matching person silhouette icon is
 * rendered everywhere an avatar appears (see chat-avatars.tsx).
 */
export const AVATAR_OPTIONS = ['male', 'female'] as const

/** The 6 reaction emojis shown in the reaction picker (Messenger-style). */
export const REACTION_EMOJIS = ['👍', '❤️', '😆', '😮', '😢', '😡'] as const

/** Parse a stored ChatUser (or return null). Legacy emoji avatars are
 * normalized to 'male' so returning users keep their name without breaking. */
function loadUser(): ChatUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (typeof p?.name === 'string' && typeof p?.avatar === 'string') {
      const avatar = p.avatar === 'female' ? 'female' : 'male'
      return { name: p.name, avatar }
    }
  } catch {
    // ignore
  }
  return null
}

/** Parse a stored lastReadAt ISO string (or 0). */
function loadLastReadAt(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(LAST_READ_KEY)
    if (!raw) return 0
    const t = Date.parse(raw)
    return Number.isNaN(t) ? 0 : t
  } catch {
    return 0
  }
}

/** Safely parse a reactions JSON string into a Record. */
function parseReactions(raw: unknown): Record<string, string[]> {
  if (typeof raw !== 'string') return {}
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const out: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          out[k] = v
        }
      }
      return out
    }
  } catch {
    // ignore
  }
  return {}
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [lastReadAt, setLastReadAt] = useState<number>(() => loadLastReadAt())
  const [user, setUserState] = useState<ChatUser | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const userRef = useRef<ChatUser | null>(null)
  // typing timers + bookkeeping (refs so they don't trigger re-renders).
  const typingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(false)
  const typingExpiryRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Keep userRef in sync with the user state so socket event handlers (which
  // close over userRef, not user) can read the latest value.
  useEffect(() => {
    userRef.current = user
  }, [user])

  // ── Hydrate user from localStorage on mount (SSR-safe) ──
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserState(loadUser())
  }, [])

  // ── Unread count: messages from OTHERS with createdAt > lastReadAt ──
  const unreadCount = useMemo(() => {
    const me = user?.name
    return messages.filter((m) => {
      const t = Date.parse(m.createdAt) || 0
      return t > lastReadAt && m.username !== me
    }).length
  }, [messages, lastReadAt, user])

  // ── Connect to socket.io (only once, on mount) ─────────────────────
  useEffect(() => {
    let cancelled = false

    // 1) Load initial history via REST for instant UI.
    fetch('/api/chat')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.messages) return
        setMessages(data.messages as ChatMessage[])
      })
      .catch(() => {
        // network error — socket.io will still try to connect
      })

    // 2) Connect socket.io via the Caddy gateway.
    const socket = io('/?XTransformPort=3004', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    // Full history refresh from the server (sent on connect + on `history`).
    socket.on('history', (msgs: ChatMessage[]) => {
      if (Array.isArray(msgs)) setMessages(msgs)
    })

    // A single new message (broadcast to all clients, including sender).
    socket.on('message', (msg: ChatMessage) => {
      if (!msg || !msg.id) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    })

    // A reaction update (full reactions object for a message).
    socket.on('reaction', (data: { messageId: string; reactions: Record<string, string[]> }) => {
      if (!data?.messageId) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, reactions: data.reactions || {} } : m
        )
      )
    })

    // Another user started typing.
    socket.on('typing', (data: TypingUser) => {
      if (!data?.username) return
      const me = userRef.current?.name
      if (data.username === me) return // don't show my own
      setTypingUsers((prev) => {
        const without = prev.filter((u) => u.username !== data.username)
        const av = data.avatar === 'female' ? 'female' : 'male'
        return [...without, { username: data.username, avatar: av }]
      })
      // Auto-expire: if no refresh in 4s, remove the user.
      const timers = typingExpiryRef.current
      const existing = timers.get(data.username)
      if (existing) clearTimeout(existing)
      timers.set(
        data.username,
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.username !== data.username))
          timers.delete(data.username)
        }, 4000)
      )
    })

    // Another user stopped typing.
    socket.on('stopTyping', (data: { username: string }) => {
      if (!data?.username) return
      setTypingUsers((prev) => prev.filter((u) => u.username !== data.username))
      const timers = typingExpiryRef.current
      const existing = timers.get(data.username)
      if (existing) {
        clearTimeout(existing)
        timers.delete(data.username)
      }
    })

    return () => {
      cancelled = true
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
      // Clear all typing timers.
      typingExpiryRef.current.forEach((t) => clearTimeout(t))
      typingExpiryRef.current.clear()
      if (typingSendTimerRef.current) clearTimeout(typingSendTimerRef.current)
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
    }
  }, [])

  // ── send: emit via socket.io, with REST fallback ───────────────────
  const sendViaRest = useCallback(
    async (payload: {
      username: string
      avatar: string
      content: string
      replyToId?: string | null
    }) => {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data?.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev
            return [...prev, data.message]
          })
        }
      } catch {
        // ignore
      }
    },
    []
  )

  const send = useCallback(
    (content: string, replyToId?: string | null): boolean => {
      const me = userRef.current
      if (!me || !content.trim()) return false
      const payload = {
        username: me.name,
        avatar: me.avatar,
        content: content.trim().slice(0, 1000),
        replyToId: replyToId || null,
      }
      // Stop typing when sending.
      if (isTypingRef.current) {
        isTypingRef.current = false
        if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
        socketRef.current?.emit('stopTyping', { username: me.name })
      }
      const socket = socketRef.current
      if (socket && socket.connected) {
        let acked = false
        socket.emit('message', payload, (res: { ok: boolean; id?: string }) => {
          acked = true
          if (!res?.ok) void sendViaRest(payload)
        })
        setTimeout(() => {
          if (!acked) void sendViaRest(payload)
        }, 2000)
        return true
      }
      void sendViaRest(payload)
      return true
    },
    [sendViaRest]
  )

  // ── react: toggle an emoji reaction on a message ───────────────────
  const react = useCallback((messageId: string, emoji: string) => {
    const me = userRef.current
    if (!me) return
    const socket = socketRef.current
    if (socket && socket.connected) {
      socket.emit('react', { messageId, emoji, username: me.name })
      return
    }
    // REST fallback for reactions.
    void (async () => {
      try {
        await fetch('/api/chat', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messageId, emoji, username: me.name }),
        })
      } catch {
        // ignore
      }
    })()
  }, [])

  // ── notifyTyping: debounced — tells the server the user is typing ──
  // Emits `typing` at most once every 1.2s while the user keeps typing.
  // Emits `stopTyping` 1.8s after the last keystroke.
  const notifyTyping = useCallback(() => {
    const me = userRef.current
    if (!me) return
    const socket = socketRef.current
    if (!socket || !socket.connected) return

    // (Re)send `typing` at most every 1.2s.
    if (!typingSendTimerRef.current) {
      socket.emit('typing', { username: me.name, avatar: me.avatar })
      typingSendTimerRef.current = setTimeout(() => {
        typingSendTimerRef.current = null
      }, 1200)
    }
    // Reset the stop timer — if no keystroke for 1.8s, emit stopTyping.
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
    isTypingRef.current = true
    typingStopTimerRef.current = setTimeout(() => {
      isTypingRef.current = false
      socket.emit('stopTyping', { username: me.name })
    }, 1800)
  }, [])

  // ── setUser: persist to localStorage + update state ─────────────────
  const setUser = useCallback((u: ChatUser) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u))
    } catch {
      // ignore
    }
    setUserState(u)
  }, [])

  // ── markRead: set lastReadAt to now ──
  const markRead = useCallback(() => {
    const now = Date.now()
    try {
      localStorage.setItem(LAST_READ_KEY, new Date(now).toISOString())
    } catch {
      // ignore
    }
    setLastReadAt(now)
  }, [])

  return {
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
  }
}

// Exported for use by API routes + socket service (via shared type).
export { parseReactions }
