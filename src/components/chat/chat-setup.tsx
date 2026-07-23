'use client'

import { useEffect, useRef } from 'react'
import { AVATAR_OPTIONS } from '@/lib/use-chat'
import { GenderAvatar, MaleAvatar, FemaleAvatar } from './chat-avatars'

// ─────────────────────────────────────────────────────────────────────────────
// ChatSetup — name + gender setup screen.
// Shown on first open (no user profile yet) or when editing an existing
// profile (header "Edit" button).
//
// The visitor picks a display name and a gender (Male / Female). The chosen
// gender is stored as the `avatar` string and rendered as a matching person
// silhouette icon everywhere an avatar appears (see chat-avatars.tsx).
//
// The component is fully controlled: parent owns the form state (nameInput,
// avatarInput) + the submit handler.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatSetupProps {
  nameInput: string
  setNameInput: (v: string) => void
  avatarInput: string
  setAvatarInput: (v: string) => void
  onSubmit: () => void
  hasUser: boolean
}

export function ChatSetup({
  nameInput,
  setNameInput,
  avatarInput,
  setAvatarInput,
  onSubmit,
  hasUser,
}: ChatSetupProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the name input on mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background px-5 py-6 flex flex-col">
      {/* Avatar preview (live gender icon) */}
      <div className="flex flex-col items-center gap-3 mb-6">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary ring-4 ring-primary/5">
          <GenderAvatar gender={avatarInput} className="w-12 h-12" />
        </div>
        <p className="text-sm font-medium text-foreground">
          {nameInput.trim() || 'Your name'}
        </p>
      </div>

      {/* Name input */}
      <label className="block mb-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Display name
        </span>
        <input
          ref={inputRef}
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your name"
          maxLength={20}
          className="mt-1.5 w-full h-11 px-4 rounded-xl bg-card border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-shadow"
        />
      </label>

      {/* Gender picker (Male / Female) */}
      <div className="mb-6">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Select gender
        </span>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {AVATAR_OPTIONS.map((g) => {
            const selected = avatarInput === g
            const label = g === 'female' ? 'Female' : 'Male'
            return (
              <button
                key={g}
                type="button"
                onClick={() => setAvatarInput(g)}
                className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border-2 transition-all ${
                  selected
                    ? 'border-primary bg-primary/10 scale-[1.02]'
                    : 'border-border bg-card hover:bg-secondary/60'
                }`}
                aria-label={label}
                aria-pressed={selected}
              >
                <span
                  className={`flex items-center justify-center w-12 h-12 rounded-full ${
                    selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
                  }`}
                >
                  {g === 'female' ? (
                    <FemaleAvatar className="w-7 h-7" />
                  ) : (
                    <MaleAvatar className="w-7 h-7" />
                  )}
                </span>
                <span
                  className={`text-sm font-medium ${
                    selected ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!nameInput.trim()}
        className="mt-auto w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] transition-all btn-press"
      >
        {hasUser ? 'Save changes' : 'Start chatting'}
      </button>

      <p className="mt-3 text-[11px] text-muted-foreground text-center leading-relaxed">
        Messages are public and auto-delete after 4 hours. Be kind.
      </p>
    </div>
  )
}
