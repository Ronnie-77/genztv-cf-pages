'use client'

import { useEffect, useRef, useState } from 'react'
import { DirectAdScript } from './direct-ad-script'
import { DynamicAdSlot } from './dynamic-ad-slot'

/**
 * BannerAd — renders a banner ad (e.g. Adsterra 728x90 / 300x250 / native
 * banner) in the MOST compatible way for the specific ad network being used.
 *
 * BACKGROUND / WHY THIS COMPONENT EXISTS:
 * The original `DynamicAdSlot` renders ad markup inside a sandboxed iframe
 * (`sandbox="allow-scripts allow-popups allow-forms"` — deliberately no
 * `allow-same-origin`). That's great for hostile ad networks that use
 * `document.write()` (e.g. Monetag), but it BREAKS Adsterra banner ads:
 *
 *   1. Adsterra's banner script (`/library.js` or `/provider.js`) loads a
 *      NESTED `<iframe>` whose `src` is a relative URL on Adsterra's domain.
 *      Inside a `srcdoc` iframe with NO `allow-same-origin`, the document is
 *      given an opaque/null origin, so the browser refuses to load the
 *      nested ad iframe — it silently fails (CORS / sandbox refusal).
 *   2. Adsterra's script also checks `window.top === window.self` for
 *      anti-clickjacking; inside our iframe that check fails and the script
 *      aborts.
 *
 * SOLUTION:
 * Most Adsterra banner creatives today use DOM manipulation (NOT
 * `document.write()`), so they can be safely injected DIRECTLY into the main
 * document — exactly like we already do for social bar ads via
 * `DirectAdScript`. This is the recommended approach by Adsterra support
 * for React/Next.js apps.
 *
 * This component auto-detects whether the markup looks like a "direct-safe"
 * ad (DOM manipulation, no document.write) or a "hostile" ad that must stay
 * sandboxed. For direct-safe ads, it uses `DirectAdScript`. For hostile ads,
 * it falls back to `DynamicAdSlot`.
 *
 * @param script       Raw ad markup (HTML + <script> tags).
 * @param maxWidth     Optional Tailwind max-width class for the wrapper.
 * @param forceIframe  If true, ALWAYS use the sandboxed iframe (legacy
 *                     behavior). Useful if a specific ad network is known
 *                     to need iframe isolation.
 */
export function BannerAd({
  script,
  maxWidth = 'max-w-4xl',
  forceIframe = false,
}: {
  script: string
  maxWidth?: string
  forceIframe?: boolean
}) {
  if (!script.trim()) return null

  // Detect whether the ad markup is "direct-safe" (DOM-based) or "hostile"
  // (uses document.write, which would destroy the parent page if injected
  // directly).
  const isDirectSafe = !forceIframe && isDirectSafeMarkup(script)

  if (isDirectSafe) {
    // Inject directly into the main document — Adsterra banner ads work
    // correctly this way. The wrapper reserves some vertical space (unlike
    // the zero-height social bar mount) so layout doesn't shift when the
    // ad loads.
    return (
      <div
        className={`w-full ${maxWidth} mx-auto flex justify-center`}
        style={{ minHeight: '50px' }}
      >
        <DirectAdScript script={script} />
      </div>
    )
  }

  // Hostile / unknown markup → fall back to the sandboxed iframe.
  return <DynamicAdSlot script={script} maxWidth={maxWidth} />
}

/**
 * Heuristic: is this ad markup safe to inject directly into the main document?
 *
 * "Safe" means: it does NOT call `document.write()` (which would wipe the
 * React app). It may still manipulate the DOM (createElement, appendChild,
 * innerHTML on its own container) — that's fine.
 *
 * We also treat it as direct-safe if it contains a plain `<iframe>` tag
 * (without a script) — those load fine directly.
 */
function isDirectSafeMarkup(markup: string): boolean {
  const lower = markup.toLowerCase()

  // If the markup uses document.write, it MUST stay in the iframe.
  if (/\bdocument\.write\s*\(/.test(lower)) {
    return false
  }

  // If the markup uses document.open / document.close, keep it sandboxed.
  if (/\bdocument\.(open|close)\s*\(/.test(lower)) {
    return false
  }

  return true
}
