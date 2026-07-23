'use client'

// ─────────────────────────────────────────────────────────────────────────────
// GenderAvatar — male / female person silhouettes used as chat avatars.
//
// Replaces the old emoji-avatar system. During chat setup the visitor picks
// "Male" or "Female"; that choice is stored as the `avatar` string
// ('male' | 'female') and rendered everywhere an avatar appears:
//   - ChatHeader (current user)
//   - MessageBubble (received messages)
//   - ChatHead (floating bubble, if re-enabled)
//   - ChatSetup (preview + option cards)
//
// `GenderAvatar` normalizes any unknown / legacy value (e.g. an old emoji
// left in localStorage before this change) to 'male' so the UI never breaks
// for returning users.
//
// Both icons use `fill="currentColor"` so they inherit the parent's text
// color and auto-sync with light/dark themes. The female icon uses an SVG
// `evenodd` cut-out so the "face" is a transparent hole that naturally shows
// the background behind it (works on any colored chip / bubble / header).
// ─────────────────────────────────────────────────────────────────────────────

export type GenderAvatarValue = 'male' | 'female'

export interface GenderAvatarProps {
  /** 'male' | 'female' — any other value falls back to 'male'. */
  gender: string | null | undefined
  className?: string
}

/** Normalize any stored avatar string into a valid GenderAvatarValue. */
export function normalizeGender(v: string | null | undefined): GenderAvatarValue {
  return v === 'female' ? 'female' : 'male'
}

/** Male person silhouette — round head + broad shoulders (solid). */
export function MaleAvatar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Head */}
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" />
      {/* Shoulders / body */}
      <path d="M12 13c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

/**
 * Female person silhouette — hair flowing past the face into the body, with
 * a transparent circular "face" cut-out (evenodd). The cut-out shows the
 * background behind the icon, so it looks correct on any chip color.
 */
export function FemaleAvatar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden="true"
    >
      {/* Outer hair+body outline, with an inner circular face hole (evenodd). */}
      <path d="M12 2C8.13 2 5 5.13 5 9c0 1.04.27 2.02.74 2.87C4.66 12.83 4 14.33 4 16v4c0 .55.45 1 1 1h14c.55 0 1-.45 1-1v-4c0-1.67-.66-3.17-1.74-4.13.47-.85.74-1.83.74-2.87 0-3.87-3.13-7-7-7zm0 3.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" />
    </svg>
  )
}

/** Render the correct person icon for a gender value. */
export function GenderAvatar({ gender, className }: GenderAvatarProps) {
  const g = normalizeGender(gender)
  return g === 'female' ? (
    <FemaleAvatar className={className} />
  ) : (
    <MaleAvatar className={className} />
  )
}
