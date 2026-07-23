'use client'

import { useRef, useEffect } from 'react'

interface IframePlayerProps {
  src: string
  onReady?: () => void
  onError?: (error: string) => void
}

export function IframePlayer({ src, onReady, onError }: IframePlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Extract URL from iframe HTML if full iframe tag is provided
  const getSrcUrl = (input: string): string => {
    const srcMatch = input.match(/src=["']([^"']+)["']/)
    if (srcMatch) return srcMatch[1]
    if (input.startsWith('http') || input.startsWith('/')) return input
    return input
  }

  const url = getSrcUrl(src)

  // ── Popup / Ad Blocker (Parent-level) ──
  // Since the iframe is cross-origin, we can't inject scripts inside it.
  // We block popups at the parent window level and refocus when ads steal focus.
  useEffect(() => {
    // 1. Override window.open — block all popups
    const originalOpen = window.open
    window.open = function () {
      return null
    }

    // 2. When window loses focus (popup/new tab opened), aggressively refocus
    const handleBlur = () => {
      setTimeout(() => window.focus(), 10)
      setTimeout(() => window.focus(), 100)
      setTimeout(() => window.focus(), 300)
      setTimeout(() => window.focus(), 600)
    }

    // 3. When tab becomes hidden (mobile: new tab opened), bring back
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        window.focus()
      }
    }

    // 4. Intercept click events to prevent target="_blank" links
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor) {
        const targetAttr = anchor.getAttribute('target')
        const href = anchor.getAttribute('href')
        if (targetAttr === '_blank' || (href && href.startsWith('http') && !href.includes(window.location.hostname))) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          return false
        }
      }
    }

    // 5. Intercept touchstart for mobile ad clicks
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor) {
        const targetAttr = anchor.getAttribute('target')
        const href = anchor.getAttribute('href')
        if (targetAttr === '_blank' || (href && href.startsWith('http') && !href.includes(window.location.hostname))) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
        }
      }
    }

    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('click', handleDocumentClick, true)
    document.addEventListener('touchstart', handleTouchStart, true)

    return () => {
      window.open = originalOpen
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('click', handleDocumentClick, true)
      document.removeEventListener('touchstart', handleTouchStart, true)
    }
  }, [])

  // Periodic focus check — refocus if popup steals window focus
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hasFocus()) {
        window.focus()
      }
    }, 300)
    return () => clearInterval(interval)
  }, [])

  return (
    /* Outer container clips the iframe — hides any scrollbar */
    <div className="absolute inset-0 bg-black overflow-hidden">
      <iframe
        ref={iframeRef}
        src={url}
        className="absolute inset-0 w-full h-full border-0"
        style={{
          overflow: 'hidden',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        scrolling="no"
        // No sandbox — many streaming embeds detect sandbox restrictions and refuse to play.
        // Ad blocking is handled via parent-level window.open override + focus management.
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        // Send origin referrer so downstream anti-bot scripts (e.g. lastzone's
        // isSandboxed / newucaster.js) see a valid referrer chain. Using
        // "no-referrer" breaks sites like go.webcric.com → new.lastzone.top
        // whose embed scripts reject requests with an empty Referer.
        referrerPolicy="no-referrer-when-downgrade"
        onLoad={() => onReady?.()}
        onError={() => onError?.('Failed to load iframe')}
      />
    </div>
  )
}
