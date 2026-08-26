'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { useMatches, useChannels } from '@/lib/hooks'
import { fetchSettings } from '@/lib/api'
import { MatchCard } from '@/components/matches/match-card'
import { ChannelCard } from '@/components/channels/channel-card'
import { DynamicAdSlot } from '@/components/ads/dynamic-ad-slot'
import { SocialBarAd } from '@/components/ads/social-bar-ad'
import { Play, Trophy, Globe, Antenna, ChevronRight, Tv, Zap, Download, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimezoneSelector } from '@/components/timezone/timezone-selector'
import { usePwaInstall } from '@/lib/use-pwa-install'
import { InstallAppDialog } from '@/components/pwa/install-app-dialog'
import { toast } from 'sonner'
import Image from 'next/image'

export function HomePage() {
  const { setCurrentPage } = useAppStore()

  // PWA install (used when no APK is built yet — installs on mobile / PC / TV)
  const { install, device, platform } = usePwaInstall()
  const [installDialogOpen, setInstallDialogOpen] = useState(false)

  // Fetch APK URL and ad settings from settings
  const [apkUrl, setApkUrl] = useState('')

  const handleInstallApp = async () => {
    const outcome = await install()
    if (outcome === 'manual') {
      // No native prompt available (iOS Safari, Firefox, some TVs) OR the
      // user dismissed the native prompt → show device-specific instructions
      // so they can install manually.
      setInstallDialogOpen(true)
    } else if (outcome === 'installed') {
      toast('GenZ TV is already installed on this device.', { duration: 2500 })
    }
    // outcome === 'native' → browser's own install dialog was accepted, done
  }

  const [homeAdsEnabled, setHomeAdsEnabled] = useState(true)
  const [homeAdScripts, setHomeAdScripts] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [homeUpcomingMobileAds, setHomeUpcomingMobileAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [homeUpcomingPcAds, setHomeUpcomingPcAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [nativeBannerAds, setNativeBannerAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [socialBarAds, setSocialBarAds] = useState<{id: string; name: string; script: string; position: string; enabled: boolean}[]>([])
  const [legacySocialBarScript, setLegacySocialBarScript] = useState('')
  useEffect(() => {
    fetchSettings().then(s => {
      setApkUrl(s.apkUrl || '')
      setHomeAdsEnabled(s.adsEnabled && (s.homeAdsEnabled ?? true))
      setLegacySocialBarScript(s.socialBarAdScript ?? '')
      // Parse custom ad scripts for home page
      try {
        const all = JSON.parse(s.customAdScripts ?? '[]')
        const enabled = (a: {enabled: boolean}) => a.enabled
        setHomeAdScripts(all.filter((a: {position: string; enabled: boolean}) => a.position === 'home-banner' && enabled(a)))
        setHomeUpcomingMobileAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'home-upcoming-mobile' && enabled(a)))
        setHomeUpcomingPcAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'home-upcoming-pc' && enabled(a)))
        setNativeBannerAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'native-banner' && enabled(a)))
        setSocialBarAds(all.filter((a: {position: string; enabled: boolean}) => a.position === 'social-bar' && enabled(a)))
      } catch { /* ignore */ }
    }).catch(() => {})
  }, [])

  // Fetch real data from API.
  // refetchInterval=60s silently refreshes the live + upcoming lists so that
  // matches move to the Live section at their actual start time AND the
  // server-side status sync runs regularly.
  const { matches: liveMatches, loading: loadingLive } = useMatches({ status: 'live', refetchInterval: 60_000 })
  const { matches: upcomingMatches, loading: loadingUpcoming } = useMatches({ status: 'upcoming', refetchInterval: 60_000 })
  const { channels } = useChannels({})
  const { channels: featuredChannels, loading: loadingFeatured } = useChannels({ featured: true })

  // Tick every 30s so matches that have started move to Live section
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [])

  // Split upcoming into "started" and "still upcoming"
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

  return (
    <div className="space-y-0">
      {/* ── Hero Section — Apple-style Clean Design ── */}
      <section className="hero-new">
        {/* Soft gradient background */}
        <div className="hero-new-bg" />
        
        {/* Decorative floating shapes */}
        <div className="hero-new-shapes">
          <div className="hero-new-circle hero-new-circle-1" />
          <div className="hero-new-circle hero-new-circle-2" />
          <div className="hero-new-circle hero-new-circle-3" />
        </div>

        {/* Content */}
        <div className="hero-new-content">
          {/* Left: Text Content */}
          <div className="hero-new-text">
            {/* Title */}
            <h1 className="hero-new-title">
              <span className="hero-new-title-brand">GenZ</span>{' '}
              <span className="hero-new-title-tv">TV</span>
            </h1>

            {/* Subtitle */}
            <p className="hero-new-subtitle">
              Your premium destination for live TV, sports, cricket, football &amp; entertainment streaming.
            </p>

            {/* CTA Buttons */}
            <div className="hero-new-actions">
              <Button
                onClick={() => setCurrentPage('live')}
                className="hero-new-btn-primary"
              >
                <Play className="h-4 w-4 fill-current" />
                Watch Live
              </Button>
              <Button
                variant="outline"
                onClick={() => setCurrentPage('sports')}
                className="hero-new-btn-secondary"
              >
                Explore Sports
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Quick stats row */}
            <div className="hero-new-stats">
              <div className="hero-new-stat">
                <Antenna className="h-4 w-4" />
                <span>{channels.length || '50+'} Channels</span>
              </div>
              <div className="hero-new-stat-divider" />
              <div className="hero-new-stat">
                <Trophy className="h-4 w-4" />
                <span>Live Sports</span>
              </div>
              <div className="hero-new-stat-divider" />
              <div className="hero-new-stat">
                <Globe className="h-4 w-4" />
                <span>HD Quality</span>
              </div>
            </div>
          </div>

          {/* Right: Phone Mockup + App Download CTA (Side by Side) */}
          <div className="hero-new-visual">
            <div className="hero-new-phone-side">
              {/* Phone Mockup Image */}
              <div className="hero-new-phone-frame">
                <Image
                  src="/phone-mockup.png"
                  unoptimized
                  alt="GenZ TV Mobile App"
                  width={300}
                  height={525}
                  className="hero-new-phone-image"
                  priority
                />
              </div>

              {/* App Download Section - Beside Phone */}
              <div className="hero-new-download">
                <div className="hero-new-download-text">
                  <Smartphone className="h-5 w-5" />
                  <span>Get the GenZ TV App</span>
                </div>
                <p className="hero-new-download-desc">
                  Install as an app on your phone, PC or TV for instant access.
                </p>
                <button
                  className="hero-new-download-btn"
                  onClick={() => {
                    if (apkUrl) {
                      // APK is built → download the native APK file (Android)
                      const a = document.createElement('a')
                      a.href = apkUrl
                      // Extract filename from URL for proper download
                      const fileName = apkUrl.split('/').pop() || 'app.apk'
                      a.download = fileName
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    } else {
                      // No APK yet → install the PWA (mobile / PC / TV)
                      handleInstallApp()
                    }
                  }}
                >
                  {apkUrl ? (
                    <svg className="hero-new-android-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.523 2.232l1.368-2.637c.14-.27-.065-.522-.307-.39l-1.395 2.69C15.852 1.198 14.478.75 13 .75s-2.852.448-4.189 1.145L7.416-.795c-.143-.133-.447.12-.307.39l1.368 2.637C5.731 3.746 4 6.303 4 9.25h18c0-2.947-1.731-5.504-4.477-7.018zM9.5 7.5a1 1 0 110-2 1 1 0 010 2zm7 0a1 1 0 110-2 1 1 0 010 2zM4 10.25h18v1H4v-1zm0 2h18c0 5.523-4.029 10-9 10s-9-4.477-9-10z"/>
                    </svg>
                  ) : (
                    <Download className="h-5 w-5" />
                  )}
                  <span>{apkUrl ? 'Download APK' : 'Install App'}</span>
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Timezone Selector (PC view only, below hero) ── */}
      <div className="hidden lg:flex justify-center py-2 px-4 md:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          <span>Timezone:</span>
          <TimezoneSelector />
        </div>
      </div>

      {/* ── Ad Banner ── */}
      {/* All ads are now controlled from the admin panel (Custom Ad Scripts).
          No hardcoded fallback ads — nothing renders when no ad scripts are configured. */}
      {homeAdsEnabled && homeAdScripts.length > 0 && (
        <div className="px-4 md:px-6 lg:px-8 py-3 flex flex-col items-center gap-3">
          {homeAdScripts.map((ad) => (
            <DynamicAdSlot key={ad.id} script={ad.script} />
          ))}
        </div>
      )}

      {/* ── Social Bar Ad (universal — works on mobile/PC/TV) ── */}
      {/* Renders below the top banner, above content sections. Falls back to the
          legacy socialBarAdScript single-field setting for backward compat. */}
      {homeAdsEnabled && (
        <SocialBarAd ads={socialBarAds} legacyScript={legacySocialBarScript} />
      )}

      {/* ── Content Sections ── */}
      <div className="space-y-8 px-4 md:px-6 lg:px-8 py-6">
        {/* 🔴 Live Matches Section — hidden entirely when no live matches exist */}
        {(loadingLive || allLiveMatches.length > 0) && (
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
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage('sports')} className="text-primary gap-1 font-medium">
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Button>
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

        {/* 🕐 Upcoming Matches Section — hidden entirely when no upcoming matches exist */}
        {(loadingUpcoming || stillUpcoming.length > 0) && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                <h2 className="text-xl font-bold text-foreground">Coming Up</h2>
              </div>
              {!loadingUpcoming && upcomingMatches.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {upcomingMatches.length}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage('sports')} className="text-primary gap-1 font-medium">
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Button>
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
              {stillUpcoming.slice(0, 6).map((match) => (
                <MatchCard key={match.id} match={match} variant="upcoming" />
              ))}
            </div>
          )}
        </section>
        )}

        {/* 📱 Ad Banner — Below Upcoming Matches (Mobile) */}
        {homeAdsEnabled && homeUpcomingMobileAds.length > 0 && (
          <div className="flex lg:hidden flex-col items-center gap-3">
            {homeUpcomingMobileAds.map((ad) => (
              <DynamicAdSlot key={ad.id} script={ad.script} />
            ))}
          </div>
        )}

        {/* 🖥️ Ad Banner — Below Upcoming Matches (PC) */}
        {homeAdsEnabled && homeUpcomingPcAds.length > 0 && (
          <div className="hidden lg:flex flex-col items-center gap-3">
            {homeUpcomingPcAds.map((ad) => (
              <DynamicAdSlot key={ad.id} script={ad.script} />
            ))}
          </div>
        )}

        {/* 📺 Featured Channels Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <Tv className="h-5 w-5 text-emerald-500" />
                <h2 className="text-xl font-bold text-foreground">Popular Channels</h2>
              </div>
              {!loadingFeatured && featuredChannels.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {featuredChannels.length}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrentPage('live')} className="text-primary gap-1 font-medium">
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {loadingFeatured ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="bg-card rounded-2xl border border-border p-4 flex flex-col items-center gap-3 animate-pulse">
                  <div className="w-20 h-20 bg-secondary rounded-xl" />
                  <div className="h-3 bg-secondary rounded w-16" />
                </div>
              ))}
            </div>
          ) : featuredChannels.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto mb-3">
                <Tv className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">No channels available yet</p>
              <p className="text-xs text-muted-foreground mt-1">Channels will appear here when added.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
              {featuredChannels.slice(0, 14).map((channel) => (
                <ChannelCard key={channel.id} channel={channel} home />
              ))}
            </div>
          )}
        </section>

        {/* 📋 Native Banner Ad — Below Popular Channels */}
        {homeAdsEnabled && nativeBannerAds.length > 0 && (
          <div className="flex flex-col items-center gap-3">
            {nativeBannerAds.map((ad) => (
              <DynamicAdSlot key={ad.id} script={ad.script} />
            ))}
          </div>
        )}
      </div>

      {/* PWA install instructions (shown when the browser has no native
          beforeinstallprompt — e.g. iOS Safari, Firefox, some Smart TVs) */}
      <InstallAppDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        device={device}
        platform={platform}
      />
    </div>
  )
}
