'use client'

// ─────────────────────────────────────────────────────────────────────────────
// IframeDirectPlayer
//
// A minimal, raw iframe embed — NO controls, NO touch lock, NO proxy.
// Use this for stream sources that already provide their own video controls
// inside the iframe (e.g. embedded players from TV networks, sports sites,
// YouTube Live, etc.).
//
// Difference from IframePlayer:
//   • IframePlayer routes the URL through /api/iframe-proxy and adds a touch
//     lock overlay (to block ad clicks on mobile) + reload hint button.
//   • IframeDirectPlayer does NONE of that — it's a plain <iframe> with the
//     raw stream URL as src. The iframe content's own controls are used.
//
// Stream type: 'iframe_direct'
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

interface IframeDirectPlayerProps {
  /** The raw iframe URL (NOT proxied). */
  src: string
  /** Optional title for accessibility. */
  title?: string
  /** Called when the iframe finishes loading. */
  onReady?: () => void
  /** Called if the iframe fails to load. */
  onError?: (message: string) => void
}

export function IframeDirectPlayer({ src, title, onReady, onError }: IframeDirectPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setHasError(false)
  }, [src])

  // Some iframe sources never fire the 'load' event reliably (or block it via
  // sandbox). We set a fallback timeout so the parent doesn't hang on the
  // loading spinner forever.
  useEffect(() => {
    if (!src) return
    const timer = setTimeout(() => {
      if (!loaded) {
        // Don't treat as error — just signal ready so the parent hides the
        // spinner. The iframe is likely loading its own content.
        setLoaded(true)
        onReady?.()
      }
    }, 8000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  const handleLoad = () => {
    setLoaded(true)
    setHasError(false)
    onReady?.()
  }

  const handleError = () => {
    setHasError(true)
    onError?.('Failed to load the embedded stream.')
  }

  if (!src) return null

  return (
    <div className="absolute inset-0 w-full h-full bg-black">
      <iframe
        ref={iframeRef}
        src={src}
        title={title || 'Embedded stream'}
        className="w-full h-full border-0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
}
