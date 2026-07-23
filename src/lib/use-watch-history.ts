'use client'

import { useCallback, useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// useWatchHistory — localStorage-based watch history tracking
//
// Tracks the channels (and matches) the visitor has watched, with the most
// recent first. Each entry stores enough info to render a "Continue Watching"
// card without an extra API call: id, name, logo, category, streamType, and
// the timestamp of the last watch session.
//
// Storage key:  zeng-watch-history
// Max entries:  50  (older entries are pruned automatically)
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchHistoryEntry {
  id: string
  name: string
  logo: string
  category: string
  streamType: string
  /** 'channel' | 'match' — controls how the watch page resolves the id */
  kind: 'channel' | 'match'
  watchedAt: number // epoch ms
  /** How many seconds the user watched (best-effort, reported by player) */
  watchDuration: number
}

const STORAGE_KEY = 'zeng-watch-history'
const MAX_ENTRIES = 50

function loadHistory(): WatchHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidEntry)
  } catch {
    return []
  }
}

function isValidEntry(e: unknown): e is WatchHistoryEntry {
  if (typeof e !== 'object' || e === null) return false
  const entry = e as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.watchedAt === 'number'
  )
}

function saveHistory(entries: WatchHistoryEntry[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
    // Notify same-tab listeners (localStorage 'storage' event only fires cross-tab)
    window.dispatchEvent(new CustomEvent('zeng-watch-history-changed'))
  } catch {
    // ignore quota errors
  }
}

/**
 * Add (or bump) an entry in the watch history.
 * - If the entry already exists (same id), it's moved to the front and its
 *   watchedAt is updated to now.
 * - watchDuration is accumulated across sessions.
 */
export function addWatchHistory(entry: Omit<WatchHistoryEntry, 'watchedAt' | 'watchDuration'> & { watchDuration?: number }) {
  if (typeof window === 'undefined') return
  const history = loadHistory()
  const now = Date.now()
  const existingIdx = history.findIndex((h) => h.id === entry.id)
  const duration = entry.watchDuration ?? 0

  if (existingIdx >= 0) {
    const existing = history[existingIdx]
    const updated: WatchHistoryEntry = {
      ...existing,
      name: entry.name, // refresh name/logo in case they changed
      logo: entry.logo,
      category: entry.category,
      streamType: entry.streamType,
      kind: entry.kind,
      watchedAt: now,
      watchDuration: existing.watchDuration + duration,
    }
    const next = [updated, ...history.filter((_, i) => i !== existingIdx)]
    saveHistory(next)
    return
  }

  const newEntry: WatchHistoryEntry = {
    ...entry,
    watchedAt: now,
    watchDuration: duration,
  }
  const next = [newEntry, ...history]
  saveHistory(next)
}

/**
 * Remove a single entry from watch history by id.
 */
export function removeWatchHistory(id: string) {
  if (typeof window === 'undefined') return
  const history = loadHistory()
  saveHistory(history.filter((h) => h.id !== id))
}

/**
 * Clear the entire watch history.
 */
export function clearWatchHistory() {
  if (typeof window === 'undefined') return
  saveHistory([])
}

/**
 * React hook that reads the watch history and re-renders when it changes
 * (either via the same-tab custom event or the cross-tab storage event).
 */
export function useWatchHistory() {
  // Use a lazy initializer so we read from localStorage on the client's first
  // render (avoiding a flash of empty state + avoiding setState-in-effect).
  // On the server (SSR) window is undefined → return [].
  const [history, setHistory] = useState<WatchHistoryEntry[]>(() => loadHistory())

  useEffect(() => {
    // Subscribe to same-tab updates (our custom event dispatched by addWatchHistory).
    const handleChange = () => setHistory(loadHistory())
    window.addEventListener('zeng-watch-history-changed', handleChange)
    // Cross-tab updates.
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) handleChange()
    }
    window.addEventListener('storage', storageHandler)

    return () => {
      window.removeEventListener('zeng-watch-history-changed', handleChange)
      window.removeEventListener('storage', storageHandler)
    }
  }, [])

  const remove = useCallback((id: string) => {
    removeWatchHistory(id)
  }, [])

  const clear = useCallback(() => {
    clearWatchHistory()
  }, [])

  return { history, loading: false, remove, clear }
}

/**
 * Format a watchedAt timestamp as a relative "time ago" string.
 * e.g. "just now", "5m ago", "2h ago", "3d ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const week = Math.floor(day / 7)
  if (week < 4) return `${week}w ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo ago`
  return `${Math.floor(month / 12)}y ago`
}

/**
 * Format watch duration (seconds) as a compact string.
 * e.g. "45s", "12m", "1h 5m"
 */
export function formatWatchDuration(seconds: number): string {
  if (!seconds || seconds < 1) return ''
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`
}
