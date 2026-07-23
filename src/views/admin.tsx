'use client'

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppStore } from '@/lib/store'
import { Shield, Eye, EyeOff, LogOut, AlertCircle, Loader2, Tv, BarChart3, Radio, FolderOpen, Settings, Menu, X, Activity, Database, Home, MessageCircle, Bell } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErrorBoundary } from '@/components/error-boundary'

// Lazy-load admin sub-pages with retry logic for robust chunk loading
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
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
        }
      }
    }
    throw lastError
  })
}

const AdminDashboard = lazyWithRetry(() => import('@/views/admin/dashboard').then(m => ({ default: m.AdminDashboard })))
const AdminChannels = lazyWithRetry(() => import('@/views/admin/channels').then(m => ({ default: m.AdminChannels })))
const AdminMatches = lazyWithRetry(() => import('@/views/admin/matches').then(m => ({ default: m.AdminMatches })))
const AdminCategories = lazyWithRetry(() => import('@/views/admin/categories').then(m => ({ default: m.AdminCategories })))
const AdminSettings = lazyWithRetry(() => import('@/views/admin/settings').then(m => ({ default: m.AdminSettings })))
const AdminAnalytics = lazyWithRetry(() => import('@/views/admin/analytics').then(m => ({ default: m.AdminAnalytics })))
const AdminData = lazyWithRetry(() => import('@/views/admin/data').then(m => ({ default: m.AdminData })))
const AdminFeedback = lazyWithRetry(() => import('@/views/admin/feedback').then(m => ({ default: m.AdminFeedback })))
const AdminNotifications = lazyWithRetry(() => import('@/views/admin/notifications').then(m => ({ default: m.AdminNotifications })))

// Bottom nav items (mobile) — icons only, no labels
const bottomNavItems = [
  { id: 'dashboard' as const, label: 'Home', icon: Home },
  { id: 'analytics' as const, label: 'Stats', icon: Activity },
  { id: 'channels' as const, label: 'Channels', icon: Tv },
  { id: 'matches' as const, label: 'Matches', icon: Radio },
  { id: 'notifications' as const, label: 'Notify', icon: Bell },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
]

// Sidebar nav items (all pages, for hamburger menu + desktop sidebar)
const sidebarNavItems = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
  { id: 'analytics' as const, label: 'Analytics', icon: Activity },
  { id: 'channels' as const, label: 'Channels', icon: Tv },
  { id: 'matches' as const, label: 'Matches', icon: Radio },
  { id: 'categories' as const, label: 'Categories', icon: FolderOpen },
  { id: 'feedback' as const, label: 'Feedback', icon: MessageCircle },
  { id: 'notifications' as const, label: 'Notifications', icon: Bell },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
  { id: 'data' as const, label: 'Data', icon: Database },
]

