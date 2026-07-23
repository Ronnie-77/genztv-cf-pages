'use client'

import { useState } from 'react'
import { useTheme } from 'next-themes'
import { useAppStore } from '@/lib/store'
import { Search, Menu, Tv, Moon, Sun, Monitor, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TimezoneSelector } from '@/components/timezone/timezone-selector'
import { NotificationBell } from '@/components/push/notification-bell'
import { cn } from '@/lib/utils'

export function TopNav() {
  const { setCurrentPage, setSearchQuery, setSidebarOpen } = useAppStore()
  const { theme, setTheme } = useTheme()
  const [themeOpen, setThemeOpen] = useState(false)
  const [mobileThemeOpen, setMobileThemeOpen] = useState(false)

  // Shared theme options — used by both the PC dropdown and the mobile dropdown.
  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: 'Light', color: 'text-amber-500' },
    { value: 'dark' as const, icon: Moon, label: 'Dark', color: 'text-foreground' },
    { value: 'system' as const, icon: Monitor, label: 'System', color: 'text-muted-foreground' },
  ]

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background md:sticky md:glass md:bg-background/80 border-b border-border/50">
      <div className="flex items-center justify-between h-14 px-4 gap-3">
        {/* Left: Menu (mobile) + Logo */}
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-7 w-7" />
          </Button>
          <button
            onClick={() => setCurrentPage('home')}
            className="flex items-center gap-2 shrink-0 group"
          >
            <div className="relative">
              <Tv className="h-7 w-7 text-foreground" />
            </div>
            <span className="font-bold text-lg hidden sm:block">
              <span className="text-foreground">GenZ</span><span className="text-muted-foreground"> TV</span>
            </span>
          </button>
        </div>

        {/* Center: Search box — desktop only */}
        <div className="hidden md:flex flex-1 max-w-md mx-auto min-w-0">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search channels..."
              className="pl-8 bg-secondary/50 border-0 focus-visible:ring-1 focus-visible:ring-primary h-8 text-xs sm:text-sm sm:h-9 sm:pl-9"
              onFocus={() => setCurrentPage('search')}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Right: Notification Bell + Timezone (mobile) + Theme (PC) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Notification Bell */}
          <NotificationBell />

          {/* Timezone selector - mobile only */}
          <div className="lg:hidden flex items-center [&_button]:px-2 [&_button]:py-2 [&_button]:rounded-lg [&_button]:bg-secondary/60 [&_button]:min-h-[36px] [&_button]:min-w-[44px]">
            <TimezoneSelector />
          </div>

          {/* Theme Dropdown - PC */}
          <div className="hidden lg:block relative">
            <button
              onClick={() => setThemeOpen(!themeOpen)}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors"
            >
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-foreground" />
              ) : theme === 'light' ? (
                <Sun className="h-4 w-4 text-amber-500" />
              ) : (
                <Monitor className="h-4 w-4 text-muted-foreground" />
              )}
              <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', themeOpen && 'rotate-180')} />
            </button>
            {themeOpen && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg p-1 min-w-[120px] z-50">
                {[
                  { value: 'light', icon: Sun, label: 'Light', color: 'text-amber-500' },
                  { value: 'dark', icon: Moon, label: 'Dark', color: 'text-foreground' },
                  { value: 'system', icon: Monitor, label: 'System', color: 'text-muted-foreground' },
                ].map((opt) => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setTheme(opt.value); setThemeOpen(false) }}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors',
                        theme === opt.value
                          ? 'bg-secondary text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-secondary/50'
                      )}
                    >
                      <Icon className={cn('h-4 w-4', opt.color)} />
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Mobile: Theme Toggle (light/dark/system) */}
          <div className="lg:hidden relative">
            <button
              onClick={() => setMobileThemeOpen(!mobileThemeOpen)}
              className="flex items-center justify-center p-2 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors min-h-[36px] min-w-[36px]"
              aria-label="Change theme"
            >
              {theme === 'dark' ? (
                <Moon className="h-5 w-5 text-foreground" />
              ) : theme === 'light' ? (
                <Sun className="h-5 w-5 text-amber-500" />
              ) : (
                <Monitor className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
            {mobileThemeOpen && (
              <>
                {/* Transparent backdrop — taps outside the menu close it */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMobileThemeOpen(false)}
                />
                {/* Theme dropdown opens to the RIGHT (left-0) so it stays
                    on-screen — it's the second-from-right icon. */}
                <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg p-1 min-w-[120px] z-50">
                  {themeOptions.map((opt) => {
                    const Icon = opt.icon
                    return (
                      <button
                        key={opt.value}
                        onClick={() => { setTheme(opt.value); setMobileThemeOpen(false) }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors',
                          theme === opt.value
                            ? 'bg-secondary text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-secondary/50'
                        )}
                      >
                        <Icon className={cn('h-4 w-4', opt.color)} />
                        <span>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </header>
  )
}