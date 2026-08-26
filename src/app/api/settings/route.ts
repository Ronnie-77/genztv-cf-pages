import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// Default settings returned when the DB query fails (e.g. missing columns on Railway)
const DEFAULT_SETTINGS = {
  id: 'app',
  appName: 'GenZ TV',
  logoUrl: '',
  maintenanceMode: false,
  featuredChannelId: '',
  heroBannerText: '',
  defaultQuality: 'auto',
  bannerAdScript: null,
  socialBarAdScript: null,
  customAdScripts: null,
  adsEnabled: true,
  homeAdsEnabled: true,
  videoAdsEnabled: true,
  apkUrl: '',
  ga4MeasurementId: '',
  firebaseConfig: null,
  securityEnabled: true,
  redirectAdUrl: '',
  redirectAdEnabled: false,
  redirectAdIntervalMinutes: 5,
  monetagEnabled: false,
  monetagZoneId: '',
  monetagDomain: '5gvci.com',
}

/**
 * Ensure the AppSetting table has all required columns.
 * On Railway, `prisma db push` might fail silently, leaving missing columns.
 * This function adds any missing columns using raw ALTER TABLE statements.
 */
async function ensureAppSettingColumns(): Promise<void> {
  const db = await getDb()
  const provider = process.env.DATABASE_URL?.startsWith('mysql') ? 'mysql' : 'sqlite'

  // Define columns that might be missing (monetag + other recently added fields)
  const requiredColumns: Record<string, { type: string; after?: string }> = provider === 'mysql'
    ? {
        monetagEnabled: { type: 'BOOLEAN NOT NULL DEFAULT FALSE', after: 'redirectAdIntervalMinutes' },
        monetagZoneId: { type: 'VARCHAR(200) NOT NULL DEFAULT ""', after: 'monetagEnabled' },
        monetagDomain: { type: 'VARCHAR(200) NOT NULL DEFAULT "5gvci.com"', after: 'monetagZoneId' },
        ga4MeasurementId: { type: 'VARCHAR(50) NOT NULL DEFAULT ""', after: 'apkUrl' },
        firebaseConfig: { type: 'MEDIUMTEXT', after: 'ga4MeasurementId' },
        securityEnabled: { type: 'BOOLEAN NOT NULL DEFAULT TRUE', after: 'firebaseConfig' },
      }
    : {
        monetagEnabled: { type: 'BOOLEAN NOT NULL DEFAULT 0' },
        monetagZoneId: { type: 'TEXT NOT NULL DEFAULT ""' },
        monetagDomain: { type: 'TEXT NOT NULL DEFAULT "5gvci.com"' },
        ga4MeasurementId: { type: 'TEXT NOT NULL DEFAULT ""' },
        firebaseConfig: { type: 'TEXT DEFAULT "{}"' },
        securityEnabled: { type: 'BOOLEAN NOT NULL DEFAULT 1' },
      }

  for (const [colName, colDef] of Object.entries(requiredColumns)) {
    try {
      if (provider === 'mysql') {
        await db.$executeRawUnsafe(
          `ALTER TABLE AppSetting ADD COLUMN \`${colName}\` ${colDef.type}${colDef.after ? ` AFTER \`${colDef.after}\`` : ''}`
        )
        console.log(`[Settings] Added missing column: AppSetting.${colName}`)
      } else {
        await db.$executeRawUnsafe(
          `ALTER TABLE AppSetting ADD COLUMN "${colName}" ${colDef.type}`
        )
        console.log(`[Settings] Added missing column: AppSetting.${colName}`)
      }
    } catch (err: unknown) {
      // Column already exists — that's fine, ignore the error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Duplicate column') || msg.includes('duplicate column') || msg.includes('already exists')) {
        // Column exists, no action needed
      } else {
        console.warn(`[Settings] Could not add column ${colName}:`, msg)
      }
    }
  }
}

// Track whether we've already tried to fix the schema this process lifetime
let schemaFixAttempted = false

// GET /api/settings — public read (needed for maintenance mode check, app name, etc.)
export async function GET() {

      const db = await getDb()
  try {
    // Check cache first
    const cached = apiCache.getSettings()
    if (cached) {
      return NextResponse.json(cached)
    }

    let settings = await db.appSetting.findUnique({ where: { id: 'app' } })
    if (!settings) {
      settings = await db.appSetting.create({ data: { id: 'app' } })
    }

    // Cache the settings
    apiCache.setSettings(settings as unknown as Record<string, unknown>)

    return NextResponse.json(settings)
  } catch (error) {
    console.error('[Settings] Error fetching settings:', error)

    // If the error is about missing columns, try to fix the schema once and retry
    const msg = error instanceof Error ? error.message : String(error)
    const isMissingColumn = msg.includes('Unknown column') || msg.includes('no such column') || msg.includes('does not exist')

    if (isMissingColumn && !schemaFixAttempted) {
      schemaFixAttempted = true
      console.log('[Settings] Detected missing column — attempting schema fix...')

      try {
        await ensureAppSettingColumns()
        // Retry the query after fixing the schema
        let settings = await db.appSetting.findUnique({ where: { id: 'app' } })
        if (!settings) {
          settings = await db.appSetting.create({ data: { id: 'app' } })
        }
        apiCache.setSettings(settings as unknown as Record<string, unknown>)
        console.log('[Settings] Schema fix successful — settings loaded')
        return NextResponse.json(settings)
      } catch (retryErr) {
        console.error('[Settings] Schema fix failed:', retryErr)
      }
    }

    // If we can't fix it, return defaults so the admin panel still works
    const message = error instanceof Error ? error.message : 'Failed to fetch settings'
    console.warn('[Settings] Returning default settings due to error:', message)
    return NextResponse.json(DEFAULT_SETTINGS)
  }
}

// PUT /api/settings — update settings (admin only)
export async function PUT(req: NextRequest) {

      const db = await getDb()
  try {
    // Check admin auth
    const authenticated = await isAdminAuthenticated(req)
    if (!authenticated) {
      console.warn('[Settings] Unauthorized PUT attempt — session may have expired')
      return NextResponse.json({ error: 'Unauthorized — please log in again' }, { status: 401 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch (parseErr) {
      console.error('[Settings] JSON parse error:', parseErr)
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const b = body as Record<string, unknown>

    // Before updating, ensure all columns exist (handles Railway deploys where prisma db push failed)
    if (!schemaFixAttempted) {
      schemaFixAttempted = true
      try {
        await ensureAppSettingColumns()
      } catch {
        // Non-fatal — the upsert might still work if columns exist
      }
    }

    const settings = await db.appSetting.upsert({
      where: { id: 'app' },
      update: {
        ...(b.appName !== undefined && { appName: String(b.appName) }),
        ...(b.logoUrl !== undefined && { logoUrl: String(b.logoUrl) }),
        ...(b.maintenanceMode !== undefined && { maintenanceMode: Boolean(b.maintenanceMode) }),
        ...(b.featuredChannelId !== undefined && { featuredChannelId: String(b.featuredChannelId) }),
        ...(b.heroBannerText !== undefined && { heroBannerText: String(b.heroBannerText) }),
        ...(b.defaultQuality !== undefined && { defaultQuality: String(b.defaultQuality) }),
        ...(b.bannerAdScript !== undefined && { bannerAdScript: b.bannerAdScript ? String(b.bannerAdScript) : null }),
        ...(b.socialBarAdScript !== undefined && { socialBarAdScript: b.socialBarAdScript ? String(b.socialBarAdScript) : null }),
        ...(b.customAdScripts !== undefined && { customAdScripts: typeof b.customAdScripts === 'string' ? (b.customAdScripts || null) : JSON.stringify(b.customAdScripts ?? []) }),
        ...(b.adsEnabled !== undefined && { adsEnabled: Boolean(b.adsEnabled) }),
        ...(b.homeAdsEnabled !== undefined && { homeAdsEnabled: Boolean(b.homeAdsEnabled) }),
        ...(b.videoAdsEnabled !== undefined && { videoAdsEnabled: Boolean(b.videoAdsEnabled) }),
        ...(b.securityEnabled !== undefined && { securityEnabled: Boolean(b.securityEnabled) }),
        ...(b.apkUrl !== undefined && { apkUrl: String(b.apkUrl) }),
        ...(b.redirectAdUrl !== undefined && { redirectAdUrl: String(b.redirectAdUrl) }),
        ...(b.redirectAdEnabled !== undefined && { redirectAdEnabled: Boolean(b.redirectAdEnabled) }),
        ...(b.redirectAdIntervalMinutes !== undefined && { redirectAdIntervalMinutes: Math.max(1, Math.min(1440, parseInt(b.redirectAdIntervalMinutes as string) || 5)) }),
        ...(b.monetagEnabled !== undefined && { monetagEnabled: Boolean(b.monetagEnabled) }),
        ...(b.monetagZoneId !== undefined && { monetagZoneId: String(b.monetagZoneId) }),
        ...(b.monetagDomain !== undefined && { monetagDomain: String(b.monetagDomain) }),
      },
      create: {
        id: 'app',
        appName: b.appName ? String(b.appName) : 'GenZ TV',
        logoUrl: b.logoUrl ? String(b.logoUrl) : '',
        maintenanceMode: b.maintenanceMode !== undefined ? Boolean(b.maintenanceMode) : false,
        featuredChannelId: b.featuredChannelId ? String(b.featuredChannelId) : '',
        heroBannerText: b.heroBannerText ? String(b.heroBannerText) : '',
        defaultQuality: b.defaultQuality ? String(b.defaultQuality) : 'auto',
        bannerAdScript: b.bannerAdScript ? String(b.bannerAdScript) : null,
        socialBarAdScript: b.socialBarAdScript ? String(b.socialBarAdScript) : null,
        customAdScripts: typeof b.customAdScripts === 'string' ? (b.customAdScripts || null) : JSON.stringify(b.customAdScripts ?? []),
        adsEnabled: b.adsEnabled !== undefined ? Boolean(b.adsEnabled) : true,
        homeAdsEnabled: b.homeAdsEnabled !== undefined ? Boolean(b.homeAdsEnabled) : true,
        videoAdsEnabled: b.videoAdsEnabled !== undefined ? Boolean(b.videoAdsEnabled) : true,
        securityEnabled: b.securityEnabled !== undefined ? Boolean(b.securityEnabled) : true,
        apkUrl: b.apkUrl ? String(b.apkUrl) : '',
        redirectAdUrl: b.redirectAdUrl ? String(b.redirectAdUrl) : '',
        redirectAdEnabled: b.redirectAdEnabled !== undefined ? Boolean(b.redirectAdEnabled) : false,
        redirectAdIntervalMinutes: b.redirectAdIntervalMinutes !== undefined ? Math.max(1, Math.min(1440, parseInt(b.redirectAdIntervalMinutes as string) || 5)) : 5,
        monetagEnabled: b.monetagEnabled !== undefined ? Boolean(b.monetagEnabled) : false,
        monetagZoneId: b.monetagZoneId ? String(b.monetagZoneId) : '',
        monetagDomain: b.monetagDomain ? String(b.monetagDomain) : '5gvci.com',
      },
    })

    // Invalidate settings cache
    apiCache.invalidateSettings()

    return NextResponse.json(settings)
  } catch (error) {
    console.error('[Settings] Error updating settings:', error)

    // If it's a missing column error, try to fix and retry once
    const msg = error instanceof Error ? error.message : String(error)
    const isMissingColumn = msg.includes('Unknown column') || msg.includes('no such column') || msg.includes('does not exist')

    if (isMissingColumn) {
      console.log('[Settings] Detected missing column during update — attempting schema fix...')
      try {
        await ensureAppSettingColumns()
        // Don't retry the full upsert to avoid infinite loops — inform the admin to retry
        return NextResponse.json({
          error: 'Schema was just updated — please save again',
          detail: 'Missing database columns were detected and auto-created. Please try saving your settings again.',
          schemaFixed: true,
        }, { status: 503 })
      } catch {
        // Fall through to the regular error response
      }
    }

    // Return a useful error message so the admin can see WHY the save failed
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update settings', detail: message },
      { status: 500 },
    )
  }
}
