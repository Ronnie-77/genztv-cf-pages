import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { AppSettingRow } from '@/lib/types'
import { toBool, toNum } from '@/lib/types'

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
    const db = await getDb()
    const row = await db.first<Pick<AppSettingRow, 'securityEnabled'>>(
      'SELECT securityEnabled FROM AppSetting WHERE id = ?',
      'app'
    )
    if (!row) {
      // No row yet — default to secure (true).
      return NextResponse.json({ securityEnabled: true })
    }
    return NextResponse.json({ securityEnabled: toBool(row.securityEnabled) })
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
        { status: 401 }
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
        { status: 400 }
      )
    }

    const db = await getDb()
    const securityEnabled = toNum(b.securityEnabled)

    // Upsert: if no row exists, insert one with the new securityEnabled value;
    // otherwise just update that one column.
    const existing = await db.first<{ id: string }>(
      "SELECT id FROM AppSetting WHERE id = ?",
      'app'
    )
    if (!existing) {
      await db.run(
        `INSERT INTO AppSetting (id, appName, securityEnabled) VALUES (?, ?, ?)`,
        'app',
        'GenZ TV',
        securityEnabled
      )
    } else {
      await db.run(
        'UPDATE AppSetting SET securityEnabled = ? WHERE id = ?',
        securityEnabled,
        'app'
      )
    }

    // Invalidate the settings cache so other endpoints pick up the change.
    apiCache.invalidateSettings()

    return NextResponse.json({ securityEnabled: b.securityEnabled })
  } catch (error) {
    console.error('[Settings/Security] PATCH error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update security setting', detail: message },
      { status: 500 }
    )
  }
}
