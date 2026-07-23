export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthenticated } from '@/lib/auth'
import { apiCache } from '@/lib/cache'

// Default settings returned when the DB query fails
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

// GET /api/settings — public read (needed for maintenance mode check, app name, etc.)
export async function GET() {
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

    // If we can't fetch, return defaults so the admin panel still works
    const message = error instanceof Error ? error.message : 'Failed to fetch settings'
    console.warn('[Settings] Returning default settings due to error:', message)
    return NextResponse.json(DEFAULT_SETTINGS)
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

    // Return a useful error message so the admin can see WHY the save failed
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to update settings', detail: message },
      { status: 500 },
    )
  }
}
