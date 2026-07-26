export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, setSessionCookie } from '@/lib/auth'

// ─── In-memory rate limiting for login attempts ───
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil: number }>()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LOCKOUT_MS = 30 * 60 * 1000 // 30 minutes lockout after max attempts

// Clean up old entries periodically
let lastCleanup = Date.now()
function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < 60_000) return // Only cleanup once per minute
  lastCleanup = now
  for (const [key, value] of loginAttempts.entries()) {
    if (now - value.lastAttempt > LOCKOUT_MS * 2) {
      loginAttempts.delete(key)
    }
  }
}

// POST /api/auth/login
export async function POST(req: NextRequest) {
  try {
    // Get client identifier (IP + user agent hash for uniqueness)
    const ip = req.headers.get('x-forwarded-for') ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const clientKey = `login:${ip}`

    cleanup()

    // Check rate limiting
    const attemptInfo = loginAttempts.get(clientKey)
    const now = Date.now()

    if (attemptInfo) {
      // Check if locked out
      if (attemptInfo.lockedUntil > now) {
        const remainingMinutes = Math.ceil((attemptInfo.lockedUntil - now) / 60000)
        return NextResponse.json(
          { error: `Account temporarily locked. Try again in ${remainingMinutes} minutes.` },
          { status: 429 }
        )
      }

      // Reset window if expired
      if (now - attemptInfo.lastAttempt > WINDOW_MS) {
        loginAttempts.set(clientKey, { count: 0, lastAttempt: now, lockedUntil: 0 })
      }
    }

    const body = await req.json()
    const { password } = body

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    // Rate limit check before authentication
    const currentAttempt = loginAttempts.get(clientKey) || { count: 0, lastAttempt: now, lockedUntil: 0 }
    if (currentAttempt.count >= MAX_ATTEMPTS) {
      currentAttempt.lockedUntil = now + LOCKOUT_MS
      loginAttempts.set(clientKey, currentAttempt)
      return NextResponse.json(
        { error: 'Too many failed attempts. Account locked for 30 minutes.' },
        { status: 429 }
      )
    }

    const token = authenticateAdmin(password)
    if (!token) {
      // Increment failed attempt count
      currentAttempt.count++
      currentAttempt.lastAttempt = now
      loginAttempts.set(clientKey, currentAttempt)

      const remaining = MAX_ATTEMPTS - currentAttempt.count
      if (remaining <= 2) {
        return NextResponse.json(
          { error: `Invalid password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.` },
          { status: 401 }
        )
      }

      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Successful login — clear rate limit
    loginAttempts.delete(clientKey)

    const response = NextResponse.json({ success: true, message: 'Logged in successfully' })
    return setSessionCookie(response, token)
  } catch (error) {
    // Don't leak error details
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
