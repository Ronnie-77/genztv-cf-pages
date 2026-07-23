// ═══════════════════════════════════════════════════════════
// Server-side Admin Authentication
// Uses simple signed tokens — no crypto module dependency
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'zeng-admin-session'
const SESSION_MAX_AGE = 24 * 60 * 60 // 24 hours in seconds

/** Get the admin password from environment */
function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'Ronnie7700'
}

/** Get signing secret — derived from admin password */
function getSigningSecret(): string {
  return `zeng-secret-${getAdminPassword()}`
}

/** Simple hash function — avoids importing crypto module which uses significant memory */
function simpleHash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return combined.toString(36).padStart(12, '0')
}

/** Create a signed session token (timestamp + signature) */
function createSignedToken(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(36)
  const signature = simpleHash(`${timestamp}:${getSigningSecret()}`)
  return `${timestamp}.${signature}`
}

/** Verify a signed session token */
function verifySignedToken(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return false

    const [timestampB36, signature] = parts
    const timestamp = parseInt(timestampB36, 36)

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000)
    if (now - timestamp > SESSION_MAX_AGE) return false

    // Verify signature
    const expectedSignature = simpleHash(`${timestampB36}:${getSigningSecret()}`)

    // Constant-time comparison
    if (signature.length !== expectedSignature.length) return false
    let diff = 0
    for (let i = 0; i < signature.length; i++) {
      diff |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i)
    }
    return diff === 0
  } catch {
    return false
  }
}

/** Validate password and create session — returns token or null */
export function authenticateAdmin(password: string): string | null {
  if (password !== getAdminPassword()) return null
  return createSignedToken()
}

/** Get session token from request cookies */
export function getSessionToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_NAME)?.value || null
}

/** Set session cookie on response */
export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return response
}

/** Clear session cookie on response */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

/** Check if request is from authenticated admin — returns true/false */
export async function isAdminAuthenticated(req: NextRequest): Promise<boolean> {
  const token = getSessionToken(req)
  if (!token) return false
  return verifySignedToken(token)
}

/** Middleware helper: require admin auth for API routes */
export async function requireAdminAuth(
  req: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const authenticated = await isAdminAuthenticated(req)
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handler()
}
