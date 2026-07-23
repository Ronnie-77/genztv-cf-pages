'use client'

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '@/lib/store'
import { useAnalytics } from '@/lib/analytics'
import { TopNav } from './top-nav'
import { Sidebar } from './sidebar'
import { BottomNav } from './bottom-nav'

import { RedirectAd } from '@/components/ads/redirect-ad'

import { X, Download, Smartphone, Wrench, Clock, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchSettings } from '@/lib/api'
import { ErrorBoundary } from '@/components/error-boundary'

// Lazy-load page components with retry logic for robust chunk loading
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  retries = 3
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: Error | null = null
    for (let i = 0; i < retries; i++) {
      try {
        const mod = await factory()
        return mod
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        // Wait a bit before retrying (exponential backoff)
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
        }
      }
    }
    throw lastError
  })
}

const HomePage = lazyWithRetry(() => import('@/views/home').then(m => ({ default: m.HomePage })))
const LivePage = lazyWithRetry(() => import('@/views/live').then(m => ({ default: m.LivePage })))
const WatchPage = lazyWithRetry(() => import('@/views/watch').then(m => ({ default: m.WatchPage })))
const NewsPage = lazyWithRetry(() => import('@/views/news').then(m => ({ default: m.NewsPage })))
const SportsPage = lazyWithRetry(() => import('@/views/sports').then(m => ({ default: m.SportsPage })))
const CricketPage = lazyWithRetry(() => import('@/views/cricket').then(m => ({ default: m.CricketPage })))
const FootballPage = lazyWithRetry(() => import('@/views/football').then(m => ({ default: m.FootballPage })))
const EntertainmentPage = lazyWithRetry(() => import('@/views/entertainment').then(m => ({ default: m.EntertainmentPage })))
const FavoritesPage = lazyWithRetry(() => import('@/views/favorites').then(m => ({ default: m.FavoritesPage })))
const SearchPage = lazyWithRetry(() => import('@/views/search').then(m => ({ default: m.SearchPage })))
const AdminPage = lazyWithRetry(() => import('@/views/admin').then(m => ({ default: m.AdminPage })))
const MorePage = lazyWithRetry(() => import('@/views/more').then(m => ({ default: m.MorePage })))
const HistoryPage = lazyWithRetry(() => import('@/views/history').then(m => ({ default: m.HistoryPage })))

