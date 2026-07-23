'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/lib/store'
import { fetchChannels, type Channel } from '@/lib/api'
import { ChannelCard } from '@/components/channels/channel-card'

export function SearchPage() {
  const { searchQuery, setSearchQuery } = useAppStore()
  const [results, setResults] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')

  const doSearch = useCallback(async (query: string, category?: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const data = await fetchChannels({
        search: query,
        ...(category && category !== 'all' ? { category } : {}),
      })
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      doSearch(searchQuery, activeFilter)
    }, 300) // debounce 300ms
    return () => clearTimeout(timer)
  }, [searchQuery, activeFilter, doSearch])

  const filters = ['All', 'News', 'Sports', 'Cricket', 'Football', 'Entertainment', 'International']

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Search className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      {/* Search input — visible on all sizes. On mobile this is the primary
          search entry point (the mobile top nav no longer has a search bar). */}
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id="search-page-input"
          placeholder="Search channels, categories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-secondary/50 border-0 focus-visible:ring-1 focus-visible:ring-primary h-11"
          autoFocus
        />
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 overflow-x-auto scroll-row pb-2">
        {filters.map((cat) => {
          const key = cat.toLowerCase()
          return (
            <button
              key={cat}
              onClick={() => setActiveFilter(key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all btn-press ${
                activeFilter === key
                  ? 'bg-foreground text-background'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-14 h-14 bg-secondary rounded-xl" />
              <div className="h-3 bg-secondary rounded w-16" />
            </div>
          ))}
        </div>
      ) : !searchQuery ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Search for channels</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Type a channel name, category, or language to find what you&apos;re looking for.
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No results found</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Try searching with different keywords or change the filter.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{results.length} result{results.length !== 1 ? 's' : ''} found</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {results.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
