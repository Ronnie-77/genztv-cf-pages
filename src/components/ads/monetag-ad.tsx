'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchSettings } from '@/lib/api'

/**
 * MonetagAd — Monetag ad network integration component.
 *
 * Renders Monetag zone-based ads alongside the existing Adsterra ad system.
 * Both ad networks work independently and simultaneously.
 *
 * When monetagEnabled is true:
 * 1. Registers the Monetag service worker at /sw-monetag.js (for push ads)
 * 2. Injects the Monetag zone ad script: https://DOMAIN/act/files/zone.js?z=ZONE_ID
 *
 * The component reads settings from the API on mount. If monetagEnabled is
 * false or the zone ID is empty, nothing is rendered.
 *
 * IMPORTANT — RENDERED DIRECTLY (NOT IN AN IFRAME):
 * Monetag scripts create sticky/floating elements attached to document.body,
 * similar to social bar ads. They must run in the main document context.
 */
export function MonetagAd() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [config, setConfig] = useState<{
    enabled: boolean
    zoneId: string
    domain: string
  } | null>(null)
  const swRegistered = useRef(false)

  // Fetch monetag settings from API
  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setConfig({
          enabled: s.monetagEnabled ?? false,
          zoneId: s.monetagZoneId ?? '',
          domain: s.monetagDomain || '5gvci.com',
        })
      })
      .catch(() => {
        // Silently fail — ad components should never break the page
      })
  }, [])

  // Register Monetag service worker for push ads
  useEffect(() => {
    if (!config?.enabled || !config.zoneId || swRegistered.current) return

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw-monetag.js', { scope: '/' })
        .then(() => {
          swRegistered.current = true
        })
        .catch(() => {
          // Service worker registration failed — non-critical
        })
    }
  }, [config])

  // Inject Monetag zone ad script
  useEffect(() => {
    if (!config?.enabled || !config.zoneId || !config.domain) return

    const container = containerRef.current
    if (!container) return

    // Clear any previous content
    container.innerHTML = ''

    // Create the Monetag zone script element
    const script = document.createElement('script')
    script.src = `https://${config.domain}/act/files/zone.js?z=${config.zoneId}`
    script.async = true
    container.appendChild(script)

    return () => {
      if (container) container.innerHTML = ''
    }
  }, [config])

  // Nothing to render if not configured
  if (!config || !config.enabled || !config.zoneId) return null

  // Minimal mount point — zero height. The Monetag script creates its own
  // fixed-position elements attached to document.body.
  return (
    <div
      ref={containerRef}
      className="monetag-ad-mount"
      style={{ display: 'block', width: '100%', height: 0, overflow: 'visible' }}
      aria-hidden="true"
    />
  )
}
