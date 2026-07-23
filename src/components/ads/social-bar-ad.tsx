'use client'

import { DirectAdScript } from './direct-ad-script'

/**
 * Ad script entry (mirrors the admin AdScript shape, kept loose for runtime flexibility).
 */
interface AdEntry {
  id: string
  name: string
  script: string
  position: string
  enabled: boolean
}

/**
 * SocialBarAd — universal social bar ad slot for mobile / PC.
 *
 * Renders the `social-bar` position ad scripts — the UNIVERSAL position that
 * works on ALL platforms (mobile, PC). This component is placed directly on
 * the Home & Watch pages.
 *
 * Falls back to the legacy `socialBarAdScript` single-field setting when no
 * custom `social-bar` scripts are configured (backward compatibility).
 *
 * IMPORTANT — RENDERED DIRECTLY (NOT IN AN IFRAME):
 * Social bar ad scripts (PropellerAds Social Bar, Adsterra Social Bar, Monetag,
 * HilltopAds, etc.) create sticky/floating bars by appending `position: fixed`
 * elements to `document.body`. They MUST run in the main document — inside an
 * iframe they get clipped to a small inline box and lose viewport/scroll/cookie
 * access. So we use `DirectAdScript` (direct DOM injection) here, NOT the
 * sandboxed `DynamicAdSlot` iframe. (Banner ads that use document.write() still
 * use the iframe — those are handled separately.)
 *
 * @param ads          Pre-filtered enabled ad scripts with position 'social-bar'.
 * @param legacyScript Optional legacy socialBarAdScript fallback.
 */
export function SocialBarAd({
  ads,
  legacyScript = '',
}: {
  ads: AdEntry[]
  legacyScript?: string
}) {
  const hasAds = ads.length > 0
  const hasLegacy = legacyScript.trim().length > 0

  // Nothing to render — bail out so no empty container takes up vertical space.
  if (!hasAds && !hasLegacy) return null

  // Render each script directly in the main document. The mount container is
  // zero-height; the ad network's script creates its own fixed floating bar
  // attached to document.body.
  const scripts = hasAds ? ads.map((a) => a.script) : [legacyScript]

  return (
    <>
      {scripts.map((s, i) => (
        <DirectAdScript key={hasAds ? ads[i].id : `legacy-${i}`} script={s} />
      ))}
    </>
  )
}

/**
 * Helper: given a parsed array of all ad scripts, return the enabled ones
 * matching the universal `social-bar` position.
 *
 * Exported so views (home.tsx, watch.tsx) can avoid duplicating the filter logic.
 */
export function filterSocialBarAds(allAds: AdEntry[]): AdEntry[] {
  return allAds.filter((a) => a.enabled && a.position === 'social-bar')
}
