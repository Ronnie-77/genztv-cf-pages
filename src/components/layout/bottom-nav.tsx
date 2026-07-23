'use client'

import { useAppStore, type PageName } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Home, Tv, Search, Heart, User } from 'lucide-react'

const bottomNavItems: { icon: React.ElementType; label: string; page: PageName }[] = [
  { icon: Home, label: 'Home', page: 'home' },
  { icon: Tv, label: 'Channels', page: 'live' },
  { icon: Search, label: 'Search', page: 'search' },
  { icon: Heart, label: 'Favorites', page: 'favorites' },
  { icon: User, label: 'More', page: 'more' },
]

export function BottomNav() {
  const { currentPage, setCurrentPage } = useAppStore()

  const handleNavClick = (page: PageName) => {
    setCurrentPage(page)
    if (page === 'search') {
      setTimeout(() => {
        const searchInput = document.getElementById(
          'search-page-input'
        ) as HTMLInputElement | null
        if (searchInput) {
          searchInput.focus()
          searchInput.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }, 120)
    }
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass bg-background/95 md:bg-background/80 border-t border-border lg:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {bottomNavItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.page || 
            (item.page === 'more' && ['more', 'admin'].includes(currentPage))
          
          return (
            <button
              key={item.page}
              onClick={() => handleNavClick(item.page)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition-all duration-200 min-w-[56px]',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className={cn(
                'p-1.5 rounded-xl transition-all duration-200',
                isActive && 'bg-[#E8E8ED] dark:bg-[#3A3A3C]'
              )}>
                <Icon className={cn('h-5 w-5', isActive && 'text-foreground')} />
              </div>
              <span className={cn('text-[10px] font-medium', isActive && 'text-foreground font-semibold')}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
