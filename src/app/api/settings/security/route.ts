export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────────────────────
// /api/settings/security
//
// Lightweight endpoint for the client-side SecurityProvider master switch.
//
// GET  (public)  → { securityEnabled: boolean }
//   The SecurityProvider calls this on mount to decide whether to install the
//   right-click / DevTools / anti-debugging protections. Public read is safe
//   because the value is also exposed via /api/settings anyway — but this
//   route returns ONLY the one boolean, so it's tiny and cache-friendly.
//
// PATCH (admin)  → { securityEnabled: boolean }
//   Body: { securityEnabled: boolean }
//   Admins toggle this from the admin panel when they need to use browser
//   dev tools. The change persists in the AppSetting row.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    let settings = await db.appSetting.findUnique({
      where: { id: 'app' },
      select: { securityEnabled: true },
    })
    if (!settings) {
      // No row yet — default to secure (true).
      return NextResponse.json({ securityEnabled: true })
    }
    return NextResponse.json({ securityEnabled: settings.securityEnabled })
  } catch (error) {
    console.error('[Settings/Security] GET error:', error)
    // Fail-safe: when in doubt, keep security ON.
    return NextResponse.json({ securityEnabled: true })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Admin-only.
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      return NextResponse.json(
        { error: 'Unauthorized — admin login required' },
        { status: 401 },
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const b = body as { securityEnabled?: unknown }
    if (typeof b.securityEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'securityEnabled (boolean) is required' },
        { status: 400 },
      )
    }

    const updated = await db.appSetting.upsert({
      where: { id: 'app' },
      update: { securityEnabled: b.securityEnabled },
      create: { id: 'app', securityEnabled: b.securityEnabled },
      select: { securityEnabled: true },
    })

    return NextResponse.json({ securityEnabled: updated.securityEnabled })
  } catch (error) {
    console.error('[Settings/Security] PATCH error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update security setting', detail: message },
      { status: 500 },
    )
  }
}
