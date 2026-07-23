'use client'

import { useChannels, useCategories } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'
import { useState } from 'react'
import { Tv, Radio } from 'lucide-react'

export function LivePage() {
  const [activeCategory, setActiveCategory] = useState('all')
  const { channels, loading } = useChannels(
    activeCategory !== 'all' ? { category: activeCategory } : undefined
  )
  const { categories } = useCategories()

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-zeng-live" />
        <h1 className="text-2xl font-bold">Channels</h1>
        {!loading && channels.length > 0 && (
          <span className="text-sm text-muted-foreground">({channels.length})</span>
        )}
      </div>
      
      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto scroll-row pb-2">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all btn-press ${
            activeCategory === 'all'
              ? 'bg-foreground text-background'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.name.toLowerCase())}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all btn-press ${
              activeCategory === cat.name.toLowerCase()
                ? 'bg-foreground text-background'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>

      {/* Channel Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-14 h-14 bg-secondary rounded-xl" />
              <div className="h-3 bg-secondary rounded w-16" />
            </div>
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <Tv className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No channels found</h3>
          <p className="text-sm text-muted-foreground">No channels in this category yet.</p>
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
