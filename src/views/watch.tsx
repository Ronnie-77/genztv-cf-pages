'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { fetchChannel, fetchMatch, fetchChannels, type Channel, type Match } from '@/lib/api'
import { VideoPlayer } from '@/components/player/video-player'
import { DynamicAdSlot } from '@/components/ads/dynamic-ad-slot'
import { SocialBarAd } from '@/components/ads/social-bar-ad'
import { ArrowLeft, Heart, Share2, Tv, ExternalLink, Radio, List, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { fetchSettings } from '@/lib/api'
import { addWatchHistory } from '@/lib/use-watch-history'

// Default banner ad (fallback when no custom ad scripts exist).
// Rendered through the shared sandboxed DynamicAdSlot so document.write()
// inside the ad creative can never destroy the parent React app.
function BannerAd() {
  const script =
    "<script>atOptions = {'key' : '297e220ba939d2e247ad7b9372939809','format' : 'iframe','height' : 90,'width' : 728,'params' : {}};</script>" +
    '<script src="https://www.highperformanceformat.com/297e220ba939d2e247ad7b9372939809/invoke.js" async></script>'
  return <DynamicAdSlot script={script} maxWidth="max-w-[728px]" />
}

export function WatchPage() {
  const { currentChannelId, setCurrentPage, goBack, toggleFavorite, favorites } = useAppStore()
  const [channel, setChannel] = useState<Channel | null>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeStreamIndex, setActiveStreamIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'channel' | 'match'>('channel')
  const [videoAdsEnabled, setVideoAdsEnabled] = useState(true)
  const [videoAboveMobileAds, setVideoAboveMobileAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [videoAbovePcAds, setVideoAbovePcAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [nativeBannerAds, setNativeBannerAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [socialBarAds, setSocialBarAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [legacySocialBarScript, setLegacySocialBarScript] = useState('')
  const [allChannels, setAllChannels] = useState<Channel[]>([])
  const [channelSearch, setChannelSearch] = useState('')

  // Filter channels by search query (name, category, country, language)
  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase()
    if (!q) return allChannels
    return allChannels.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      (ch.category || '').toLowerCase().includes(q) ||
      (ch.country || '').toLowerCase().includes(q) ||
      (ch.language || '').toLowerCase().includes(q)
    )
  }, [allChannels, channelSearch])

  // Fetch ad settings
  useEffect(() => {
    fetchSettings().then(s => {
      setVideoAdsEnabled(s.adsEnabled && (s.videoAdsEnabled ?? true))
      setLegacySocialBarScript(s.socialBarAdScript ?? '')
      try {
        const all = JSON.parse(s.customAdScripts ?? '[]')
        const enabled = (a: {enabled: boolean}) => a.enabled
        setVideoAboveMobileAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'video-above-mobile' && enabled(a)))
        setVideoAbovePcAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'video-above-pc' && enabled(a)))
        setNativeBannerAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'native-banner' && enabled(a)))
        setSocialBarAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'social-bar' && enabled(a)))
      } catch { /* ignore */ }
    }).catch(() => {})
  }, [])

  // Fetch all channels for sidebar list
  useEffect(() => {
    fetchChannels().then(setAllChannels).catch(() => {})
  }, [])

  // Fetch channel or match data
  useEffect(() => {
    if (!currentChannelId) {
      setLoading(false)
      return
    }

    async function loadData() {
      setLoading(true)
      try {
        const ch = await fetchChannel(currentChannelId!)
        setChannel(ch)
        setViewMode('channel')
        // Add to watch history (channel kind)
        addWatchHistory({
          id: ch.id,
          name: ch.name,
          logo: ch.logo,
          category: ch.category,
          streamType: ch.streamType,
          kind: 'channel',
        })
      } catch {
        try {
          const m = await fetchMatch(currentChannelId!)
          setMatch(m)
          setViewMode('match')
          // Add to watch history (match kind)
          addWatchHistory({
            id: m.id,
            name: m.title,
            logo: m.thumbnail || m.teamALogo || m.teamBLogo || '',
            category: m.sport,
            streamType: 'match',
            kind: 'match',
          })
        } catch {
          // Not found
        }
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [currentChannelId])

  // Determine current stream info
  const currentStreamUrl = viewMode === 'channel'
    ? channel?.streamUrl || ''
    : match?.streams?.[activeStreamIndex]?.url || ''

  const currentStreamType = viewMode === 'channel'
    ? channel?.streamType || 'iframe'
    : match?.streams?.[activeStreamIndex]?.type || 'iframe'

  const currentTitle = viewMode === 'channel'
    ? channel?.name || 'Unknown Channel'
    : match?.title || 'Unknown Match'

  const isFav = channel ? favorites.includes(channel.id) : false

  // No channel selected state
  if (!currentChannelId && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
          <Tv className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Select a channel to watch</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          Browse channels or matches and click on any to start watching.
        </p>
        <Button onClick={() => setCurrentPage('live')} className="btn-press gap-2">
          <Radio className="h-4 w-4" />
          Browse Channels
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {/* Channel/Match Info Section */}
      <div className="p-4 md:p-6 pb-2 md:pb-3">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goBack()}
            className="shrink-0 mt-0.5"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            {loading ? (
              <>
                <Skeleton className="h-6 w-48 mb-2" />
                <Skeleton className="h-4 w-32" />
              </>
            ) : viewMode === 'channel' && channel ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{channel.name}</h2>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleFavorite(channel.id)}
                      className={`h-8 w-8 rounded-full hover:bg-secondary ${isFav ? 'text-red-500' : 'text-muted-foreground'}`}
                    >
                      <Heart className={`h-4 w-4 ${isFav ? 'fill-red-500' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-secondary text-muted-foreground"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="secondary" className="capitalize">
                    {channel.category}
                  </Badge>
                  {channel.language && (
                    <span className="text-xs text-muted-foreground">{channel.language}</span>
                  )}
                  {channel.country && (
                    <span className="text-xs text-muted-foreground">• {channel.country}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    • {channel.streamType.toUpperCase()}
                  </span>
                </div>
              </>
            ) : viewMode === 'match' && match ? (
              <>
                <h2 className="text-xl font-bold">{match.title}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {match.status === 'live' ? (
                    <Badge className="bg-red-500 text-white animate-live-pulse">● LIVE</Badge>
                  ) : match.status === 'upcoming' ? (
                    <Badge className="bg-yellow-500/20 text-yellow-400">Upcoming</Badge>
                  ) : (
                    <Badge variant="secondary">Ended</Badge>
                  )}
                  <Badge variant="secondary" className="capitalize">
                    {match.sport}
                  </Badge>
                  {match.league && (
                    <span className="text-xs text-muted-foreground">{match.league}</span>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Banner Ad — above video player (outside flex row), left-aligned */}
      {videoAdsEnabled && (
        <div className="px-4 md:px-6 mb-4">
          {/* 📱 Mobile */}
          <div className="flex lg:hidden flex-col items-start gap-3">
            {videoAboveMobileAds.map((ad) => (
              <DynamicAdSlot key={ad.id} script={ad.script} maxWidth="max-w-[728px]" />
            ))}
            {videoAboveMobileAds.length === 0 && <BannerAd />}
          </div>
          {/* 🖥️ PC */}
          <div className="hidden lg:flex flex-col items-start gap-3">
            {videoAbovePcAds.map((ad) => (
              <DynamicAdSlot key={ad.id} script={ad.script} maxWidth="max-w-[728px]" />
            ))}
            {videoAbovePcAds.length === 0 && <BannerAd />}
          </div>
        </div>
      )}

      {/* Social Bar Ad (universal — works on mobile/PC/TV) */}
      {/* Renders below the banner ad, immediately above the video player. Falls
          back to the legacy socialBarAdScript single-field setting. */}
      {videoAdsEnabled && (
        <SocialBarAd ads={socialBarAds} legacyScript={legacySocialBarScript} />
      )}

      {/* Video Player + Channel List */}
      <div className="px-4 md:px-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left: Video Player + Stream Selector */}
          <div className="flex-1 min-w-0 max-w-4xl relative">
            <div className="relative w-full bg-black rounded-xl overflow-hidden z-10">
              {loading ? (
                <div className="w-full aspect-video flex items-center justify-center bg-black">
                  <p className="text-white/40 text-sm">Loading stream...</p>
                </div>
              ) : (
                <VideoPlayer
                  streamUrl={currentStreamUrl}
                  streamType={currentStreamType}
                  channelId={viewMode === 'channel' ? channel?.id : undefined}
                  onStreamUrlRefreshed={(newUrl) => {
                    // Update local channel state so the next render uses the fresh URL.
                    // The server already persisted the new URL — this is just a client-side mirror.
                    if (viewMode === 'channel' && channel) {
                      setChannel({ ...channel, streamUrl: newUrl })
                    }
                  }}
                  title={currentTitle}
                  isLive={viewMode === 'match' ? match?.status === 'live' : true}
                />
              )}
            </div>

            {/* Stream selector for matches — below video */}
            {viewMode === 'match' && match && match.streams.length > 1 && (
              <div className="mt-3">
                <div className="flex gap-1.5 flex-wrap">
                  {match.streams.map((stream, index) => (
                    <button
                      key={stream.id}
                      onClick={() => setActiveStreamIndex(index)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors btn-press ${
                        index === activeStreamIndex
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      {stream.name || `Stream ${index + 1}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Channel List — PC only, top-aligned with video player */}
          <div className="hidden lg:flex lg:flex-col w-72 xl:w-80 shrink-0">
            <div className="rounded-xl border bg-card overflow-hidden">
              {/* Channel list header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
                <List className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Channels</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {channelSearch ? `${filteredChannels.length}/${allChannels.length}` : allChannels.length}
                </span>
              </div>
              {/* Search bar */}
              <div className="relative px-3 py-2 border-b bg-background/50">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  placeholder="Search channels…"
                  className="h-8 pl-7 pr-7 text-xs rounded-lg bg-muted/40 border-transparent focus-visible:bg-background"
                />
                {channelSearch && (
                  <button
                    onClick={() => setChannelSearch('')}
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* Channel list */}
              <div className="overflow-y-auto max-h-[calc(340px+6rem)] channel-list-scroll" style={{ scrollbarGutter: 'stable' }}>
                {allChannels.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">No channels</div>
                ) : filteredChannels.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    No channels match “{channelSearch}”
                  </div>
                ) : (
                  filteredChannels.map((ch) => {
                    const isActive = currentChannelId === ch.id
                    return (
                      <button
                        key={ch.id}
                        onClick={() => {
                          useAppStore.getState().setCurrentChannelId(ch.id)
                          useAppStore.getState().setCurrentMatchId(null)
                          useAppStore.getState().setCurrentPage('watch')
                        }}
                        className={`channel-list-item w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 hover:bg-muted/50 ${
                          isActive ? 'channel-list-item-active' : ''
                        }`}
                      >
                        {ch.logo ? (
                          <img
                            src={ch.logo}
                            alt={ch.name}
                            className={`w-10 h-10 rounded-lg object-contain bg-white p-1 shrink-0 transition-all duration-300 ${isActive ? 'ring-2 ring-primary shadow-md shadow-primary/20' : ''}`}
                            loading="lazy"
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 transition-all duration-300 ${isActive ? 'ring-2 ring-primary shadow-md shadow-primary/20' : ''}`}>
                            <Tv className={`h-5 w-5 transition-colors duration-300 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate transition-all duration-300 ${isActive ? 'font-bold text-primary' : 'font-medium'}`}>
                            {ch.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground capitalize truncate">
                            {ch.category}{ch.country ? ` · ${ch.country}` : ''}
                          </p>
                        </div>
                        {isActive && (
                          <div className="shrink-0 flex items-center gap-1">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 📋 Native Banner Ad — Bottom of Watch Page, left-aligned */}
      {videoAdsEnabled && nativeBannerAds.length > 0 && (
        <div className="px-4 md:px-6 mt-6 mb-4 flex flex-col items-start gap-3">
          {nativeBannerAds.map((ad) => (
            <DynamicAdSlot key={ad.id} script={ad.script} maxWidth="max-w-[728px]" />
          ))}
        </div>
      )}
    </div>
  )
}
