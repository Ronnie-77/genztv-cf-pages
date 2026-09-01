import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { apiCache } from '@/lib/cache'
import type { AppSettingRow } from '@/lib/types'
import { toBool, toNum } from '@/lib/types'

// ═══════════════════════════════════════════════════════════════════
// /api/settings
//
// The AppSetting table is a singleton row with id='app'. The schema is
// already correct in d1-schema.sql (no runtime ALTER TABLE needed).
// ═══════════════════════════════════════════════════════════════════

// Convert raw DB row (booleans stored as 0/1) to the JSON shape the
// frontend expects (real booleans, nullable strings as-is).
function rowToSettings(row: AppSettingRow) {
  return {
    id: row.id,
    appName: row.appName,
    logoUrl: row.logoUrl,
    maintenanceMode: toBool(row.maintenanceMode),
    featuredChannelId: row.featuredChannelId,
    heroBannerText: row.heroBannerText,
    defaultQuality: row.defaultQuality,
    bannerAdScript: row.bannerAdScript || null,
    socialBarAdScript: row.socialBarAdScript || null,
    customAdScripts: row.customAdScripts || null,
    adsEnabled: toBool(row.adsEnabled),
    homeAdsEnabled: toBool(row.homeAdsEnabled),
    videoAdsEnabled: toBool(row.videoAdsEnabled),
    apkUrl: row.apkUrl,
    ga4MeasurementId: row.ga4MeasurementId,
    firebaseConfig: row.firebaseConfig || null,
    securityEnabled: toBool(row.securityEnabled),
    redirectAdUrl: row.redirectAdUrl,
    redirectAdEnabled: toBool(row.redirectAdEnabled),
    redirectAdIntervalMinutes: row.redirectAdIntervalMinutes,
    monetagEnabled: toBool(row.monetagEnabled),
    monetagZoneId: row.monetagZoneId,
    monetagDomain: row.monetagDomain,
  }
}

// Default values used when creating the singleton row on first GET.
const DEFAULT_ROW: AppSettingRow = {
  id: 'app',
  appName: 'GenZ TV',
  logoUrl: '',
  maintenanceMode: 0,
  featuredChannelId: '',
  heroBannerText: '',
  defaultQuality: 'auto',
  bannerAdScript: '',
  socialBarAdScript: '',
  customAdScripts: '[]',
  adsEnabled: 1,
  homeAdsEnabled: 1,
  videoAdsEnabled: 1,
  apkUrl: '',
  ga4MeasurementId: '',
  firebaseConfig: '{}',
  securityEnabled: 1,
  redirectAdUrl: '',
  redirectAdEnabled: 0,
  redirectAdIntervalMinutes: 5,
  monetagEnabled: 0,
  monetagZoneId: '',
  monetagDomain: '5gvci.com',
}

