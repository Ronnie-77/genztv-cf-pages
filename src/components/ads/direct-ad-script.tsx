'use client'

import { useEffect, useRef } from 'react'

/**
 * DirectAdScript — renders a third-party ad script DIRECTLY in the main document
 * (NOT inside a sandboxed iframe).
 *
 * WHY DIRECT (NOT IFRAME):
 * Social bar ad scripts (PropellerAds Social Bar, Adsterra Social Bar, Monetag,
 * HilltopAds, etc.) are designed to create STICKY / FLOATING bars that overlay
 * the entire viewport. They do this by appending `position: fixed` elements to
 * the main `document.body`. Inside an iframe, they can only operate within the
 * iframe's bounds — the floating bar gets clipped to a small inline box instead
 * of spanning the full viewport, and close buttons / scroll detection / cookies
 * do not work correctly.
 *
 * These scripts use DOM manipulation (document.body.appendChild, createElement),
 * NOT document.write(), so they are safe to run in the main document. (Banner /
 * popup ads that use document.write() must still use the sandboxed
 * DynamicAdSlot iframe — see dynamic-ad-slot.tsx.)
 *
 * IMPLEMENTATION:
 * Setting `innerHTML` does NOT execute <script> tags (a browser security rule).
 * So we parse the admin-provided markup in a detached element, move all non-
 * script nodes into our container, then for each <script> we create a FRESH
 * <script> element (copying attributes + textContent) and append it — the
 * browser executes freshly-created script elements. This correctly handles
 * both inline scripts and external `<script src="...">` includes.
 *
 * @param script  Raw ad markup — may include <script> tags, plain HTML, etc.
 */
export function DirectAdScript({ script }: { script: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !script.trim()) return

    // Clear any previous content.
    container.innerHTML = ''

    // Parse the markup in a DETACHED element (so nothing executes yet).
    const temp = document.createElement('div')
    temp.innerHTML = script.trim()

    // Collect <script> elements BEFORE moving nodes (querySelectorAll on a
    // detached tree is safe and gives us a static NodeList).
    const scripts = Array.from(temp.querySelectorAll('script'))

    // Move all child nodes (including the non-executing script placeholders)
    // into our live container.
    while (temp.firstChild) {
      container.appendChild(temp.firstChild)
    }

    // Re-create each <script> as a fresh element so the browser executes it.
    // (Scripts inserted via innerHTML or moved via appendChild are NOT executed.)
    scripts.forEach((oldScript) => {
      const newScript = document.createElement('script')
      // Copy all attributes (src, type, async, defer, crossorigin, data-*, etc.)
      Array.from(oldScript.attributes).forEach((attr) => {
        newScript.setAttribute(attr.name, attr.value)
      })
      // Copy inline code (for non-src scripts).
      newScript.textContent = oldScript.textContent
      // Replace the placeholder with the executable script.
      if (oldScript.parentNode) {
        oldScript.parentNode.replaceChild(newScript, oldScript)
      } else {
        container.appendChild(newScript)
      }
    })

    // NOTE on cleanup: We do NOT attempt to remove elements that the ad script
    // appended to document.body (the floating bar). Social bar ad networks
    // rarely expose a public teardown API, and removing the wrong elements
    // could break the page. The floating bar persists for the page session —
    // standard behavior for social bar ads. A full page reload clears it.
    return () => {
      if (container) container.innerHTML = ''
    }
  }, [script])

  if (!script.trim()) return null

  // Minimal mount point — zero height. The ad script creates its own
  // fixed-position floating bar attached to document.body, so this container
  // does NOT need to reserve any layout space.
  return (
    <div
      ref={containerRef}
      className="direct-ad-script-mount"
      style={{ display: 'block', width: '100%', height: 0, overflow: 'visible' }}
      aria-hidden="true"
    />
  )
}