export function AdminPage() {
  const { isAdminAuth, setIsAdminAuth, adminPage, setAdminPage } = useAppStore()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [shakeKey, setShakeKey] = useState(0)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Check server-side session on mount
  const verifySession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/verify')
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated) {
          setIsAdminAuth(true)
        }
      }
    } catch {
      // Network error — ignore
    } finally {
      setVerifying(false)
    }
  }, [setIsAdminAuth])

  useEffect(() => {
    verifySession()
  }, [verifySession])

  // Auto-logout on session expiry - listen for 401s from API calls
  useEffect(() => {
    if (!isAdminAuth) return

    const handleApiError = (event: CustomEvent) => {
      if (event.detail?.status === 401) {
        setIsAdminAuth(false)
      }
    }

    window.addEventListener('admin:unauthorized' as string, handleApiError as EventListener)
    return () => window.removeEventListener('admin:unauthorized' as string, handleApiError as EventListener)
  }, [isAdminAuth, setIsAdminAuth])

  // Close mobile sidebar when navigating
  useEffect(() => {
    setMobileSidebarOpen(false) // eslint-disable-line react-hooks/set-state-in-effect
  }, [adminPage])

  const handleLogin = async () => {
    if (!password.trim()) {
      setError('Please enter the admin password')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setIsAdminAuth(true)
        setPassword('')
        setError('')
        setFailedAttempts(0)
      } else {
        setFailedAttempts(prev => prev + 1)
        setShakeKey(prev => prev + 1)
        if (failedAttempts >= 4) {
          setError('Too many failed attempts. Please wait before trying again.')
        } else {
          setError(data.error || 'Invalid password. Try again.')
        }
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Ignore network errors on logout
    }
    setIsAdminAuth(false)
  }

  // Loading state — verifying session
  if (verifying) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
              <Loader2 className="h-3 w-3 animate-spin text-primary-foreground" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Verifying session...</p>
        </div>
      </div>
    )
  }

  // Login screen
  if (!isAdminAuth) {
    const isRateLimited = failedAttempts >= 5

    return (
      <div className="flex items-center justify-center min-h-[80vh] p-4">
        <div className="w-full max-w-[400px]">
          {/* Brand */}
          <div className="text-center mb-10">
            <h1 className="text-4xl font-black tracking-tight mb-1">
              <span className="text-foreground">GenZ</span>
              <span className="text-muted-foreground font-light"> TV</span>
            </h1>
            <p className="text-sm text-muted-foreground">Admin Control Panel</p>
          </div>

          {/* Login Card */}
          <div
            key={shakeKey}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter admin password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    onKeyDown={(e) => e.key === 'Enter' && !loading && !isRateLimited && handleLogin()}
                    className="h-12 text-sm rounded-xl border-border focus-visible:border-foreground/25 focus-visible:ring-0 px-4"
                    autoFocus
                    disabled={loading || isRateLimited}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {/* Rate limit warning */}
              {isRateLimited && (
                <div className="text-center text-xs text-muted-foreground bg-secondary/50 px-4 py-3 rounded-xl">
                  Too many failed attempts. Please refresh the page and try again later.
                </div>
              )}

              {/* Login button */}
              <button
                onClick={handleLogin}
                disabled={loading || !password.trim() || isRateLimited}
                className="w-full h-12 font-semibold text-sm rounded-xl transition-all focus-visible:outline-none disabled:opacity-80 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
                style={{ backgroundColor: '#1d1d1f', color: '#FFFFFF' }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  'Log In'
                )}
              </button>
            </div>

            {/* Secure connection indicator */}
            <div className="mt-6 pt-4 border-t border-border">
              <div className="flex items-center justify-center text-xs text-muted-foreground gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Secure connection</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Admin panel with sidebar layout
  const renderAdminContent = () => {
    const content = (() => {
      switch (adminPage) {
        case 'dashboard':
          return <AdminDashboard />
        case 'analytics':
          return <AdminAnalytics />
        case 'channels':
          return <AdminChannels />
        case 'matches':
          return <AdminMatches />
        case 'categories':
          return <AdminCategories />
        case 'feedback':
          return <AdminFeedback />
        case 'notifications':
          return <AdminNotifications />
        case 'settings':
          return <AdminSettings />
        case 'data':
          return <AdminData />
        default:
          return <AdminDashboard />
      }
    })()
    return (
      <ErrorBoundary>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[50vh]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }>
          {content}
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <div className="admin-layout">
      {/* Sidebar overlay — mobile only */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar ${mobileSidebarOpen ? 'admin-sidebar-open' : ''}`}>
        {/* Logo area */}
        <div className="admin-sidebar-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Tv className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold tracking-tight leading-none">GenZ TV</h1>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-1 font-medium">Admin</Badge>
            </div>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="admin-sidebar-nav">
          {sidebarNavItems.map((item) => {
            const Icon = item.icon
            const isActive = adminPage === item.id
            return (
              <button
                key={item.id}
                onClick={() => setAdminPage(item.id)}
                className={`admin-sidebar-nav-item ${isActive ? 'admin-sidebar-nav-item-active' : ''}`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="admin-sidebar-footer">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-3 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Session active</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 gap-2 h-9 text-xs"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main content area */}
      <main className="admin-content">
        {/* Header bar — visible on all screens */}
        <div className="admin-mobile-header">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Tv className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">GenZ TV</span>
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Admin</Badge>
          </div>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Page content */}
        <div className="admin-page-content admin-page-content-with-bottom-nav">
          {renderAdminContent()}
        </div>

        {/* Bottom Tab Navigation (mobile only) */}
        <nav className="admin-bottom-nav">
          {bottomNavItems.map((item) => {
            const Icon = item.icon
            const isActive = adminPage === item.id
            return (
              <button
                key={item.id}
                onClick={() => setAdminPage(item.id)}
                className={`admin-bottom-nav-item ${isActive ? 'admin-bottom-nav-item-active' : ''}`}
              >
                <Icon className="h-5 w-5" />
              </button>
            )
          })}
        </nav>
      </main>
    </div>
  )
}
