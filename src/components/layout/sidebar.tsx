'use client'

import { useAppStore, type PageName } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Home,
  Tv,
  Newspaper,
  Trophy,
  Target,
  CircleDot,
  Film,
  Heart,
  Settings,
  X,
  Zap,
  ChevronRight,
  History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

const navItems: { icon: React.ElementType; label: string; page: PageName; badge?: string }[] = [
  { icon: Home, label: 'Home', page: 'home' },
  { icon: Tv, label: 'Channels', page: 'live' },
  { icon: Newspaper, label: 'News', page: 'news' },
  { icon: Trophy, label: 'Sports', page: 'sports' },
  { icon: Target, label: 'Cricket', page: 'cricket' },
  { icon: CircleDot, label: 'Football', page: 'football' },
  { icon: Film, label: 'Entertainment', page: 'entertainment' },
  { icon: Heart, label: 'Favorites', page: 'favorites' },
  { icon: History, label: 'History', page: 'history' },
]

export function Sidebar() {
  const { currentPage, setCurrentPage, sidebarOpen, setSidebarOpen, isAdminAuth } = useAppStore()

  const handleNav = (page: PageName) => {
    setCurrentPage(page)
    setSidebarOpen(false)
  }

  return (
    <>
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-sidebar transition-transform duration-300 ease-out border-r border-sidebar-border',
          // Desktop: fixed position below TopNav, doesn't scroll with main content
          'lg:fixed lg:top-14 lg:left-0 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0 lg:z-30',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Mobile Header */}
        <div className="flex items-center justify-between h-14 px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-foreground" />
            <span className="font-bold text-lg">
              <span className="text-foreground">GenZ</span><span className="text-muted-foreground"> TV</span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Desktop: No header needed — TopNav handles the logo */}
        {/* ScrollArea with own scrollbar - full height below TopNav */}
        <ScrollArea className="h-[calc(100%-3.5rem)] lg:h-full px-3 py-4">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = currentPage === item.page
              return (
                <button
                  key={item.page}
                  onClick={() => handleNav(item.page)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 btn-press',
                    isActive
                      ? 'bg-[#E8E8ED] dark:bg-[#3A3A3C] text-foreground font-semibold'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-foreground' : 'text-sidebar-foreground/80')} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto text-xs bg-zeng-live text-white px-1.5 py-0.5 rounded-full animate-live-pulse">
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* Admin Section — only visible after server-side login */}
          {isAdminAuth && (
            <>
              <Separator className="my-4 bg-sidebar-border" />
              <div className="space-y-1">
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Admin
                </p>
                <button
                  onClick={() => handleNav('admin')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 btn-press',
                    currentPage === 'admin'
                      ? 'bg-[#E8E8ED] dark:bg-[#3A3A3C] text-foreground font-semibold'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Settings className={cn('h-5 w-5 shrink-0', currentPage === 'admin' ? 'text-foreground' : 'text-sidebar-foreground/80')} />
                  <span>Admin Panel</span>
                  <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
                </button>
              </div>
            </>
          )}
        </ScrollArea>
      </aside>
    </>
  )
}
