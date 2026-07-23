export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chat — public chat REST endpoints (Messenger-style).
//
// GET    /api/chat            → recent messages (≤4h old, oldest-first)
//                                includes `reactions` (parsed) + `replyTo` preview
// POST   /api/chat            → send a message (fallback when socket.io is down)
//                                accepts optional `replyToId`
// PATCH  /api/chat            → toggle an emoji reaction on a message
//                                { messageId, emoji, username }
//
// The socket.io mini-service on port 3004 is the primary real-time path.
// This REST route provides:
//   - Initial history load (used before the socket connects, for instant UI)
//   - A POST fallback so messages aren't lost if socket.io is temporarily down
//   - A PATCH fallback for reactions
//   - Server-side cleanup of messages older than 4h on every read
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours
const HISTORY_LIMIT = 200
const MAX_CONTENT_LENGTH = 1000
const MAX_USERNAME_LENGTH = 20
const MAX_AVATAR_LENGTH = 10
const REACTION_EMOJIS = new Set(['👍', '❤️', '😆', '😮', '😢', '😡'])

/** Delete messages older than 4h. Called on every GET. */
async function reapOldMessages() {
  try {
    const cutoff = new Date(Date.now() - MESSAGE_TTL_MS)
    await db.chatMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })
  } catch (err) {
    console.error('[chat] reap error:', err)
  }
}

/** Safely parse a reactions JSON string into a Record. */
function parseReactions(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {}
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

/** Shape a raw DB row into the API-facing ChatMessage (with parsed reactions + reply preview). */
async function shapeMessage(row: {
  id: string
  username: string
  avatar: string
  content: string
  createdAt: Date | string
  reactions: string | null
  replyToId: string | null
}) {
  let replyTo: { id: string; username: string; content: string } | null = null
  if (row.replyToId) {
    const parent = await db.chatMessage.findUnique({
      where: { id: row.replyToId },
      select: { id: true, username: true, content: true },
    })
    if (parent) {
      replyTo = {
        id: parent.id,
        username: parent.username,
        content: parent.content.slice(0, 200),
      }
    }
  }
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    content: row.content,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    replyToId: row.replyToId || null,
    replyTo,
    reactions: parseReactions(row.reactions),
  }
}

// ── GET: recent history ────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  try {
    await reapOldMessages()

    const cutoff = new Date(Date.now() - MESSAGE_TTL_MS)
    const rows = await db.chatMessage.findMany({
      where: { createdAt: { gt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        username: true,
        avatar: true,
        content: true,
        createdAt: true,
        reactions: true,
        replyToId: true,
      },
    })

    const messages = await Promise.all(rows.map(shapeMessage))
    return NextResponse.json({ messages })
  } catch (error) {
    console.error('[chat] GET error:', error)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}

// ── POST: send a message (fallback) ────────────────────────────────────
// Simple rate-limit: max 20 messages per IP per 60s.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const now = Date.now()
    const entry = rateLimitMap.get(ip)
    if (entry && now < entry.resetAt) {
      if (entry.count >= RATE_LIMIT_MAX) {
        return NextResponse.json(
          { error: 'Too many messages. Please slow down.' },
          { status: 429 }
        )
      }
      entry.count++
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const username = String(body.username || '').trim().slice(0, MAX_USERNAME_LENGTH)
    const avatar = String(body.avatar || '').trim().slice(0, MAX_AVATAR_LENGTH)
    const content = String(body.content || '').trim().slice(0, MAX_CONTENT_LENGTH)
    const replyToId =
      typeof body.replyToId === 'string' && body.replyToId.length > 0
        ? body.replyToId.slice(0, 50)
        : null

    if (!username || !content) {
      return NextResponse.json({ error: 'username and content are required' }, { status: 400 })
    }

    // Validate replyToId exists (if provided).
    if (replyToId) {
      const parent = await db.chatMessage.findUnique({ where: { id: replyToId }, select: { id: true } })
      if (!parent) {
        return NextResponse.json({ error: 'replyTo message not found' }, { status: 400 })
      }
    }

    const created = await db.chatMessage.create({
      data: {
        username,
        avatar: avatar || 'male',
        content,
        replyToId: replyToId || null,
      },
      select: {
        id: true,
        username: true,
        avatar: true,
        content: true,
        createdAt: true,
        reactions: true,
        replyToId: true,
      },
    })

    const message = await shapeMessage(created)
    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error('[chat] POST error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

// ── PATCH: toggle an emoji reaction on a message ───────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const messageId = String(body.messageId || '').slice(0, 50)
    const emoji = String(body.emoji || '').slice(0, 10)
    const username = String(body.username || '').trim().slice(0, MAX_USERNAME_LENGTH)

    if (!messageId || !username || !REACTION_EMOJIS.has(emoji)) {
      return NextResponse.json({ error: 'messageId, emoji, username required (emoji must be one of the 6 allowed)' }, { status: 400 })
    }

    const msg = await db.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, reactions: true },
    })
    if (!msg) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const reactions = parseReactions(msg.reactions)
    const list = reactions[emoji] || []
    if (list.includes(username)) {
      // Toggle off.
      const next = list.filter((u) => u !== username)
      if (next.length > 0) reactions[emoji] = next
      else delete reactions[emoji]
    } else {
      // Toggle on.
      reactions[emoji] = [...list, username]
    }

    await db.chatMessage.update({
      where: { id: messageId },
      data: { reactions: JSON.stringify(reactions) },
    })

    return NextResponse.json({ messageId, reactions })
  } catch (error) {
    console.error('[chat] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update reaction' }, { status: 500 })
  }
}