// GET /api/settings — public read (needed for maintenance mode check, app name, etc.)
export async function GET() {
  try {
    // Check cache first
    const cached = apiCache.getSettings()
    if (cached) {
      return NextResponse.json(cached)
    }

    const db = await getDb()
    let row = await db.first<AppSettingRow>("SELECT * FROM AppSetting WHERE id = ?", 'app')
    if (!row) {
      // Create the singleton row with defaults on first access.
      await db.run(
        `INSERT INTO AppSetting
         (id, appName, logoUrl, maintenanceMode, featuredChannelId, heroBannerText, defaultQuality,
          bannerAdScript, socialBarAdScript, customAdScripts, adsEnabled, homeAdsEnabled, videoAdsEnabled,
          apkUrl, ga4MeasurementId, firebaseConfig, securityEnabled,
          redirectAdUrl, redirectAdEnabled, redirectAdIntervalMinutes,
          monetagEnabled, monetagZoneId, monetagDomain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        DEFAULT_ROW.id,
        DEFAULT_ROW.appName,
        DEFAULT_ROW.logoUrl,
        DEFAULT_ROW.maintenanceMode,
        DEFAULT_ROW.featuredChannelId,
        DEFAULT_ROW.heroBannerText,
        DEFAULT_ROW.defaultQuality,
        DEFAULT_ROW.bannerAdScript,
        DEFAULT_ROW.socialBarAdScript,
        DEFAULT_ROW.customAdScripts,
        DEFAULT_ROW.adsEnabled,
        DEFAULT_ROW.homeAdsEnabled,
        DEFAULT_ROW.videoAdsEnabled,
        DEFAULT_ROW.apkUrl,
        DEFAULT_ROW.ga4MeasurementId,
        DEFAULT_ROW.firebaseConfig,
        DEFAULT_ROW.securityEnabled,
        DEFAULT_ROW.redirectAdUrl,
        DEFAULT_ROW.redirectAdEnabled,
        DEFAULT_ROW.redirectAdIntervalMinutes,
        DEFAULT_ROW.monetagEnabled,
        DEFAULT_ROW.monetagZoneId,
        DEFAULT_ROW.monetagDomain
      )
      row = DEFAULT_ROW
    }

    const settings = rowToSettings(row)
    apiCache.setSettings(settings as unknown as Record<string, unknown>)
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[Settings] Error fetching settings:', error)
    // Fail-safe: return defaults so the admin panel still works.
    return NextResponse.json(rowToSettings(DEFAULT_ROW))
  }
}

// PUT /api/settings — update settings (admin only)
export async function PUT(req: NextRequest) {
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

    const db = await getDb()

    // Ensure the singleton row exists before updating.
    const existing = await db.first<AppSettingRow>("SELECT id FROM AppSetting WHERE id = ?", 'app')
    if (!existing) {
      await db.run(
        `INSERT INTO AppSetting
         (id, appName, logoUrl, maintenanceMode, featuredChannelId, heroBannerText, defaultQuality,
          bannerAdScript, socialBarAdScript, customAdScripts, adsEnabled, homeAdsEnabled, videoAdsEnabled,
          apkUrl, ga4MeasurementId, firebaseConfig, securityEnabled,
          redirectAdUrl, redirectAdEnabled, redirectAdIntervalMinutes,
          monetagEnabled, monetagZoneId, monetagDomain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        DEFAULT_ROW.id,
        DEFAULT_ROW.appName,
        DEFAULT_ROW.logoUrl,
        DEFAULT_ROW.maintenanceMode,
        DEFAULT_ROW.featuredChannelId,
        DEFAULT_ROW.heroBannerText,
        DEFAULT_ROW.defaultQuality,
        DEFAULT_ROW.bannerAdScript,
        DEFAULT_ROW.socialBarAdScript,
        DEFAULT_ROW.customAdScripts,
        DEFAULT_ROW.adsEnabled,
        DEFAULT_ROW.homeAdsEnabled,
        DEFAULT_ROW.videoAdsEnabled,
        DEFAULT_ROW.apkUrl,
        DEFAULT_ROW.ga4MeasurementId,
        DEFAULT_ROW.firebaseConfig,
        DEFAULT_ROW.securityEnabled,
        DEFAULT_ROW.redirectAdUrl,
        DEFAULT_ROW.redirectAdEnabled,
        DEFAULT_ROW.redirectAdIntervalMinutes,
        DEFAULT_ROW.monetagEnabled,
        DEFAULT_ROW.monetagZoneId,
        DEFAULT_ROW.monetagDomain
      )
    }

    // Build SET clause dynamically based on which fields were provided.
    const fields: string[] = []
    const params: unknown[] = []

    if (b.appName !== undefined) {
      fields.push('appName = ?')
      params.push(String(b.appName))
    }
    if (b.logoUrl !== undefined) {
      fields.push('logoUrl = ?')
      params.push(String(b.logoUrl))
    }
    if (b.maintenanceMode !== undefined) {
      fields.push('maintenanceMode = ?')
      params.push(toNum(Boolean(b.maintenanceMode)))
    }
    if (b.featuredChannelId !== undefined) {
      fields.push('featuredChannelId = ?')
      params.push(String(b.featuredChannelId))
    }
    if (b.heroBannerText !== undefined) {
      fields.push('heroBannerText = ?')
      params.push(String(b.heroBannerText))
    }
    if (b.defaultQuality !== undefined) {
      fields.push('defaultQuality = ?')
      params.push(String(b.defaultQuality))
    }
    if (b.bannerAdScript !== undefined) {
      fields.push('bannerAdScript = ?')
      params.push(b.bannerAdScript ? String(b.bannerAdScript) : '')
    }
    if (b.socialBarAdScript !== undefined) {
      fields.push('socialBarAdScript = ?')
      params.push(b.socialBarAdScript ? String(b.socialBarAdScript) : '')
    }
    if (b.customAdScripts !== undefined) {
      const val =
        typeof b.customAdScripts === 'string'
          ? b.customAdScripts || '[]'
          : JSON.stringify(b.customAdScripts ?? [])
      fields.push('customAdScripts = ?')
      params.push(val)
    }
    if (b.adsEnabled !== undefined) {
      fields.push('adsEnabled = ?')
      params.push(toNum(Boolean(b.adsEnabled)))
    }
    if (b.homeAdsEnabled !== undefined) {
      fields.push('homeAdsEnabled = ?')
      params.push(toNum(Boolean(b.homeAdsEnabled)))
    }
    if (b.videoAdsEnabled !== undefined) {
      fields.push('videoAdsEnabled = ?')
      params.push(toNum(Boolean(b.videoAdsEnabled)))
    }
    if (b.securityEnabled !== undefined) {
      fields.push('securityEnabled = ?')
      params.push(toNum(Boolean(b.securityEnabled)))
    }
    if (b.apkUrl !== undefined) {
      fields.push('apkUrl = ?')
      params.push(String(b.apkUrl))
    }
    if (b.redirectAdUrl !== undefined) {
      fields.push('redirectAdUrl = ?')
      params.push(String(b.redirectAdUrl))
    }
    if (b.redirectAdEnabled !== undefined) {
      fields.push('redirectAdEnabled = ?')
      params.push(toNum(Boolean(b.redirectAdEnabled)))
    }
    if (b.redirectAdIntervalMinutes !== undefined) {
      const minutes = Math.max(
        1,
        Math.min(1440, parseInt(String(b.redirectAdIntervalMinutes)) || 5)
      )
      fields.push('redirectAdIntervalMinutes = ?')
      params.push(minutes)
    }
    if (b.monetagEnabled !== undefined) {
      fields.push('monetagEnabled = ?')
      params.push(toNum(Boolean(b.monetagEnabled)))
    }
    if (b.monetagZoneId !== undefined) {
      fields.push('monetagZoneId = ?')
      params.push(String(b.monetagZoneId))
    }
    if (b.monetagDomain !== undefined) {
      fields.push('monetagDomain = ?')
      params.push(String(b.monetagDomain))
    }
    if (b.ga4MeasurementId !== undefined) {
      fields.push('ga4MeasurementId = ?')
      params.push(String(b.ga4MeasurementId))
    }
    if (b.firebaseConfig !== undefined) {
      const firebaseVal =
        b.firebaseConfig === null || b.firebaseConfig === undefined
          ? '{}'
          : typeof b.firebaseConfig === 'string'
            ? b.firebaseConfig
            : JSON.stringify(b.firebaseConfig)
      fields.push('firebaseConfig = ?')
      params.push(firebaseVal)
    }

    if (fields.length > 0) {
      params.push('app')
      await db.run(`UPDATE AppSetting SET ${fields.join(', ')} WHERE id = ?`, ...params)
    }

    // Invalidate settings cache
    apiCache.invalidateSettings()

    const row = await db.first<AppSettingRow>("SELECT * FROM AppSetting WHERE id = ?", 'app')
    const settings = row ? rowToSettings(row) : rowToSettings(DEFAULT_ROW)
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[Settings] Error updating settings:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update settings', detail: message },
      { status: 500 }
    )
  }
}
