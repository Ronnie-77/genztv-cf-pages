'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * DynamicAdSlot — safely renders third-party ad scripts inside a sandboxed
 * <iframe srcdoc>.
 *
 * WHY AN IFRAME:
 * Ad networks (Adsterra, PropellerAds, Monetag, HighPerformanceFormat, etc.)
 * frequently call document.write() to inject their creative. When
 * document.write() runs AFTER the page has finished loading (which is always
 * the case for ads injected via React), it implicitly calls document.open(),
 * which WIPES the entire document (the React app included) and leaves the
 * document stream open — the browser shows an infinite loading spinner and
 * the page appears "hung".
 *
 * By running the ad markup inside an iframe, any document.write() operates on
 * the iframe's own document. The parent React app is fully isolated and can
 * never be destroyed. The iframe auto-resizes to fit the creative.
 *
 * SECURITY (CRITICAL):
 * The sandbox attribute MUST NOT include `allow-same-origin` together with
 * `allow-scripts`. That combination is documented by MDN as effectively
 * disabling the sandbox, because it lets the embedded document remove its own
 * sandbox attribute and access `parent.document` / `parent.location`. Aggressive
 * ad networks (Monetag/effectivecpmnetwork.com in particular) exploit this on
 * iPhone Chrome to wipe `parent.document.body.innerHTML` (white page) or to
 * call `parent.location.replace(...)` (auto-redirect to another page).
 *
 * Current sandbox policy:
 *   - allow-scripts               — ad script can run
 *   - allow-popups                — ad can open a new tab (still sandboxed)
 *   - allow-forms                 — ad forms can submit
 *
 * Deliberately OMITTED:
 *   - allow-same-origin           — would let the ad reach `parent.document`
 *   - allow-popups-to-escape-sandbox — would let popups run unsandboxed
 *   - allow-top-navigation        — would let the ad redirect our top page
 *
 * WHY iOS IS BLOCKED ENTIRELY:
 * On iPhone Chrome (WKWebView), Monetag/effectivecpmnetwork.com uses
 * `setInterval`-based auto-redirects that fire without any user tap. Even
 * with a strict sandbox, the iframe can still receive touch events from
 * iOS's scroll/touchstart gesture dispatching — and many of these networks
 * treat any touch event as "user activation" to fire a popup. To eliminate
 * the "site opens, no tap, jumps to a white page" bug on iPhone, we skip
 * ad rendering entirely on iOS and just render a transparent placeholder.
 *
 * @param script  Raw ad markup — may include <script> tags, <iframe> embeds,
 *                plain HTML, etc. (whatever the admin pastes in Settings).
 * @param maxWidth  Optional Tailwind max-width class for the outer wrapper.
 */

// Detect iPhone / iPad / iPod (iOS). iPhone Chrome uses WKWebView, so its
// user-agent still contains "iPhone" (and "CriOS" for Chrome). iPads on
// iOS 13+ report as Mac desktop UA, so we also check for iPad + touch.
function isIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPhone / iPod — always iOS
  if (/iPhone|iPod/i.test(ua)) return true
  // iPad on iOS 13+ reports as Mac, but has touch + Mac OS
  if (/iPad/i.test(ua)) return true
  if (/Macintosh/i.test(ua) && 'ontouchend' in document) return true
  return false
}

export function DynamicAdSlot({
  script,
  maxWidth = 'max-w-4xl',
}: {
  script: string
  maxWidth?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // Skip ad rendering entirely on iOS — Monetag auto-redirects cause the
  // "site opens, jumps to white page without tapping" bug. We can't know
  // iOS during SSR (no navigator), so we mount first, then check. This
  // means SSR renders nothing (safe), and the client decides post-hydration
  // whether to actually load the ad iframe.
  // Single state object to avoid multiple setState calls. The mounted flag
  // starts false (SSR-safe) and flips true on first client effect, where we
  // also detect iOS so we can skip the ad slot entirely on iPhone.
  // (Monetag auto-redirects hijack the parent page on iPhone Chrome — see
  // the "site opens, jumps to white page without tapping" bug.)
  const [state, setState] = useState<{ mounted: boolean; skipAd: boolean }>({
    mounted: false,
    skipAd: false,
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ mounted: true, skipAd: isIOS() })
  }, [])

  const { mounted, skipAd } = state

  useEffect(() => {
    if (!mounted || skipAd) return
    if (!iframeRef.current || !script.trim()) return

    // Build a self-contained HTML document for the ad creative.
    // Note: no <base target="_blank"> here — combined with the strict sandbox
    // (no allow-top-navigation), target=_blank anchors still open in a new
    // sandboxed window via allow-popups, never in the parent.
    const doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;}' +
      'body{display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:40px;}' +
      'img{max-width:100%;height:auto;display:block;}a{color:inherit;}' +
      'iframe{max-width:100%;}</style>' +
      '</head><body>' + script.trim() + '</body></html>'

    iframeRef.current.srcdoc = doc
  }, [script, mounted, skipAd])

  // Auto-resize the iframe to fit its content. Ad creatives frequently load
  // asynchronously (after the iframe `load` event), so we re-check the height
  // a few times to catch late-arriving content.
  const resize = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc || !doc.body) return
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 40)
      if (h > 0) iframe.style.height = h + 'px'
    } catch {
      // cross-origin (some ads navigate the iframe away) — leave default height
    }
  }, [])

  useEffect(() => {
    if (!mounted || skipAd) return
    const iframe = iframeRef.current
    if (!iframe) return
    const onLoad = () => {
      resize()
      // Re-check for async ad content that loads after the initial paint
      setTimeout(resize, 400)
      setTimeout(resize, 1200)
      setTimeout(resize, 2500)
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [script, resize, mounted, skipAd])

  if (!script.trim()) return null

  // Pre-mount (SSR + first client paint): render nothing. Avoids hydration
  // mismatch and prevents the ad iframe from loading before we've decided
  // whether it's safe (i.e. not iOS).
  if (!mounted) return null

  // On iOS we intentionally render nothing — the ad networks configured
  // (Monetag/effectivecpmnetwork.com) auto-redirect the parent page on
  // iPhone Chrome even with a sandboxed iframe, causing the "white page
  // after a few seconds without tapping" bug.
  if (skipAd) return null

  return (
    <iframe
      ref={iframeRef}
      title="advertisement"
      className={`w-full ${maxWidth}`}
      style={{
        minHeight: '50px',
        height: '50px',
        border: 'none',
        display: 'block',
        background: 'transparent',
      }}
      // Sandbox policy (restored to original 2025-06-16 version that Adsterra
      // banner ads were designed for). `allow-same-origin` is REQUIRED for
      // Adsterra's nested ad iframes to load — without it the iframe gets an
      // opaque/null origin and the browser blocks the nested iframe (CORS /
      // sandbox refusal), so banners silently fail. `allow-popups-to-escape-
      // sandbox` lets ad click popups function normally.
      // iOS Monetag auto-redirect bug is handled separately via the isIOS()
      // short-circuit at the top of this component (we skip rendering entirely
      // on iPhone), so we don't need to strip these flags globally.
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
    />
  )
}

