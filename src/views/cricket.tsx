'use client'

import { useChannels } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'

export function CricketPage() {
  const { channels, loading: loadingChannels } = useChannels({ category: 'cricket' })

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🏏</span>
        <h1 className="text-2xl font-bold">Cricket</h1>
      </div>

      {/* Cricket Channels */}
      <section>
        <h2 className="text-lg font-bold mb-4">Cricket Channels</h2>
        {loadingChannels ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
                <div className="w-14 h-14 bg-secondary rounded-xl" />
                <div className="h-3 bg-secondary rounded w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
