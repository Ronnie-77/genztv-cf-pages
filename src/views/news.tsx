'use client'

import { useChannels } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'
import { Newspaper } from 'lucide-react'

export function NewsPage() {
  const { channels, loading } = useChannels({ category: 'news' })

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Newspaper className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">News Channels</h1>
        {!loading && channels.length > 0 && (
          <span className="text-sm text-muted-foreground">({channels.length})</span>
        )}
      </div>
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-14 h-14 bg-secondary rounded-xl" />
              <div className="h-3 bg-secondary rounded w-16" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No news channels</h3>
          <p className="text-sm text-muted-foreground">News channels will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {channels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      )}
    </div>
  )
}
