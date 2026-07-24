'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
// No next-auth in CF Pages deployment
import {
  Shield,
  ChevronRight,
  ExternalLink,
  Heart,
  Bell,
  BellOff,
  Sparkles,
  History,
  MessageCircle,
  LogOut,
  User as UserIcon,
} from 'lucide-react'
import { useNotifications } from '@/lib/use-notifications'
import { useAuth } from '@/lib/use-auth'
import { FeedbackDialog } from '@/components/feedback/feedback-dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function AccountPage() {
  const { setCurrentPage, user, setUser } = useAppStore()
  const { login, logout } = useAuth()
  const { permission, isSubscribed, toggleSubscription, subscribe, isLoading } = useNotifications()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  // Fetch session on mount
  useEffect(() => {
    fetch('/api/user/session')
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user)
        }
      })
      .catch(() => {})
  }, [setUser])

  const handleNotificationToggle = async () => {
    if (permission === 'granted') {
      const success = await toggleSubscription()
      if (success !== false) {
        toast(isSubscribed ? 'Notifications disabled' : 'Notifications enabled', {
          duration: 2000,
        })
      }
    } else if (permission === 'default') {
      const success = await subscribe()
      if (success) {
        toast('Notifications enabled!', { duration: 2000 })
      }
    } else if (permission === 'denied') {
      toast('Notifications are blocked. Enable them in browser settings.', {
        duration: 3000,
      })
    }
  }

  const handleSignOut = async () => {
    await logout()
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-lg mx-auto">
      {/* Page Header */}
      <div className="pt-2 pb-1">
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your profile & settings</p>
      </div>

      {/* User Profile Section */}
      <section>
        {user ? (
          <div className="rounded-2xl bg-card border border-border p-5 space-y-4 relative overflow-hidden">
            {/* Decorative accent */}
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-foreground/[0.03] to-transparent" />

            <div className="flex items-center gap-4 relative">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name || 'User'}
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-border shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center ring-2 ring-border shrink-0">
                  <span className="text-xl font-bold text-primary">
                    {(user.name || user.email).charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold truncate">{user.name || 'User'}</h3>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full h-9 text-xs gap-2"
              onClick={handleSignOut}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl bg-card border border-border p-5 space-y-4 relative overflow-hidden">
            {/* Decorative accent */}
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-foreground/[0.03] to-transparent" />

            <div className="flex items-center gap-4 relative">
              <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <UserIcon className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-base font-bold">Guest User</h3>
                <p className="text-sm text-muted-foreground">Sign in to personalize your experience</p>
              </div>
            </div>

            <button
              onClick={login}
              className="w-full flex items-center justify-center gap-3 h-11 px-4 rounded-xl bg-white dark:bg-white/10 border border-gray-200 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/15 hover:shadow-sm transition-all duration-200 text-sm"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="font-medium text-gray-700 dark:text-gray-200">Sign in with Google</span>
            </button>
          </div>
        )}
      </section>

      {/* Notification Toggle */}
      <section>
        <button
          onClick={handleNotificationToggle}
          disabled={isLoading}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-foreground/15 transition-all duration-200 group text-left active:scale-[0.98]"
        >
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300 ${
            isSubscribed
              ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20'
              : 'bg-secondary'
          }`}>
            {isSubscribed ? (
              <Bell className="h-5 w-5 text-white" />
            ) : (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {isSubscribed ? 'Notifications Enabled' : 'Notifications Disabled'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {permission === 'denied'
                ? 'Blocked by browser — enable in settings'
                : isSubscribed
                  ? 'Tap to disable push notifications'
                  : 'Tap to enable push notifications'}
            </p>
          </div>
          <div className={`w-11 h-[26px] rounded-full transition-all duration-300 relative shrink-0 ${
            isSubscribed ? 'bg-emerald-500' : 'bg-muted-foreground/30'
          }`}>
            <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 ${
              isSubscribed ? 'left-[22px]' : 'left-[3px]'
            }`} />
          </div>
        </button>
      </section>

      {/* Social Links — Premium Cards */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1">
          Connect with us
        </h2>

        {/* Facebook Card */}
        <a
          href="https://www.facebook.com/ronnie.7r"
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-blue-500/30 transition-all duration-300 group overflow-hidden active:scale-[0.98]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-shadow duration-300">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </div>
          <div className="flex-1 min-w-0 relative z-10">
            <p className="text-sm font-semibold group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              Facebook
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Follow us for updates & news</p>
          </div>
          <div className="relative z-10 w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 group-hover:bg-blue-500/10 transition-colors duration-300">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors" />
          </div>
        </a>

        {/* Telegram Card */}
        <a
          href="https://t.me/ronnie77a"
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-sky-500/30 transition-all duration-300 group overflow-hidden active:scale-[0.98]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-sky-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shrink-0 shadow-lg shadow-sky-500/20 group-hover:shadow-sky-500/30 transition-shadow duration-300">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="white"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          </div>
          <div className="flex-1 min-w-0 relative z-10">
            <p className="text-sm font-semibold group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
              Telegram
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Join our channel for live alerts</p>
          </div>
          <div className="relative z-10 w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0 group-hover:bg-sky-500/10 transition-colors duration-300">
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors" />
          </div>
        </a>
      </section>

      {/* Quick Access */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1">
          Quick Access
        </h2>
        <button
          onClick={() => setCurrentPage('history')}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-foreground/15 transition-all duration-200 group text-left active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
            <History className="h-5 w-5 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Watch History</p>
            <p className="text-xs text-muted-foreground mt-0.5">Recently watched channels & matches</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-200" />
        </button>
        <button
          onClick={() => setFeedbackOpen(true)}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-foreground/15 transition-all duration-200 group text-left active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
            <MessageCircle className="h-5 w-5 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Send Feedback</p>
            <p className="text-xs text-muted-foreground mt-0.5">Report a bug or suggest a feature</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-200" />
        </button>
        <button
          onClick={() => setCurrentPage('admin')}
          className="hidden md:flex w-full items-center gap-4 p-4 rounded-2xl bg-card border border-border hover:border-foreground/15 transition-all duration-200 group text-left active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
            <Shield className="h-5 w-5 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Admin Panel</p>
            <p className="text-xs text-muted-foreground mt-0.5">Manage channels & settings</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-200" />
        </button>
      </section>

      {/* About — Premium Card */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-1">
          About
        </h2>
        <div className="rounded-2xl bg-card border border-border p-5 space-y-4 relative overflow-hidden">
          {/* Decorative corner accent */}
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gradient-to-br from-foreground/[0.03] to-transparent" />

          <div className="flex items-center gap-3 relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">GenZ TV</h3>
              <p className="text-xs text-muted-foreground">Premium Live Streaming</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed relative">
            Your premium destination for live TV, sports, cricket, football &amp; entertainment.
            Watch your favorite channels anytime, anywhere.
          </p>

          <div className="flex items-center gap-2 text-xs text-muted-foreground relative">
            <span className="px-2.5 py-0.5 rounded-full bg-secondary font-semibold text-[10px] uppercase tracking-wide">v2.0</span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3 text-foreground fill-foreground" />
              Built with love
            </span>
          </div>
        </div>
      </section>

      {/* Copyright */}
      <section className="text-center pb-6 pt-2 space-y-1.5">
        <p className="text-xs text-muted-foreground font-medium">
          Made by Ronnie
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          &copy; {new Date().getFullYear()} GenZ TV. All rights reserved.
        </p>
      </section>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  )
}
