'use client'

import { useAppStore } from '@/lib/store'
import { type Channel } from '@/lib/api'
import { Heart, Tv } from 'lucide-react'
import { toast } from 'sonner'

interface ChannelCardProps {
  channel: Channel
  compact?: boolean
  home?: boolean  // Home page variant: no category badge, no view count
}

const categoryIcons: Record<string, string> = {
  news: '📰',
  sports: '🏆',
  cricket: '🏏',
  football: '⚽',
  entertainment: '🎬',
  international: '🌍',
}

/** Parse comma-separated category string into array */
function parseCategories(categoryStr: string): string[] {
  if (!categoryStr) return []
  return categoryStr.split(',').map(c => c.trim()).filter(Boolean)
}

export function ChannelCard({ channel, compact, home }: ChannelCardProps) {
  const { setCurrentPage, setCurrentChannelId, setCurrentMatchId, toggleFavorite, favorites } = useAppStore()
  const isFav = favorites.includes(channel.id)

  const handleClick = () => {
    setCurrentChannelId(channel.id)
    // Clear any previous match-watch attribution so the analytics heartbeat
    // attributes this viewer to the channel, not a stale match id.
    setCurrentMatchId(null)
    setCurrentPage('watch')
  }

  const handleFavToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleFavorite(channel.id)
    const isFavNow = favorites.includes(channel.id)
    toast(isFavNow ? 'Removed from favorites' : 'Added to favorites', {
      description: channel.name,
      duration: 2000,
    })
  }

  if (compact) {
    return (
      <div
        onClick={handleClick}
        className="channel-card flex items-center gap-3 bg-card border border-border p-3 cursor-pointer group rounded-xl shadow-sm"
      >
        <div className="w-10 h-10 bg-secondary flex items-center justify-center shrink-0 overflow-hidden rounded-lg p-1">
          {channel.logo ? (
            <img src={channel.logo} alt={channel.name} className="w-full h-full object-contain" loading="lazy" decoding="async" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <Tv className="h-4 w-4 text-foreground/50" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{channel.name}</p>
          <div className="flex items-center gap-1 flex-wrap">
            {parseCategories(channel.category).map((cat, i) => (
              <span key={i} className="text-[10px] text-muted-foreground">
                {i > 0 && <span className="mr-1">·</span>}
                {categoryIcons[cat] && <span className="mr-0.5">{categoryIcons[cat]}</span>}
                {cat}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={handleFavToggle}
          className="shrink-0 p-1 rounded-full hover:bg-secondary"
        >
          <Heart
            className={`h-4 w-4 ${
              isFav ? 'text-red-500 fill-red-500' : 'text-muted-foreground'
            }`}
          />
        </button>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      className="channel-card bg-card border border-border p-4 flex flex-col items-center gap-3 cursor-pointer group relative rounded-2xl shadow-sm"
    >
      {/* Favorite Button */}
      <button
        onClick={handleFavToggle}
        className="absolute top-2 right-2 p-1.5 rounded-full bg-background/50 hover:bg-background/80 z-10"
      >
        <Heart
          className={`h-3.5 w-3.5 ${
            isFav ? 'text-red-500 fill-red-500' : 'text-muted-foreground'
          }`}
        />
      </button>

      {/* Channel Logo */}
      <div className="w-24 h-24 bg-white flex items-center justify-center overflow-hidden rounded-xl p-2">
        {channel.logo ? (
          <img src={channel.logo} alt={channel.name} className="w-full h-full object-contain" loading="lazy" decoding="async" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <Tv className="h-8 w-8 text-foreground/50" />
        )}
      </div>

      {/* Channel Info */}
      <div className="text-center w-full">
        <p className="text-sm font-medium truncate">{channel.name}</p>
        {!home && (
          <div className="flex items-center justify-center gap-1 flex-wrap">
            {parseCategories(channel.category).map((cat, i) => (
              <span
                key={i}
                className="text-[9px] text-muted-foreground capitalize"
              >
                {i > 0 && <span className="mr-1">·</span>}
                {categoryIcons[cat] && <span className="mr-0.5">{categoryIcons[cat]}</span>}
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Featured indicator */}
      {channel.isFeatured && (
        <div className="absolute top-2 left-2">
          <span className="text-[9px] bg-amber-500/15 text-amber-600 px-1.5 py-0.5 rounded-full font-bold">
            ★
          </span>
        </div>
      )}
    </div>
  )
}
