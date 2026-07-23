'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ChatBubbleIcon — a minimalist outlined speech-bubble icon.
// Rounded-rectangle bubble with a tail pointing DOWN from the bottom-center,
// and two centered horizontal lines inside (representing text).
// Thin outline only (no fill). Uses `currentColor` so it inherits text color
// and auto-syncs with dark/light themes.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatBubbleIconProps {
  className?: string
}

export function ChatBubbleIcon({ className }: ChatBubbleIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Rounded-rectangle speech bubble with a center-bottom tail */}
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4.5l-1.5 4-1.5-4H5a2 2 0 0 1-2-2V5z" />
      {/* Two centered horizontal lines (text) */}
      <line x1="7.5" y1="9" x2="16.5" y2="9" />
      <line x1="7.5" y1="12" x2="13" y2="12" />
    </svg>
  )
}
