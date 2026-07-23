'use client'

import { useChannels } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'
import { Film, Tv } from 'lucide-react'

export function EntertainmentPage() {
  const { channels: entertainmentChannels, loading } = useChannels({ category: 'entertainment' })

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Film className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold">Entertainment</h1>
        {!loading && entertainmentChannels.length > 0 && (
          <span className="text-sm text-muted-foreground">({entertainmentChannels.length})</span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Browse your favorite entertainment channels — movies, dramas, music, and more.
      </p>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-14 h-14 bg-secondary rounded-xl" />
              <div className="h-3 bg-secondary rounded w-16" />
            </div>
          ))}
        </div>
      ) : entertainmentChannels.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <Film className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No entertainment channels</h3>
          <p className="text-sm text-muted-foreground">Entertainment channels will appear here once added.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {entertainmentChannels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}
