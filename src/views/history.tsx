'use client'

import { useState, useMemo } from 'react'
import { useWatchHistory, formatTimeAgo, formatWatchDuration } from '@/lib/use-watch-history'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  History as HistoryIcon,
  Trash2,
  Tv,
  Play,
  Clock,
  ArrowLeft,
  Film,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'

export function HistoryPage() {
  const { history, loading, remove, clear } = useWatchHistory()
  const { setCurrentPage, setCurrentChannelId, setCurrentMatchId } = useAppStore()
  const [confirmClear, setConfirmClear] = useState(false)

  // Group entries by day for a cleaner "Today / Yesterday / This week / Older" layout
  const grouped = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterday = today - 24 * 60 * 60 * 1000
    const weekAgo = today - 7 * 24 * 60 * 60 * 1000

    const groups: { label: string; entries: typeof history }[] = {
      today: { label: 'Today', entries: [] },
      yesterday: { label: 'Yesterday', entries: [] },
      thisWeek: { label: 'This Week', entries: [] },
      older: { label: 'Older', entries: [] },
    } as never

    for (const entry of history) {
      if (entry.watchedAt >= today) {
        ;(groups as any).today.entries.push(entry)
      } else if (entry.watchedAt >= yesterday) {
        ;(groups as any).yesterday.entries.push(entry)
      } else if (entry.watchedAt >= weekAgo) {
        ;(groups as any).thisWeek.entries.push(entry)
      } else {
        ;(groups as any).older.entries.push(entry)
      }
    }

    return [
      (groups as any).today,
      (groups as any).yesterday,
      (groups as any).thisWeek,
      (groups as any).older,
    ].filter((g) => g.entries.length > 0)
  }, [history])

  const handleReplay = (entry: (typeof history)[number]) => {
    setCurrentChannelId(entry.id)
    setCurrentMatchId(entry.kind === 'match' ? entry.id : null)
    setCurrentPage('watch')
  }

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 4000) // auto-reset after 4s
      return
    }
    clear()
    setConfirmClear(false)
    toast('Watch history cleared', { duration: 2000 })
  }

  const handleRemove = (id: string, name: string) => {
    remove(id)
    toast(`Removed "${name}" from history`, { duration: 2000 })
  }

  // ── Empty state ──
  if (!loading && history.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentPage('home')}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <HistoryIcon className="h-6 w-6 text-primary" />
              Watch History
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your recently watched channels & matches
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold mb-2">No history yet</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            Channels and matches you watch will appear here so you can quickly
            resume them later.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setCurrentPage('live')} className="gap-2">
              <Tv className="h-4 w-4" />
              Browse Channels
            </Button>
            <Button variant="outline" onClick={() => setCurrentPage('search')} className="gap-2">
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentPage('home')}
          className="shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <HistoryIcon className="h-6 w-6 text-primary" />
            Watch History
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {history.length} {history.length === 1 ? 'item' : 'items'} · stored on this device
          </p>
        </div>
        {history.length > 0 && (
          <Button
            variant={confirmClear ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleClearAll}
            className="gap-2 shrink-0"
          >
            <Trash2 className="h-4 w-4" />
            {confirmClear ? 'Confirm?' : 'Clear All'}
          </Button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-3 rounded-2xl bg-card border border-border animate-pulse"
            >
              <div className="w-16 h-16 rounded-xl bg-secondary" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-secondary rounded w-1/3" />
                <div className="h-3 bg-secondary rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grouped history */}
      {!loading && grouped.map((group) => (
        <section key={group.label} className="mb-8">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1 mb-3">
            {group.label} · {group.entries.length}
          </h2>
          <div className="space-y-2">
            {group.entries.map((entry) => (
              <div
                key={entry.id}
                className="group flex items-center gap-4 p-3 rounded-2xl bg-card border border-border hover:border-foreground/15 transition-all duration-200"
              >
                {/* Thumbnail / Logo */}
                <button
                  onClick={() => handleReplay(entry)}
                  className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-secondary shrink-0 btn-press"
                  aria-label={`Watch ${entry.name}`}
                >
                  {entry.logo ? (
                    <img
                      src={entry.logo}
                      alt={entry.name}
                      className="w-full h-full object-contain bg-white p-1"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Tv className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  {/* Play overlay on hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="h-6 w-6 text-white fill-white" />
                  </div>
                </button>

                {/* Info */}
                <button
                  onClick={() => handleReplay(entry)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                      {entry.name}
                    </h3>
                    {entry.kind === 'match' && (
                      <Badge variant="secondary" className="shrink-0 text-[10px] py-0 px-1.5">
                        Match
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTimeAgo(entry.watchedAt)}
                    </span>
                    {entry.watchDuration > 0 && (
                      <>
                        <span className="text-border">·</span>
                        <span>watched {formatWatchDuration(entry.watchDuration)}</span>
                      </>
                    )}
                    {entry.category && (
                      <>
                        <span className="text-border">·</span>
                        <span className="capitalize">{entry.category}</span>
                      </>
                    )}
                  </div>
                </button>

                {/* Remove */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(entry.id, entry.name)}
                  className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="Remove from history"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Footer note */}
      {!loading && history.length > 0 && (
        <div className="mt-8 p-4 rounded-2xl bg-secondary/40 border border-border">
          <div className="flex items-start gap-3">
            <Film className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <p className="font-medium text-foreground mb-1">About your history</p>
              <p>
                Watch history is stored locally in your browser and is not sent
                to any server. Clearing your browser data will also clear this
                history. A maximum of 50 entries are kept.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
