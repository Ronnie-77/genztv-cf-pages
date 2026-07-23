'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { Globe, MapPin, Search, Check, ChevronDown, Locate } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMounted } from '@/hooks/use-mounted'

// Major timezones grouped by region for easy selection
const TIMEZONE_GROUPS = [
  {
    region: 'Asia',
    zones: [
      { id: 'Asia/Dhaka', label: 'Dhaka (BST, +6)', country: 'Bangladesh' },
      { id: 'Asia/Kolkata', label: 'Kolkata (IST, +5:30)', country: 'India' },
      { id: 'Asia/Karachi', label: 'Karachi (PKT, +5)', country: 'Pakistan' },
      { id: 'Asia/Dubai', label: 'Dubai (GST, +4)', country: 'UAE' },
      { id: 'Asia/Riyadh', label: 'Riyadh (AST, +3)', country: 'Saudi Arabia' },
      { id: 'Asia/Singapore', label: 'Singapore (SGT, +8)', country: 'Singapore' },
      { id: 'Asia/Hong_Kong', label: 'Hong Kong (HKT, +8)', country: 'Hong Kong' },
      { id: 'Asia/Shanghai', label: 'Shanghai (CST, +8)', country: 'China' },
      { id: 'Asia/Tokyo', label: 'Tokyo (JST, +9)', country: 'Japan' },
      { id: 'Asia/Seoul', label: 'Seoul (KST, +9)', country: 'South Korea' },
      { id: 'Asia/Bangkok', label: 'Bangkok (ICT, +7)', country: 'Thailand' },
      { id: 'Asia/Jakarta', label: 'Jakarta (WIB, +7)', country: 'Indonesia' },
      { id: 'Asia/Kathmandu', label: 'Kathmandu (NPT, +5:45)', country: 'Nepal' },
      { id: 'Asia/Colombo', label: 'Colombo (IST, +5:30)', country: 'Sri Lanka' },
      { id: 'Asia/Tehran', label: 'Tehran (IRST, +3:30)', country: 'Iran' },
    ]
  },
  {
    region: 'Europe',
    zones: [
      { id: 'Europe/London', label: 'London (GMT/BST, +0/+1)', country: 'UK' },
      { id: 'Europe/Paris', label: 'Paris (CET, +1)', country: 'France' },
      { id: 'Europe/Berlin', label: 'Berlin (CET, +1)', country: 'Germany' },
      { id: 'Europe/Moscow', label: 'Moscow (MSK, +3)', country: 'Russia' },
      { id: 'Europe/Istanbul', label: 'Istanbul (TRT, +3)', country: 'Turkey' },
      { id: 'Europe/Rome', label: 'Rome (CET, +1)', country: 'Italy' },
      { id: 'Europe/Madrid', label: 'Madrid (CET, +1)', country: 'Spain' },
      { id: 'Europe/Amsterdam', label: 'Amsterdam (CET, +1)', country: 'Netherlands' },
    ]
  },
  {
    region: 'Americas',
    zones: [
      { id: 'America/New_York', label: 'New York (EST, -5)', country: 'USA' },
      { id: 'America/Chicago', label: 'Chicago (CST, -6)', country: 'USA' },
      { id: 'America/Denver', label: 'Denver (MST, -7)', country: 'USA' },
      { id: 'America/Los_Angeles', label: 'Los Angeles (PST, -8)', country: 'USA' },
      { id: 'America/Toronto', label: 'Toronto (EST, -5)', country: 'Canada' },
      { id: 'America/Sao_Paulo', label: 'São Paulo (BRT, -3)', country: 'Brazil' },
      { id: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART, -3)', country: 'Argentina' },
      { id: 'America/Mexico_City', label: 'Mexico City (CST, -6)', country: 'Mexico' },
    ]
  },
  {
    region: 'Africa',
    zones: [
      { id: 'Africa/Cairo', label: 'Cairo (EET, +2)', country: 'Egypt' },
      { id: 'Africa/Lagos', label: 'Lagos (WAT, +1)', country: 'Nigeria' },
      { id: 'Africa/Johannesburg', label: 'Johannesburg (SAST, +2)', country: 'South Africa' },
      { id: 'Africa/Nairobi', label: 'Nairobi (EAT, +3)', country: 'Kenya' },
    ]
  },
  {
    region: 'Oceania',
    zones: [
      { id: 'Australia/Sydney', label: 'Sydney (AEST, +10)', country: 'Australia' },
      { id: 'Australia/Melbourne', label: 'Melbourne (AEST, +10)', country: 'Australia' },
      { id: 'Pacific/Auckland', label: 'Auckland (NZST, +12)', country: 'New Zealand' },
    ]
  },
  {
    region: 'Other',
    zones: [
      { id: 'UTC', label: 'UTC (+0)', country: 'Universal' },
    ]
  },
]