// ── PWA Install Prompt ──
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return
    const dismissedTime = localStorage.getItem('zeng-install-dismissed')
    if (dismissedTime && Date.now() - parseInt(dismissedTime, 10) < 3 * 24 * 60 * 60 * 1000) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setTimeout(() => setShowPrompt(true), 3000)
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => {
      setShowPrompt(false)
      setDeferredPrompt(null)
    })

    return () => { window.removeEventListener('beforeinstallprompt', handler) }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    try {
      await deferredPrompt.prompt()
      const result = await deferredPrompt.userChoice
      if (result.outcome === 'accepted') setShowPrompt(false)
    } catch { /* prompt failed */ }
    setDeferredPrompt(null)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setShowPrompt(false)
    localStorage.setItem('zeng-install-dismissed', Date.now().toString())
  }, [])

  if (!deferredPrompt || !showPrompt) return null

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:max-w-sm z-50 animate-fade-slide">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-foreground to-muted-foreground" />
        <button onClick={handleDismiss} className="absolute top-2 right-2 p-1 rounded-full hover:bg-secondary transition-colors">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <h4 className="text-sm font-semibold mb-1">Install GenZ TV</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Install the app on your device for quick access and a better experience.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleInstall} className="h-8 text-xs gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Install App
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-8 text-xs">
                Not Now
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Maintenance Mode Overlay ──
function MaintenanceMode() {
  const [dots, setDots] = useState(0)
  const [barWidth, setBarWidth] = useState(0)

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev + 1) % 4)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // Animate progress bar
  useEffect(() => {
    let frame: number
    let start: number | null = null
    const duration = 3000

    const animate = (timestamp: number) => {
      if (!start) start = timestamp
      const elapsed = (timestamp - start) % duration
      const progress = elapsed / duration

      if (progress < 0.5) {
        setBarWidth(progress * 120)
      } else {
        setBarWidth((1 - progress) * 120)
      }

      frame = requestAnimationFrame(animate)
    }

    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-80 h-80 sm:w-[400px] sm:h-[400px] rounded-full bg-primary opacity-[0.07] -top-24 -right-24 animate-pulse" />
        <div className="absolute w-64 h-64 sm:w-[300px] sm:h-[300px] rounded-full bg-primary opacity-[0.07] -bottom-20 -left-20 animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute w-48 h-48 sm:w-[200px] sm:h-[200px] rounded-full bg-primary opacity-[0.05] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" style={{ animationDelay: '4s' }} />
        {/* Floating particles */}
        <div className="absolute top-[20%] left-[15%] w-2 h-2 rounded-full bg-primary/20 animate-[maintenanceFloat_6s_ease-in-out_infinite]" />
        <div className="absolute top-[60%] right-[20%] w-3 h-3 rounded-full bg-primary/15 animate-[maintenanceFloat_8s_ease-in-out_1s_infinite]" />
        <div className="absolute bottom-[30%] left-[40%] w-1.5 h-1.5 rounded-full bg-primary/25 animate-[maintenanceFloat_5s_ease-in-out_2s_infinite]" />
        <div className="absolute top-[40%] right-[35%] w-2.5 h-2.5 rounded-full bg-primary/10 animate-[maintenanceFloat_7s_ease-in-out_3s_infinite]" />
        <div className="absolute bottom-[50%] left-[25%] w-2 h-2 rounded-full bg-primary/15 animate-[maintenanceFloat_9s_ease-in-out_0.5s_infinite]" />
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-lg">
        {/* Animated wrench icon */}
        <div className="relative mx-auto w-24 h-24 sm:w-28 sm:h-28 mb-8">
          <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute inset-2 rounded-full bg-primary/5 animate-pulse" />
          <div className="absolute inset-4 rounded-full bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border border-primary/10 flex items-center justify-center">
            <Wrench className="h-8 w-8 sm:h-10 sm:w-10 text-primary" style={{ animation: 'maintenanceWrench 2s ease-in-out infinite', transformOrigin: 'bottom right' }} />
          </div>
          {/* Rotating ring */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-primary/10 animate-[maintenanceSpin_12s_linear_infinite]" />
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight mb-3">
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Under Maintenance
          </span>
        </h1>

        {/* Description with animated dots */}
        <p className="text-muted-foreground text-sm sm:text-lg mb-6 leading-relaxed">
          We&apos;re making some improvements to serve you better.
          <br />
          <span className="inline-block min-w-[40px]">
            We&apos;ll be back shortly{'.'.repeat(dots)}
          </span>
        </p>

        {/* Status card */}
        <div className="inline-flex items-center gap-3 bg-card border border-border rounded-2xl px-5 py-3 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">Working on it</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Est. a few minutes</span>
          </div>
        </div>

        {/* Animated progress bar */}
        <div className="mt-8 mx-auto max-w-xs">
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary/60 via-primary to-primary/60 rounded-full transition-all duration-100 ease-linear"
              style={{ width: `${barWidth}%`, marginLeft: `${(100 - barWidth) / 2}%` }}
            />
          </div>
        </div>

        {/* Brand */}
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Zap className="h-4 w-4 text-primary" />
          <span className="font-semibold">GenZ TV</span>
          <span className="text-muted-foreground/50">•</span>
          <span>Premium Streaming</span>
        </div>
      </div>
    </div>
  )
}

// ── Main App Shell ──
export function AppShell() {
  const { currentPage } = useAppStore()
  const mainRef = useRef<HTMLDivElement>(null)

  // Track page views for analytics
  useAnalytics()
  const [maintenanceMode, setMaintenanceMode] = useState(false)

  // Check maintenance mode on mount and periodically
  // Use useAppStore.getState() inside async callback to avoid stale closure
  useEffect(() => {
    let mounted = true

    const checkMaintenance = async () => {
      try {
        const settings = await fetchSettings()
        if (mounted) {
          // Read the latest isAdminAuth from store directly to avoid stale closure
          const { isAdminAuth } = useAppStore.getState()
          // Admin can always access the site even in maintenance mode
          setMaintenanceMode(settings.maintenanceMode && !isAdminAuth)
        }
      } catch {
        // If settings fetch fails, don't block the site
      }
    }

    checkMaintenance()
    // Re-check every 30 seconds
    const interval = setInterval(checkMaintenance, 30000)

    // Listen for immediate settings updates from admin panel
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'zeng-settings-updated') {
        checkMaintenance()
      }
    }
    // Also listen for same-tab updates (StorageEvent doesn't fire in same tab)
    const handleSettingsUpdate = () => checkMaintenance()
    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('zeng-settings-changed', handleSettingsUpdate)

    return () => {
      mounted = false
      clearInterval(interval)
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('zeng-settings-changed', handleSettingsUpdate)
    }
  }, [])

  // Reset scroll position when page changes
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [currentPage])

  // Register service worker unconditionally (needed for PWA install on
  // mobile / desktop).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Register after window load so it doesn't compete with first paint.
    const doRegister = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // ignore — SW is a progressive enhancement
      })
    }
    if (document.readyState === 'complete') {
      doRegister()
    } else {
      window.addEventListener('load', doRegister, { once: true })
    }
  }, [])

  // Show maintenance mode overlay (but not for admin)
  if (maintenanceMode) {
    return <MaintenanceMode />
  }

  const renderPage = () => {
    const page = (() => {
      switch (currentPage) {
        case 'home':
          return <HomePage />
        case 'live':
          return <LivePage />
        case 'watch':
          return <WatchPage />
        case 'news':
          return <NewsPage />
        case 'sports':
          return <SportsPage />
        case 'cricket':
          return <CricketPage />
        case 'football':
          return <FootballPage />
        case 'entertainment':
          return <EntertainmentPage />
        case 'favorites':
          return <FavoritesPage />
        case 'search':
          return <SearchPage />
        case 'admin':
          return <AdminPage />
        case 'more':
          return <MorePage />
        case 'history':
          return <HistoryPage />
        default:
          return <HomePage />
      }
    })()
    return (
      <ErrorBoundary>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        }>
          {page}
        </Suspense>
      </ErrorBoundary>
    )
  }

  // Admin page has its own full layout — hide app chrome
  const isAdmin = currentPage === 'admin'

  if (isAdmin) {
    return (
      <div className="min-h-screen flex flex-col">
        <main ref={mainRef} className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          <div className="flex-1">
            <div key={currentPage}>
              {renderPage()}
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      {/* pt-14 on mobile (topnav is fixed/out-of-flow); md:pt-0 on desktop
          where topnav is md:sticky (in-flow) — otherwise pt-14 creates a
          56px gap between the topbar and the hero/sidebar content. */}
      <div className="flex flex-1 pt-14 md:pt-0">
        <Sidebar />
        {/* Main content: on desktop, add left margin for fixed sidebar (w-64 = 256px) */}
        <main ref={mainRef} className="flex-1 min-w-0 flex flex-col pb-16 lg:pb-0 lg:ml-64 overflow-y-auto">
          <div className="flex-1">
            <div key={currentPage}>
              {renderPage()}
            </div>
          </div>
          {/* Footer - sticky at bottom */}
          <footer className="mt-auto py-4 px-4 border-t border-border bg-background/50 hidden lg:block">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">GenZ TV</span>
                <span>•</span>
                <span>Premium Live Streaming</span>
              </div>
              <div className="flex items-center gap-4">
                <span>© 2025 GenZ TV</span>
                <span>v2.0</span>
              </div>
            </div>
          </footer>
        </main>
      </div>
      <BottomNav />
      <InstallPrompt />
      <RedirectAd />

    </div>
  )
}
