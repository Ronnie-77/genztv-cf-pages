'use client'

import { useEffect, useMemo, useState } from 'react'
import { useChannels, useMatches } from '@/lib/hooks'
import { ChannelCard } from '@/components/channels/channel-card'
import { MatchCard } from '@/components/matches/match-card'
import { Trophy, Radio, Zap, Tv } from 'lucide-react'

export function SportsPage() {
  // 'sports' category uses contains filter, so it matches "sports", "sports,cricket", "sports,football", etc.
  const { channels, loading: loadingChannels } = useChannels({ category: 'sports' })
  const { matches: liveMatches, loading: loadingLive } = useMatches({ status: 'live' })
  const { matches: upcomingMatches, loading: loadingUpcoming } = useMatches({ status: 'upcoming' })

  // Tick every 30s so matches that have started move to Live section
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [])

  // Split upcoming into "started" and "still upcoming" (same logic as home page)
  const { startedUpcoming, stillUpcoming } = useMemo(() => {
    const started: typeof upcomingMatches = []
    const upcoming: typeof upcomingMatches = []
    for (const m of upcomingMatches) {
      if (new Date(m.startTime).getTime() <= now) {
        started.push(m)
      } else {
        upcoming.push(m)
      }
    }
    return { startedUpcoming: started, stillUpcoming: upcoming }
  }, [upcomingMatches, now])

  // Combined live matches: API live + started-upcoming
  const allLiveMatches = useMemo(() => {
    const combined = [...liveMatches, ...startedUpcoming]
    return combined.filter(m => {
      if (m.endTime && new Date(m.endTime).getTime() <= now) return false
      return true
    })
  }, [liveMatches, startedUpcoming, now])

  // Hide the matches sections entirely if there are none (and loading is done).
  const showLiveSection = loadingLive || allLiveMatches.length > 0
  const showUpcomingSection = loadingUpcoming || stillUpcoming.length > 0
  const hasAnyMatches = showLiveSection || showUpcomingSection

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div className="flex items-center gap-2">
        <Trophy className="h-6 w-6 text-zeng-gold" />
        <h1 className="text-2xl font-bold">Sports</h1>
      </div>

      {/* 🔴 Live Matches Section — only shown if there are live matches */}
      {showLiveSection && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-live-pulse" />
                <h2 className="text-xl font-bold text-foreground">Live Now</h2>
              </div>
              {!loadingLive && allLiveMatches.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {allLiveMatches.length}
                </span>
              )}
            </div>
          </div>

          {loadingLive ? (
            <div className="matches-grid">
              {[1, 2].map(i => (
                <div key={i} className="match-card" style={{ cursor: 'default' }}>
                  <div className="match-card-header">
                    <div className="h-3 bg-secondary rounded w-20" />
                    <div className="h-5 bg-secondary rounded-full w-16" />
                  </div>
                  <div className="match-teams">
                    <div className="match-team"><div className="team-logo" /><div className="h-3 bg-secondary rounded w-16" /></div>
                    <div className="h-4 bg-secondary rounded w-8" />
                    <div className="match-team"><div className="team-logo" /><div className="h-3 bg-secondary rounded w-16" /></div>
                  </div>
                  <div className="match-footer"><div className="h-3 bg-secondary rounded w-24" /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="matches-grid">
              {allLiveMatches.map((match) => (
                <MatchCard key={match.id} match={match} variant="live" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 🕐 Upcoming Matches Section — only shown if there are upcoming matches */}
      {showUpcomingSection && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                <h2 className="text-xl font-bold text-foreground">Coming Up</h2>
              </div>
              {!loadingUpcoming && stillUpcoming.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {stillUpcoming.length}
                </span>
              )}
            </div>
          </div>

          {loadingUpcoming ? (
            <div className="matches-grid">
              {[1, 2, 3].map(i => (
                <div key={i} className="match-card" style={{ cursor: 'default' }}>
                  <div className="match-card-header">
                    <div className="h-3 bg-secondary rounded w-20" />
                    <div className="h-5 bg-secondary rounded-full w-20" />
                  </div>
                  <div className="match-teams">
                    <div className="match-team"><div className="team-logo" /><div className="h-3 bg-secondary rounded w-16" /></div>
                    <div className="h-4 bg-secondary rounded w-8" />
                    <div className="match-team"><div className="team-logo" /><div className="h-3 bg-secondary rounded w-16" /></div>
                  </div>
                  <div className="match-footer"><div className="h-3 bg-secondary rounded w-24" /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="matches-grid">
              {stillUpcoming.map((match) => (
                <MatchCard key={match.id} match={match} variant="upcoming" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Empty state when there are no matches at all */}
      {!hasAnyMatches && (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
            <Trophy className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No matches scheduled right now</p>
          <p className="text-xs text-muted-foreground mt-1">Check back later for live sports action, or browse sports channels below.</p>
        </div>
      )}

      {/* Sports Channels */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Radio className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-bold">All Sports Channels</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Includes channels from Sports, Cricket & Football categories</p>
        {loadingChannels ? (
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
            <Tv className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-1">No sports channels found</h3>
            <p className="text-sm text-muted-foreground">Add sports channels in the admin panel.</p>
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