// Get timezone abbreviation
function getTimezoneAbbr(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'short',
    })
    const parts = formatter.formatToParts(new Date())
    const tzPart = parts.find(p => p.type === 'timeZoneName')
    return tzPart?.value || tz.split('/').pop() || tz
  } catch {
    return tz.split('/').pop() || tz
  }
}

// Get UTC offset string
function getUtcOffset(tz: string): string {
  try {
    const date = new Date()
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }))
    const diff = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60)
    const sign = diff >= 0 ? '+' : '-'
    const absDiff = Math.abs(diff)
    const hours = Math.floor(absDiff / 60)
    const mins = absDiff % 60
    return mins > 0 ? `UTC${sign}${hours}:${String(mins).padStart(2, '0')}` : `UTC${sign}${hours}`
  } catch {
    return ''
  }
}

export function TimezoneSelector() {
  const { timezone, timezoneSource, setTimezone, detectTimezone } = useAppStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const mounted = useMounted()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const abbr = useMemo(() => mounted ? getTimezoneAbbr(timezone) : '...', [timezone, mounted])
  const offset = useMemo(() => mounted ? getUtcOffset(timezone) : '', [timezone, mounted])

  // Filter zones by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return TIMEZONE_GROUPS
    const q = search.toLowerCase()
    return TIMEZONE_GROUPS.map(g => ({
      ...g,
      zones: g.zones.filter(z =>
        z.label.toLowerCase().includes(q) ||
        z.country.toLowerCase().includes(q) ||
        z.id.toLowerCase().includes(q)
      )
    })).filter(g => g.zones.length > 0)
  }, [search])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Focus search on open
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [open])

  const handleSelect = (tzId: string) => {
    setTimezone(tzId, 'manual')
    setOpen(false)
    setSearch('')
  }

  const handleAutoDetect = () => {
    detectTimezone()
    setOpen(false)
    setSearch('')
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
          'hover:bg-secondary/80 active:scale-95',
          mounted && timezoneSource === 'auto'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-foreground'
        )}
        title={mounted ? `Timezone: ${timezone} (${offset})` : 'Timezone'}
      >
        {mounted && timezoneSource === 'auto' ? (
          <Locate className="h-3.5 w-3.5" />
        ) : (
          <Globe className="h-3.5 w-3.5" />
        )}
        <span>{abbr}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          'absolute right-0 top-full mt-2 z-[100]',
          'w-72 sm:w-80 max-h-[70vh]',
          'bg-popover border border-border rounded-xl shadow-xl',
          'flex flex-col overflow-hidden',
          'animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200'
        )}>
          {/* Header */}
          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Timezone</h3>
              <button
                onClick={handleAutoDetect}
                className={cn(
                  'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                  'hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                )}
              >
                <MapPin className="h-3 w-3" />
                Auto Detect
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search timezone..."
                className="w-full h-8 pl-8 pr-3 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Current timezone info */}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                mounted && timezoneSource === 'auto'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-secondary text-muted-foreground'
              )}>
                {mounted && timezoneSource === 'auto' ? <><MapPin className="h-2.5 w-2.5" /> Auto</> : 'Manual'}
              </span>
              <span className="truncate">{timezone.replace(/_/g, ' ')}</span>
              <span className="ml-auto font-mono">{offset}</span>
            </div>
          </div>

          {/* Timezone List */}
          <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
            {filteredGroups.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No timezone found for &quot;{search}&quot;
              </div>
            ) : (
              filteredGroups.map(group => (
                <div key={group.region}>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-secondary/30 sticky top-0">
                    {group.region}
                  </div>
                  {group.zones.map(zone => {
                    const isSelected = timezone === zone.id
                    return (
                      <button
                        key={zone.id}
                        onClick={() => handleSelect(zone.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                          'hover:bg-secondary/50',
                          isSelected && 'bg-primary/5'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'text-xs font-medium truncate',
                              isSelected ? 'text-primary' : 'text-foreground'
                            )}>
                              {zone.label}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{zone.country}</span>
                        </div>
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
