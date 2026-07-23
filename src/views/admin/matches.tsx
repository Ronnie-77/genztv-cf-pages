'use client'

import { useState, useEffect, useCallback, Fragment, useRef } from 'react'
import { Plus, Trophy, Edit, Trash2, X, Check, RefreshCw, Play, Pencil, Tv, Calendar, Radio, Clock, Sparkles, Users, Settings2, ArrowDownUp, ChevronDown, GripVertical, ArrowUp, ArrowDown, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { fetchMatches, fetchChannels, createMatch, updateMatch, deleteMatch, syncMatchStatuses, type Match, type MatchStream, type Channel } from '@/lib/api'
import { searchTeams, type TeamEntry } from '@/lib/teams-data'
import { toast } from 'sonner'
import { DateTimePicker } from '@/components/ui/datetime-picker'

// ─── Timezone helpers for admin ───
// Admin always inputs times in Bangladesh timezone (Asia/Dhaka)
const ADMIN_TIMEZONE = 'Asia/Dhaka'

/** Convert a datetime-local value (from HTML input) in admin timezone to UTC ISO string */
function adminLocalToUTC(dtLocalValue: string): string {
  if (!dtLocalValue) return ''
  // datetime-local gives "YYYY-MM-DDTHH:mm" — interpret as Asia/Dhaka
  // Get the offset for Asia/Dhaka at this specific date
  const date = new Date(dtLocalValue)
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const dhakaStr = date.toLocaleString('en-US', { timeZone: ADMIN_TIMEZONE })
  const utcMs = new Date(utcStr).getTime()
  const dhakaMs = new Date(dhakaStr).getTime()
  const offsetMs = dhakaMs - utcMs // positive for east of UTC (+6h = +360min)
  // The datetime-local value is what the admin entered as Dhaka time
  // But the browser interpreted it as local time. We need to convert:
  // If browser is in UTC and admin enters 11:00, browser makes Date(11:00 UTC)
  // But admin meant 11:00 Dhaka = 05:00 UTC
  // So we subtract the offset between Dhaka and the browser's timezone
  const browserOffsetMs = date.getTimezoneOffset() * -60000 // browser's offset from UTC in ms
  const dhakaOffsetMs = offsetMs // Dhaka's offset from UTC in ms
  const adjustmentMs = browserOffsetMs - dhakaOffsetMs
  const adjusted = new Date(date.getTime() - adjustmentMs)
  return adjusted.toISOString()
}

/** Convert a UTC ISO string from the database to admin timezone datetime-local value */
function utcToAdminLocal(utcDateStr: string): string {
  if (!utcDateStr) return ''
  const date = new Date(utcDateStr)
  // Format in Asia/Dhaka timezone as YYYY-MM-DDTHH:mm
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: ADMIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // sv-SE locale gives "YYYY-MM-DD HH:mm"
  const formatted = formatter.format(date)
  return formatted.replace(' ', 'T')
}

/** Format a UTC date in admin timezone for display */
function formatAdminTime(utcDateStr: string): string {
  if (!utcDateStr) return 'Not set'
  const date = new Date(utcDateStr)
  return date.toLocaleString('en-US', {
    timeZone: ADMIN_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Get the current UTC offset string for admin timezone */
function getAdminOffset(): string {
  const date = new Date()
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const dhakaStr = date.toLocaleString('en-US', { timeZone: ADMIN_TIMEZONE })
  const diff = (new Date(dhakaStr).getTime() - new Date(utcStr).getTime()) / 60000
  const sign = diff >= 0 ? '+' : '-'
  const absDiff = Math.abs(diff)
  const hours = Math.floor(absDiff / 60)
  const mins = absDiff % 60
  return mins > 0 ? `UTC${sign}${hours}:${String(mins).padStart(2, '0')}` : `UTC${sign}${hours}`
}

// ─── Logo renderer helper ───
function TeamLogo({ logo, name, size = 'sm' }: { logo: string; name: string; size?: 'xs' | 'sm' | 'md' }) {
  const sizeClasses = {
    xs: 'w-5 h-5 text-[10px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-10 h-10 text-lg',
  }
  const [erroredUrls, setErroredUrls] = useState<Set<string>>(() => new Set())
  const isUrl = logo?.startsWith('http')
  const hasError = isUrl && erroredUrls.has(logo)

  const handleImgError = () => {
    if (logo) {
      setErroredUrls(prev => {
        const next = new Set(prev)
        next.add(logo)
        return next
      })
    }
  }

  return (
    <div className={`${sizeClasses[size]} rounded-md border border-border bg-secondary flex items-center justify-center overflow-hidden shrink-0`}>
      {isUrl && !hasError ? (
        <img
          src={logo}
          alt={name}
          className="w-full h-full object-contain p-0.5"
          onError={handleImgError}
        />
      ) : logo && !isUrl ? (
        <span className="leading-none">{logo}</span>
      ) : (
        <span className="font-bold" style={{ fontSize: 'inherit' }}>{name?.charAt(0) || '?'}</span>
      )}
    </div>
  )
}

// ─── Team Autocomplete Input ───
function TeamInput({ label, value, logo, sport, onNameChange, onLogoChange }: {
  label: string
  value: string
  logo: string
  sport: string
  onNameChange: (val: string) => void
  onLogoChange: (val: string) => void
}) {
  const [suggestions, setSuggestions] = useState<TeamEntry[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [editingLogo, setEditingLogo] = useState(false)
  const [logoEditValue, setLogoEditValue] = useState(logo)

  const handleInput = (val: string) => {
    onNameChange(val)
    if (val.length > 0) {
      const results = searchTeams(val, sport, 8)
      setSuggestions(results)
      setShowSuggestions(results.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }

  const selectTeam = (team: TeamEntry) => {
    onNameChange(team.name)
    onLogoChange(team.logo)
    setLogoEditValue(team.logo)
    setShowSuggestions(false)
  }

  const handleFocus = () => {
    if (value.length > 0) {
      const results = searchTeams(value, sport, 8)
      setSuggestions(results)
      setShowSuggestions(results.length > 0)
    } else {
      const results = searchTeams('', sport, 8)
      setSuggestions(results)
      setShowSuggestions(true)
    }
  }

  const isUrl = (str: string) => str.startsWith('http')

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex gap-2">
        <div className="relative group">
          <TeamLogo logo={logo} name={value} size="md" />
          <button
            type="button"
            onClick={() => { setEditingLogo(!editingLogo); setLogoEditValue(logo) }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title="Edit logo URL"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        </div>
        <div className="relative flex-1">
          <Input
            value={value}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder={`Type ${sport === 'cricket' ? 'country' : 'team'} name...`}
            className="h-10"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-30 bg-popover border border-border rounded-lg shadow-xl mt-1 overflow-hidden max-h-64 overflow-y-auto">
              {suggestions.map((team, idx) => (
                <button
                  key={`${team.name}-${idx}`}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                  onMouseDown={() => selectTeam(team)}
                >
                  {isUrl(team.logo) ? (
                    <img
                      src={team.logo}
                      alt={team.name}
                      className="w-6 h-6 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <span className="text-base w-6 text-center">{team.logo}</span>
                  )}
                  <span className="flex-1">{team.name}</span>
                  <span className="text-[10px] text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-secondary">
                    {team.type === 'club' ? 'Club' : 'National'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {editingLogo && (
        <div className="flex gap-2 items-center pl-12">
          <Input
            value={logoEditValue}
            onChange={(e) => setLogoEditValue(e.target.value)}
            placeholder="Logo URL or emoji..."
            className="h-7 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 shrink-0"
            onClick={() => {
              onLogoChange(logoEditValue)
              setEditingLogo(false)
            }}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 shrink-0"
            onClick={() => setEditingLogo(false)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Stream Input ───
interface StreamForm {
  name: string
  channel: string
  channelId: string
  // Mirrors the channel streamType options so matches can use the same
  // embed strategies as channels. `direct` and `redirect` are kept as
  // legacy values for rows saved before Task 30; new picks use the
  // canonical channel streamType (m3u, m3u8_direct, m3u8_proxy, …).
  type: 'iframe' | 'iframe_direct' | 'direct' | 'redirect' | 'mpegts' | 'm3u8_jw' | 'dash' | 'm3u' | 'm3u8_direct' | 'm3u8_proxy' | 'github_m3u' | 'fifalive'
  url: string
}

function StreamInput({ stream, onUpdate, onRemove, onMoveUp, onMoveDown, channels, index, isFirst, isLast }: {
  stream: StreamForm
  onUpdate: (s: StreamForm) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  channels: Channel[]
  index: number
  isFirst: boolean
  isLast: boolean
}) {
  const [showChannelPicker, setShowChannelPicker] = useState(false)
  const [channelSearch, setChannelSearch] = useState('')

  const filteredChannels = channelSearch.trim()
    ? channels.filter(c =>
        c.name.toLowerCase().includes(channelSearch.toLowerCase()) ||
        c.tags.toLowerCase().includes(channelSearch.toLowerCase())
      )
    : channels

  const handleSelectChannel = (ch: Channel) => {
    // Preserve the channel's exact streamType so the match uses the SAME
    // embed strategy the admin picked when creating the channel.
    // (Before Task 30, m3u8_direct / m3u8_proxy / github_m3u / fifalive
    //  all silently fell through to the 'iframe' default here, which made
    //  those channels play through the wrong player at match time.)
    const KNOWN_MATCH_TYPES: StreamForm['type'][] = [
      'm3u', 'm3u8_direct', 'm3u8_proxy', 'm3u8_jw',
      'iframe', 'iframe_direct', 'mpegts', 'dash',
      'github_m3u', 'fifalive', 'direct', 'redirect',
    ]
    const streamType: StreamForm['type'] = KNOWN_MATCH_TYPES.includes(ch.streamType as StreamForm['type'])
      ? (ch.streamType as StreamForm['type'])
      : 'iframe'

    onUpdate({
      ...stream,
      name: ch.name,
      channel: ch.name,
      channelId: ch.id,
      type: streamType,
      url: ch.streamUrl,
    })
    setShowChannelPicker(false)
    setChannelSearch('')
  }

  return (
    <div className="relative flex gap-1.5 p-3 bg-secondary/20 rounded-xl border border-border/50 hover:border-border transition-colors group">
      {/* Grip handle + up/down buttons */}
      <div className="flex flex-col items-center justify-center gap-0.5 shrink-0">
        <div
          className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="flex flex-col gap-px">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move up"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move down"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Stream content */}
      <div className="flex-1 min-w-0">
      {/* Stream header - Pick Channel on LEFT side */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded">
            Stream {index + 1}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`h-6 text-[10px] gap-1 px-2 ${showChannelPicker ? 'bg-primary/10 border-primary/30 text-primary' : ''}`}
            onClick={() => { setShowChannelPicker(!showChannelPicker); setChannelSearch('') }}
          >
            <Tv className="h-3 w-3" />
            Pick Channel
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showChannelPicker ? 'rotate-180' : ''}`} />
          </Button>
          {stream.channel && (
            <div className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              <Tv className="h-2.5 w-2.5" />
              <span className="font-medium max-w-[120px] truncate">{stream.channel}</span>
              <button
                type="button"
                onClick={() => onUpdate({ ...stream, channel: '', channelId: '', name: stream.name === stream.channel ? '' : stream.name })}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="Remove stream"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Channel picker dropdown - appears below the left-side button */}
      {showChannelPicker && (
        <div className="mb-3">
          <div className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-border">
              <Input
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                className="h-7 text-xs"
                autoFocus
              />
            </div>
            <div className="max-h-40 overflow-y-auto">
              {filteredChannels.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">No channels found</div>
              ) : (
                filteredChannels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary transition-colors text-left"
                    onMouseDown={() => handleSelectChannel(ch)}
                  >
                    <div className="w-5 h-5 rounded overflow-hidden bg-secondary flex items-center justify-center shrink-0">
                      {ch.logo ? (
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="w-full h-full object-contain p-0.5"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                            const parent = (e.target as HTMLImageElement).parentElement!
                            parent.innerHTML = '<span class="text-[8px]">📺</span>'
                          }}
                        />
                      ) : (
                        <span className="text-[8px]">📺</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{ch.name}</div>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded capitalize ${
                      ch.streamType === 'iframe' ? 'bg-blue-500/10 text-blue-400' :
                      ch.streamType === 'm3u' ? 'bg-green-500/10 text-green-400' :
                      ch.streamType === 'm3u8_direct' ? 'bg-emerald-500/10 text-emerald-400' :
                      ch.streamType === 'm3u8_proxy' ? 'bg-amber-500/10 text-amber-400' :
                      ch.streamType === 'm3u8_jw' ? 'bg-teal-500/10 text-teal-400' :
                      ch.streamType === 'mpegts' ? 'bg-purple-500/10 text-purple-400' :
                      ch.streamType === 'github_m3u' ? 'bg-cyan-500/10 text-cyan-400' :
                      ch.streamType === 'fifalive' ? 'bg-red-500/10 text-red-400' :
                      ch.streamType === 'iframe_direct' ? 'bg-slate-500/10 text-slate-400' :
                      ch.streamType === 'dash' ? 'bg-rose-500/10 text-rose-400' :
                      'bg-orange-500/10 text-orange-400'
                    }`}>
                      {ch.streamType}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stream fields */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2">
        <Input
          placeholder="Stream name"
          value={stream.name}
          onChange={(e) => onUpdate({ ...stream, name: e.target.value })}
          className="h-8 text-xs"
        />
        <select
          value={stream.type}
          onChange={(e) => onUpdate({ ...stream, type: e.target.value as StreamForm['type'] })}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs sm:min-w-[100px]"
        >
          <option value="m3u">M3U8 Auto Fallback</option>
          <option value="m3u8_direct">🎯 Direct HLS</option>
          <option value="m3u8_proxy">🛡️ Proxy HLS</option>
          <option value="m3u8_jw">M3U8 JW Player</option>
          <option value="github_m3u">GitHub M3U</option>
          <option value="fifalive">🔴 FifaLive (auto token)</option>
          <option value="iframe">iFrame</option>
          <option value="iframe_direct">iFrame Direct</option>
          <option value="mpegts">MPEG-TS (.ts)</option>
          <option value="dash">DASH (.mpd)</option>
          <option value="direct">Direct (legacy)</option>
          <option value="redirect">Redirect</option>
        </select>
        <Input
          placeholder="Stream URL"
          value={stream.url}
          onChange={(e) => onUpdate({ ...stream, url: e.target.value })}
          className="h-8 text-xs"
        />
      </div>
      </div>{/* end flex-1 min-w-0 */}
    </div>
  )
}

// ─── Section Divider ───
function FormSection({ icon, title, description, children, badge }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
          <div>
            <h4 className="text-xs font-bold leading-tight">{title}</h4>
            {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </div>
        {badge}
      </div>
      <div className="pl-9">
        {children}
      </div>
    </div>
  )
}

// ─── Match Preview Card ───
function MatchPreview({ teamA, teamALogo, teamB, teamBLogo, league, sport, startTime, status }: {
  teamA: string; teamALogo: string; teamB: string; teamBLogo: string
  league: string; sport: string; startTime: string; status: string
}) {
  const sportIcon = sport === 'cricket' ? '🏏' : '⚽'
  const formatTime = (d: string) => {
    if (!d) return 'Not set'
    // d is a datetime-local value — show it as-is since it's already in admin timezone
    try {
      const date = new Date(d)
      return date.toLocaleString('en-US', {
        timeZone: ADMIN_TIMEZONE,
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    } catch {
      return d
    }
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 p-4">
      <div className="text-center mb-3">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
          Match Preview
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        {/* Team A */}
        <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <TeamLogo logo={teamALogo} name={teamA || '?'} size="md" />
          <span className="text-sm font-bold text-center truncate w-full">{teamA || 'Team A'}</span>
        </div>
        {/* VS */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <span className="text-lg font-black text-muted-foreground">VS</span>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
            {sportIcon} {sport || 'football'}
          </Badge>
        </div>
        {/* Team B */}
        <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <TeamLogo logo={teamBLogo} name={teamB || '?'} size="md" />
          <span className="text-sm font-bold text-center truncate w-full">{teamB || 'Team B'}</span>
        </div>
      </div>
      {(league || startTime) && (
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
          {league && <span>{league}</span>}
          {league && startTime && <span>•</span>}
          {startTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatTime(startTime)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Admin Matches Page ───
export function AdminMatches() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSport, setFilterSport] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [sportType, setSportType] = useState('football')
  const [league, setLeague] = useState('')
  const [teamAName, setTeamAName] = useState('')
  const [teamALogo, setTeamALogo] = useState('')
  const [teamBName, setTeamBName] = useState('')
  const [teamBLogo, setTeamBLogo] = useState('')
  const [startTime, setStartTime] = useState(() => utcToAdminLocal(new Date().toISOString()))
  const [endTime, setEndTime] = useState('')
  const [endTimeManuallySet, setEndTimeManuallySet] = useState(false) // Track if user manually edited endTime
  const [status, setStatus] = useState('upcoming')
  const [featured, setFeatured] = useState(false)
  const [streams, setStreams] = useState<StreamForm[]>([
    { name: 'Stream 1', channel: '', channelId: '', type: 'iframe', url: '' }
  ])

  // Channels for stream selection
  const [allChannels, setAllChannels] = useState<Channel[]>([])

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Live viewer counts per match. Refreshed every 5s by polling
  // /api/admin/live-viewers. REAL counts only (no demo data) — a match
  // shows 0 if no one is currently watching it.
  const [matchViewers, setMatchViewers] = useState<Record<string, number>>({})

  // Ref for scrolling to form on edit
  const formRef = useRef<HTMLDivElement>(null)

  // Filter channels by sport type
  // Categories are comma-separated strings like "sports,cricket", "sports,football", "sports"
  const sportFilteredChannels = allChannels.filter(ch => {
    const cats = ch.category.split(',').map(c => c.trim().toLowerCase())
    if (sportType === 'football') {
      return cats.includes('football') || cats.includes('sports')
    }
    if (sportType === 'cricket') {
      return cats.includes('cricket') || cats.includes('sports')
    }
    // For other sport types, include channels that match the sport or are general sports
    return cats.includes(sportType) || cats.includes('sports')
  })

  // Sort matches: live first, then upcoming, then ended.
  // Within "live" / "upcoming": earliest startTime first (soonest match at top).
  // Within "ended": most recently ended first (use endTime DESC; fall back to
  // startTime DESC when endTime is null, e.g. admin manually set status).
  // Rationale: admins care about recently-ended matches first — to review,
  // edit scores, or convert to VOD — so they should appear at the top of the
  // Ended section, not at the bottom.
  const sortMatches = (data: Match[]): Match[] => {
    const statusPriority: Record<string, number> = { live: 0, upcoming: 1, ended: 2 }
    return [...data].sort((a, b) => {
      const aPriority = statusPriority[a.status] ?? 9
      const bPriority = statusPriority[b.status] ?? 9
      if (aPriority !== bPriority) return aPriority - bPriority

      // Inside the ended group → most recently ended first
      if (a.status === 'ended' && b.status === 'ended') {
        const aEnd = a.endTime ? new Date(a.endTime).getTime() : new Date(a.startTime).getTime()
        const bEnd = b.endTime ? new Date(b.endTime).getTime() : new Date(b.startTime).getTime()
        return bEnd - aEnd // DESC
      }

      // Default for live/upcoming → earliest startTime first (ASC)
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    })
  }

  const loadMatches = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchMatches({
        ...(filterSport !== 'all' ? { sport: filterSport } : {}),
        ...(filterStatus !== 'all' ? { status: filterStatus } : {}),
      })
      setMatches(sortMatches(data))
    } catch {
      toast.error('Error', { description: 'Failed to load matches' })
    } finally {
      setLoading(false)
    }
  }, [filterSport, filterStatus])

  const loadChannels = useCallback(async () => {
    try {
      const data = await fetchChannels({ includeInactive: true })
      setAllChannels(data)
    } catch {
      // Channels loading failure is non-critical
    }
  }, [])

  useEffect(() => {
    loadMatches()
  }, [loadMatches])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Poll /api/admin/live-viewers every 5s to keep the "Live" column as close
  // to real-time as possible. Sends the current list of match ids so the
  // server can return counts for exactly those matches (no demo data — a
  // match with no viewers shows 0). The poll stops when the component
  // unmounts (admin navigates away from the matches tab).
  useEffect(() => {
    if (matches.length === 0) return
    const controller = new AbortController()

    const fetchLiveViewers = async () => {
      try {
        const res = await fetch('/api/admin/live-viewers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchIds: matches.map((m) => m.id) }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        if (data && typeof data.matchViewers === 'object') {
          setMatchViewers(data.matchViewers)
        }
      } catch {
        // Silent — analytics must never break the admin panel.
      }
    }

    fetchLiveViewers()
    const timer = setInterval(fetchLiveViewers, 5_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [matches])

  // Auto-sync match statuses every 60 seconds
  const handleSyncStatuses = useCallback(async (silent = false) => {
    try {
      const result = await syncMatchStatuses()
      if (!silent && result.totalUpdated > 0) {
        toast.success('Statuses Synced', { description: `${result.updatedToLive} → Live, ${result.updatedToEnded} → Ended` })
      }
      if (result.totalUpdated > 0) {
        loadMatches()
      }
    } catch {
      if (!silent) toast.error('Sync Failed', { description: 'Could not sync match statuses' })
    }
  }, [loadMatches])

  // Auto-sync on mount and periodically
  useEffect(() => {
    handleSyncStatuses(true) // silent on mount
    const interval = setInterval(() => handleSyncStatuses(true), 60000) // every 60s
    return () => clearInterval(interval)
  }, [handleSyncStatuses])

  // Auto-set endTime to 3 hours after startTime (only if user hasn't manually set endTime)
  useEffect(() => {
    if (endTimeManuallySet || !startTime) return
    // Parse the startTime datetime-local value as a Date
    const startDate = new Date(startTime)
    if (isNaN(startDate.getTime())) return
    // Add 3 hours
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)
    // Format as datetime-local string (YYYY-MM-DDTHH:mm)
    const y = endDate.getFullYear()
    const m = String(endDate.getMonth() + 1).padStart(2, '0')
    const d = String(endDate.getDate()).padStart(2, '0')
    const h = String(endDate.getHours()).padStart(2, '0')
    const min = String(endDate.getMinutes()).padStart(2, '0')
    const endTimeValue = `${y}-${m}-${d}T${h}:${min}`
    setEndTime(endTimeValue)
  }, [startTime, endTimeManuallySet])

  const resetForm = () => {
    setSportType('football')
    setLeague('')
    setTeamAName('')
    setTeamALogo('')
    setTeamBName('')
    setTeamBLogo('')
    // Auto-select today's date in admin timezone
    setStartTime(utcToAdminLocal(new Date().toISOString()))
    setEndTime('')
    setEndTimeManuallySet(false)
    setStatus('upcoming')
    setFeatured(false)
    setStreams([{ name: 'Stream 1', channel: '', channelId: '', type: 'iframe', url: '' }])
  }

  const handleEdit = (match: Match) => {
    setEditingId(match.id)
    setSportType(match.sport)
    setLeague(match.league)
    setTeamAName(match.teamA)
    setTeamALogo(match.teamALogo)
    setTeamBName(match.teamB)
    setTeamBLogo(match.teamBLogo)
    setStartTime(utcToAdminLocal(match.startTime))
    setEndTime(match.endTime ? utcToAdminLocal(match.endTime) : '')
    setEndTimeManuallySet(!!match.endTime) // If match has endTime, consider it manually set
    setStatus(match.status)
    setFeatured(match.isFeatured)
    setStreams(match.streams.map(s => ({
      name: s.name,
      channel: s.channel,
      channelId: '',
      type: s.type as StreamForm['type'],
      url: s.url,
    })))
    setShowForm(true)
    // Scroll to form after a short delay to allow state to render
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const handleSave = async () => {
    if (!teamAName.trim() || !teamBName.trim()) {
      toast.error('Validation Error', { description: 'Both team names are required' })
      return
    }
    if (!startTime) {
      toast.error('Validation Error', { description: 'Start time is required' })
      return
    }

    setSaving(true)
    try {
      const data = {
        sport: sportType,
        teamA: teamAName,
        teamALogo,
        teamB: teamBName,
        teamBLogo,
        league,
        startTime: adminLocalToUTC(startTime),
        endTime: endTime ? adminLocalToUTC(endTime) : undefined,
        status,
        isFeatured: featured,
        streams: streams.map(s => ({
          name: s.name || 'Stream 1',
          channel: s.channel,
          type: s.type,
          url: s.url,
        })),
      }

      if (editingId) {
        await updateMatch(editingId, data)
        toast.success('Match Updated', { description: `${teamAName} vs ${teamBName} updated successfully` })
      } else {
        await createMatch(data)
        toast.success('Match Created', { description: `${teamAName} vs ${teamBName} created successfully` })
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadMatches()
    } catch {
      toast.error('Error', { description: 'Failed to save match' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMatch(id)
      toast.success('Match Deleted', { description: 'Match has been removed' })
      setDeleteConfirm(null)
      loadMatches()
    } catch {
      toast.error('Error', { description: 'Failed to delete match' })
    }
  }

  const handleQuickStatus = async (match: Match, newStatus: string) => {
    try {
      await updateMatch(match.id, { status: newStatus })
      toast.success('Status Updated', { description: `Match is now ${newStatus}` })
      loadMatches()
    } catch {
      toast.error('Error', { description: 'Failed to update status' })
    }
  }

  const addStream = () => {
    setStreams([...streams, { name: `Stream ${streams.length + 1}`, channel: '', channelId: '', type: 'iframe', url: '' }])
  }

  const updateStream = (index: number, updated: StreamForm) => {
    const newStreams = [...streams]
    newStreams[index] = updated
    setStreams(newStreams)
  }

  const removeStream = (index: number) => {
    if (streams.length > 1) {
      setStreams(streams.filter((_, i) => i !== index))
    }
  }

  const moveStream = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= streams.length) return
    const newStreams = [...streams]
    const [moved] = newStreams.splice(fromIndex, 1)
    newStreams.splice(toIndex, 0, moved)
    setStreams(newStreams)
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select
            value={filterSport}
            onChange={(e) => setFilterSport(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="all">All Sports</option>
            <option value="cricket">🏏 Cricket</option>
            <option value="football">⚽ Football</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="all">All Status</option>
            <option value="live">🔴 Live</option>
            <option value="upcoming">🕐 Upcoming</option>
            <option value="ended">✅ Ended</option>
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSyncStatuses(false)}
            className="gap-1.5 btn-press h-9"
            title="Auto-sync match statuses based on time"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sync</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadMatches}
            className="gap-1.5 btn-press h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              resetForm()
              setShowForm(!showForm)
            }}
            className="gap-1.5 btn-press text-xs h-9"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Match
          </Button>
        </div>
      </div>

      {/* Add/Edit Match Form */}
      {showForm && (
        <div ref={formRef} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden animate-fade-slide scroll-mt-4">
          {/* Form Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Trophy className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-xs font-bold">{editingId ? 'Edit Match' : 'Add New Match'}</h3>
                <p className="text-[10px] text-muted-foreground">Fill in the details — preview updates live</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowForm(false); setEditingId(null); resetForm() }}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Form Body */}
          <div className="p-5 space-y-5">

            {/* ── Match Preview ── */}
            <MatchPreview
              teamA={teamAName}
              teamALogo={teamALogo}
              teamB={teamBName}
              teamBLogo={teamBLogo}
              league={league}
              sport={sportType}
              startTime={startTime}
              status={status}
            />

            {/* ── Sport & League ── */}
            <FormSection
              icon={<Radio className="h-3.5 w-3.5" />}
              title="Sport & League"
              description="Choose the sport type and competition name"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Sport Type</label>
                  <div className="flex gap-1.5">
                    {[
                      { value: 'football', emoji: '⚽', label: 'Football' },
                      { value: 'cricket', emoji: '🏏', label: 'Cricket' },
                    ].map((sport) => (
                      <button
                        key={sport.value}
                        type="button"
                        onClick={() => {
                          setSportType(sport.value)
                          setTeamAName('')
                          setTeamALogo('')
                          setTeamBName('')
                          setTeamBLogo('')
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border transition-all ${
                          sportType === sport.value
                            ? 'bg-primary/10 text-primary border-primary/30 shadow-sm'
                            : 'bg-secondary/30 text-muted-foreground border-transparent hover:border-border'
                        }`}
                      >
                        <span className="text-base">{sport.emoji}</span>
                        {sport.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">League / Competition</label>
                  <Input
                    value={league}
                    onChange={(e) => setLeague(e.target.value)}
                    placeholder="e.g. Premier League, ICC World Cup"
                    className="h-10"
                  />
                </div>
              </div>
            </FormSection>

            {/* ── Teams ── */}
            <FormSection
              icon={<Users className="h-3.5 w-3.5" />}
              title="Teams"
              description="Search and select teams — logos will auto-fill"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TeamInput
                  label="Team A (Home)"
                  value={teamAName}
                  logo={teamALogo}
                  sport={sportType}
                  onNameChange={setTeamAName}
                  onLogoChange={setTeamALogo}
                />
                <TeamInput
                  label="Team B (Away)"
                  value={teamBName}
                  logo={teamBLogo}
                  sport={sportType}
                  onNameChange={setTeamBName}
                  onLogoChange={setTeamBLogo}
                />
              </div>
            </FormSection>

            {/* ── Schedule & Status ── */}
            <FormSection
              icon={<Calendar className="h-3.5 w-3.5" />}
              title="Schedule & Status"
              description={`All times in Bangladesh timezone (BST, ${getAdminOffset()}) — displayed in user's local timezone on home page`}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DateTimePicker
                  value={startTime}
                  onChange={setStartTime}
                  label="Start Time *"
                  timeZoneLabel={`BST (${getAdminOffset()})`}
                />
                <div className="space-y-2">
                  <DateTimePicker
                    value={endTime}
                    onChange={(val) => { setEndTime(val); setEndTimeManuallySet(true) }}
                    label="End Time"
                    timeZoneLabel="BST"
                  />
                  <p className="text-[10px] text-muted-foreground">Auto-set to 3 hours after start time. Edit to customize.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Status</label>
                  <div className="flex gap-1.5">
                    {(['upcoming', 'live', 'ended'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatus(s)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                          status === s
                            ? s === 'live'
                              ? 'bg-red-500/15 text-red-500 dark:text-red-400 border-red-500/30 shadow-sm'
                              : s === 'upcoming'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 shadow-sm'
                              : 'bg-secondary text-muted-foreground border-border shadow-sm'
                            : 'bg-secondary/30 text-muted-foreground border-transparent hover:border-border'
                        }`}
                      >
                        {s === 'live' ? '🔴' : s === 'upcoming' ? '🕐' : '✅'}
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={featured}
                      onCheckedChange={setFeatured}
                    />
                    <label className="text-xs font-medium flex items-center gap-1">
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                      Featured Match
                    </label>
                  </div>
                </div>
              </div>
            </FormSection>

            {/* ── Streams ── */}
            <FormSection
              icon={<Tv className="h-3.5 w-3.5" />}
              title="Streams"
              description="Add streaming sources — pick from channels or add custom URLs"
              badge={
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  {streams.length} {streams.length === 1 ? 'stream' : 'streams'}
                </Badge>
              }
            >
              <div className="space-y-2">
                {streams.map((stream, index) => (
                  <StreamInput
                    key={`stream-${index}-${streams.length}`}
                    stream={stream}
                    index={index}
                    onUpdate={(s) => updateStream(index, s)}
                    onRemove={() => removeStream(index)}
                    onMoveUp={() => moveStream(index, index - 1)}
                    onMoveDown={() => moveStream(index, index + 1)}
                    channels={sportFilteredChannels}
                    isFirst={index === 0}
                    isLast={index === streams.length - 1}
                  />
                ))}
                <Button
                  variant="dashed"
                  size="sm"
                  onClick={addStream}
                  className="w-full h-9 text-xs gap-1.5 border-dashed border-2 hover:border-primary/50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Another Stream
                </Button>
              </div>
            </FormSection>
          </div>

          {/* Form Footer */}
          <div className="flex gap-2 justify-end px-5 py-3 border-t border-border bg-secondary/20">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingId(null); resetForm() }} className="gap-1.5 text-xs">
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="btn-press gap-2 min-w-[140px] text-xs">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? 'Saving...' : editingId ? 'Update Match' : 'Create Match'}
            </Button>
          </div>
        </div>
      )}

      {/* Matches Table */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading matches...</p>
        </div>
      ) : matches.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold mb-1">No matches found</h3>
          <p className="text-xs text-muted-foreground">Add your first match to get started.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Match</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sport</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">League</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Start Time <span className="text-emerald-500">(BST)</span></th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Streams</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match, idx) => {
                  // Add section header when status group changes
                  const prevMatch = idx > 0 ? matches[idx - 1] : null
                  const showSectionHeader = !prevMatch || prevMatch.status !== match.status
                  const statusPriority: Record<string, number> = { live: 0, upcoming: 1, ended: 2 }
                  const sectionInfo: Record<string, { label: string; icon: string; className: string; count: number }> = {}
                  // Count matches per status
                  matches.forEach(m => {
                    if (!sectionInfo[m.status]) {
                      const info = m.status === 'live'
                        ? { label: 'Live Matches', icon: '🔴', className: 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20' }
                        : m.status === 'upcoming'
                        ? { label: 'Upcoming Matches', icon: '🕐', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' }
                        : { label: 'Ended Matches', icon: '✅', className: 'bg-secondary text-muted-foreground border-border' }
                      sectionInfo[m.status] = { ...info, count: 0 }
                    }
                    sectionInfo[m.status].count++
                  })

                  return (
                    <Fragment key={match.id}>
                      {showSectionHeader && sectionInfo[match.status] && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <div className={`flex items-center gap-2 px-3 py-2 border-t border-b ${sectionInfo[match.status].className} text-xs font-bold uppercase tracking-wider`}>
                              <span>{sectionInfo[match.status].icon}</span>
                              <span>{sectionInfo[match.status].label}</span>
                              <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{sectionInfo[match.status].count}</Badge>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-1.5">
                        <TeamLogo logo={match.teamALogo} name={match.teamA} size="xs" />
                        <span className="font-medium">{match.teamA}</span>
                        <span className="text-muted-foreground text-[10px] font-bold mx-0.5">VS</span>
                        <span className="font-medium">{match.teamB}</span>
                        <TeamLogo logo={match.teamBLogo} name={match.teamB} size="xs" />
                        {match.isFeatured && <Star className="h-3 w-3 text-amber-500 fill-amber-500 ml-1" />}
                      </div>
                    </td>
                    <td className="p-3 text-sm capitalize">
                      {match.sport === 'cricket' ? '🏏' : '⚽'} {match.sport}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{match.league || '—'}</td>
                    <td className="p-3 text-sm">
                      <Badge
                        className={`text-[10px] h-5 px-2 rounded-full font-medium ${
                          match.status === 'live'
                            ? 'bg-red-500/15 text-red-500 dark:text-red-400 animate-live-pulse'
                            : match.status === 'upcoming'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {match.status === 'live' ? '● Live' : match.status === 'upcoming' ? 'Upcoming' : 'Ended'}
                      </Badge>
                    </td>
                    <td className="p-3 text-sm">
                      <div
                        className={`flex items-center gap-1 text-xs ${
                          (matchViewers[match.id] || 0) > 0
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-muted-foreground'
                        }`}
                        title="Real-time viewers watching this match right now"
                      >
                        <Users className="h-3 w-3" />
                        {(matchViewers[match.id] || 0).toLocaleString()}
                        {(matchViewers[match.id] || 0) > 0 && (
                          <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatAdminTime(match.startTime)}
                    </td>
                    <td className="p-3 text-sm">
                      <Badge variant="secondary" className="text-xs">{match.streams.length}</Badge>
                    </td>
                    <td className="p-3 text-sm text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {match.status === 'upcoming' && (
                          <button
                            onClick={() => handleQuickStatus(match, 'live')}
                            className="px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors btn-press"
                            title="Start match"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                        )}
                        {match.status === 'live' && (
                          <button
                            onClick={() => handleQuickStatus(match, 'ended')}
                            className="px-2 py-1 rounded-md bg-secondary text-muted-foreground text-xs hover:bg-secondary/80 transition-colors btn-press"
                            title="End match"
                          >
                            End
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(match)}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press"
                          title="Edit match"
                        >
                          <Edit className="h-3.5 w-3.5 text-primary" />
                        </button>
                        {deleteConfirm === match.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDelete(match.id)}
                              className="px-2 py-1 rounded-md bg-destructive text-destructive-foreground text-xs btn-press"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 rounded-md bg-secondary text-xs btn-press"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(match.id)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors btn-press"
                            title="Delete match"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border text-xs text-muted-foreground text-center">
            Showing {matches.length} match{matches.length !== 1 ? 'es' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function Star({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}
