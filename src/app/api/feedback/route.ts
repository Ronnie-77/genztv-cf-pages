export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// /api/feedback
//
// POST (public)  — any visitor can submit feedback (bug, feature, compliment)
// GET  (admin)   — list all feedback, newest first
// ─────────────────────────────────────────────────────────────────────────────

// Simple browser + device parser from User-Agent (no external dep)
function parseUserAgent(ua: string): { device: string; browser: string } {
  const lower = ua.toLowerCase()
  let device = 'desktop'
  if (/mobile|android|iphone|ipod/i.test(ua)) device = 'mobile'
  else if (/ipad|tablet/i.test(ua)) device = 'tablet'
  else if (/tv|smarttv|smart-tv/i.test(ua)) device = 'tv'

  let browser = 'Other'
  if (lower.includes('edg/')) browser = 'Edge'
  else if (lower.includes('chrome/') && !lower.includes('chromium')) browser = 'Chrome'
  else if (lower.includes('firefox/')) browser = 'Firefox'
  else if (lower.includes('safari/') && !lower.includes('chrome')) browser = 'Safari'
  else if (lower.includes('samsungbrowser')) browser = 'Samsung'
  else if (lower.includes('opera/') || lower.includes('opr/')) browser = 'Opera'

  return { device, browser }
}

// Rate limiting (in-memory) — prevent spam. 1 submission per 30s per IP.
const rateLimitMap = new Map<string, number>()
const RATE_LIMIT_MS = 30_000

export async function POST(req: NextRequest) {
  try {
    // Rate limit check
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const now = Date.now()
    const lastSubmit = rateLimitMap.get(ip)
    if (lastSubmit && now - lastSubmit < RATE_LIMIT_MS) {
      const waitSec = Math.ceil((RATE_LIMIT_MS - (now - lastSubmit)) / 1000)
      return NextResponse.json(
        { error: `Please wait ${waitSec}s before submitting again.` },
        { status: 429 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const b = body as Record<string, unknown>

    const category = typeof b.category === 'string' ? b.category : 'other'
    const email = typeof b.email === 'string' ? b.email.slice(0, 255) : ''
    const subject = typeof b.subject === 'string' ? b.subject.slice(0, 200) : ''
    const message = typeof b.message === 'string' ? b.message.trim() : ''

    if (!message || message.length < 5) {
      return NextResponse.json({ error: 'Message is too short (min 5 characters)' }, { status: 400 })
    }
    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message is too long (max 5000 characters)' }, { status: 400 })
    }

    // Validate category
    const validCategories = ['bug', 'feature', 'compliment', 'other']
    const finalCategory = validCategories.includes(category) ? category : 'other'

    // Parse user agent for context
    const ua = req.headers.get('user-agent') || ''
    const { device, browser } = parseUserAgent(ua)

    const feedback = await db.feedback.create({
      data: {
        category: finalCategory,
        email,
        subject,
        message,
        page: typeof b.page === 'string' ? b.page.slice(0, 500) : '',
        userAgent: ua.slice(0, 500),
        device,
        browser,
        status: 'new',
      },
    })

    // Update rate limit
    rateLimitMap.set(ip, now)

    return NextResponse.json({ success: true, id: feedback.id })
  } catch (error) {
    console.error('[Feedback] POST error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to submit feedback', detail: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    // Admin only
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const feedbacks = await db.feedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200, // limit to most recent 200
    })

    return NextResponse.json(feedbacks)
  } catch (error) {
    console.error('[Feedback] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 })
  }
}
