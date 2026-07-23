'use client'

/**
 * usePwaInstall — PWA install hook for GenZ TV.
 *
 * Captures the browser's `beforeinstallprompt` event (Chrome/Edge/etc.)
 * and exposes a single `install()` function that the UI calls when the user
 * clicks an "Install App" button.
 *
 * Behavior:
 *  - If the browser fired `beforeinstallprompt` (Android Chrome, Desktop
 *    Chrome/Edge) → `install()` calls the native prompt.
 *    Returns `'native'` so the caller knows the native dialog was shown.
 *  - If no prompt was captured (iOS Safari, Desktop Firefox) →
 *    `install()` returns `'manual'` so the caller can show a device-specific
 *    instructions dialog instead.
 *  - If the app is already running standalone (installed) → `install()`
 *    returns `'installed'`.
 *
 * Also exposes the detected device family (`'mobile' | 'desktop'`) and a
 * finer platform hint (`'ios' | 'android' | 'desktop-chromium' | 'firefox' |
 * 'safari' | 'other'`) used by the instructions dialog.
 *
 * Client-only values (device / platform) are read via `useSyncExternalStore`
 * so they are `false`/default during SSR and the real value after hydration —
 * this avoids both hydration mismatches and `setState`-in-effect cascades.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type InstallOutcome = 'native' | 'manual' | 'installed' | 'unavailable'

export type DeviceMode = 'mobile' | 'desktop'

export type PlatformHint =
  | 'ios'
  | 'android'
  | 'desktop-chromium'
  | 'firefox'
  | 'safari'
  | 'other'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectPlatform(): { device: DeviceMode; platform: PlatformHint } {
  if (typeof window === 'undefined') return { device: 'desktop', platform: 'other' }
  const ua = navigator.userAgent || ''
  const device: DeviceMode = window.innerWidth < 768 ? 'mobile' : 'desktop'

  // iOS Safari (iPhone / iPad) — no beforeinstallprompt support.
  // The iPad-on-iOS-13+ reports MacIntel platform; detect touch + Mac UA.
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && /Mac/.test(ua) && 'ontouchend' in document)
  const isAndroid = /android/i.test(ua)
  const isFirefox = /firefox/i.test(ua) && !/seamonkey/i.test(ua)
  const isDesktopChromium =
    !isIOS && !isAndroid && !isFirefox && /chrome|chromium|edg|opr|brave/i.test(ua)
  const isDesktopSafari =
    /safari/i.test(ua) && /macintosh|mac os x/i.test(ua) && !/chrome|chromium|edg/i.test(ua)

  let platform: PlatformHint = 'other'
  if (isIOS) platform = 'ios'
  else if (isAndroid) platform = 'android'
  else if (isFirefox) platform = 'firefox'
  else if (isDesktopChromium) platform = 'desktop-chromium'
  else if (isDesktopSafari) platform = 'safari'

  return { device, platform }
}

function readStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
  } catch {
    /* ignore */
  }
  // iOS Safari standalone flag
  if ((navigator as { standalone?: boolean }).standalone === true) return true
  return false
}

// useSyncExternalStore no-op subscribe + different server/client snapshots →
// returns false during SSR, true on the client. Lets us gate client-only
// reads without setState-in-effect.
const noopSubscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const isClient = useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot)

  // Device / platform are stable for the session — compute once per render
  // after hydration. They only feed the (initially-closed) instructions
  // dialog, so the SSR→client value difference never reaches the DOM.
  const { device, platform } = isClient
    ? detectPlatform()
    : { device: 'desktop' as DeviceMode, platform: 'other' as PlatformHint }

  useEffect(() => {
    if (!isClient) return
    // Already installed → no prompt to capture.
    if (readStandalone()) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const installedHandler = () => setDeferredPrompt(null)

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installedHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [isClient])

  /**
   * Trigger PWA install.
   * - Returns `'native'` if the browser's native install dialog was shown
   *   (and accepted).
   * - Returns `'manual'` if no native prompt is available OR the user
   *   dismissed it — the caller should show a device-specific instructions
   *   dialog.
   * - Returns `'installed'` if the app is already running standalone.
   */
  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (readStandalone()) return 'installed'
    if (!deferredPrompt) return 'manual'
    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      // Once consumed, the event cannot be reused.
      setDeferredPrompt(null)
      return choice.outcome === 'accepted' ? 'native' : 'manual'
    } catch {
      setDeferredPrompt(null)
      return 'manual'
    }
  }, [deferredPrompt])

  return {
    install,
    canInstallNatively: !!deferredPrompt,
    device,
    platform,
  }
}
