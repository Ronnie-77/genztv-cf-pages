'use client'

import { useAppStore } from '@/lib/store'
import { useChannels } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'
import { Heart } from 'lucide-react'

export function FavoritesPage() {
  const { favorites } = useAppStore()
  const { channels: allChannels, loading } = useChannels()

  const favChannels = allChannels.filter(ch => favorites.includes(ch.id))

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Heart className="h-6 w-6 text-red-500" />
        <h1 className="text-2xl font-bold">Favorites</h1>
        {favChannels.length > 0 && (
          <span className="text-sm text-muted-foreground">({favChannels.length})</span>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-14 h-14 bg-secondary rounded-xl" />
              <div className="h-3 bg-secondary rounded w-16" />
            </div>
          ))}
        </div>
      ) : favChannels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Heart className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No favorites yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Click the heart icon on any channel to add it to your favorites. They&apos;ll appear here for quick access.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {favChannels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}
