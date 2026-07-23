'use client'

import { useState, useEffect } from 'react'
import { Tv, Trophy, Eye, Heart, Radio, Clock, TrendingUp, Plus, Database, RefreshCw, ArrowRight, Users, Wifi, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/store'
import { fetchChannels, fetchMatches, fetchCategories, type Channel, type Match, type Category } from '@/lib/api'
import { toast } from 'sonner'

export function AdminDashboard() {
  const { setAdminPage } = useAppStore()
  const [channels, setChannels] = useState<Channel[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [onlineNow, setOnlineNow] = useState<number>(0)
  const [todayViews, setTodayViews] = useState<number>(0)
  const [todayVisitors, setTodayVisitors] = useState<number>(0)

  const loadData = async () => {
    try {
      setLoading(true)
      const [ch, mt, ct] = await Promise.all([
        fetchChannels({ category: '', includeInactive: true }).catch(() => [] as Channel[]),
        fetchMatches().catch(() => [] as Match[]),
        fetchCategories().catch(() => [] as Category[]),
      ])
      setChannels(ch)
      setMatches(mt)
      setCategories(ct)
      // Load real analytics data (requires admin auth cookie)
      fetch('/api/analytics/dashboard')
        .then(r => {
          if (!r.ok) throw new Error(`Analytics API returned ${r.status}`)
          return r.json()
        })
        .then(data => {
          if (data.today) {
            setTodayViews(data.today.views || 0)
            setTodayVisitors(data.today.uniqueVisitors || 0)
          }
          setOnlineNow(data.onlineNow || 0)
        })
        .catch((err) => {
          console.warn('[Dashboard] Failed to load analytics:', err.message)
        })
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const liveMatches = matches.filter(m => m.status === 'live')
  const upcomingMatches = matches.filter(m => m.status === 'upcoming')
  const totalViews = channels.reduce((acc, ch) => acc + ch.viewCount, 0)
  const favCount = (() => {
    if (typeof window === 'undefined') return 0
    try {
      return JSON.parse(localStorage.getItem('zeng-favorites') || '[]').length
    } catch { return 0 }
  })()

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast.success('Database Seeded', { description: `Created ${data.categories} categories, ${data.channels} channels, ${data.matches} matches` })
        await loadData()
      } else {
        toast.error('Failed to seed', { description: data.error || 'Unknown error' })
      }
    } catch {
      toast.error('Failed to seed database')
    } finally {
      setSeeding(false)
    }
  }

  const stats: Array<{ icon: typeof Tv; label: string; value: string | number; color: string; bgColor: string; iconBg: string; pulse?: boolean }> = [
    { icon: Wifi, label: 'Online Now', value: onlineNow, color: 'text-emerald-600', bgColor: 'bg-emerald-500/10', iconBg: 'bg-emerald-500/15', pulse: onlineNow > 0 },
    { icon: Eye, label: "Today's Views", value: todayViews.toLocaleString(), color: 'text-teal-600', bgColor: 'bg-teal-500/10', iconBg: 'bg-teal-500/15' },
    { icon: Users, label: "Today's Visitors", value: todayVisitors.toLocaleString(), color: 'text-violet-600', bgColor: 'bg-violet-500/10', iconBg: 'bg-violet-500/15' },
    { icon: Tv, label: 'Total Channels', value: channels.length, color: 'text-amber-600', bgColor: 'bg-amber-500/10', iconBg: 'bg-amber-500/15' },
  ]

  const quickActions = [
    { label: 'Analytics', icon: BarChart3, page: 'analytics' as const, color: 'text-teal-600', bg: 'bg-teal-500/10' },
    { label: 'Add Channel', icon: Plus, page: 'channels' as const, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
    { label: 'Add Match', icon: Trophy, page: 'matches' as const, color: 'text-amber-600', bg: 'bg-amber-500/10' },
    { label: 'Manage Categories', icon: Database, page: 'categories' as const, color: 'text-violet-600', bg: 'bg-violet-500/10' },
  ]

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Overview of your GenZ TV platform</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="bg-card rounded-xl border border-border shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className={`p-2.5 rounded-xl ${stat.iconBg} ${stat.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold tracking-tight">{loading ? '—' : stat.value}</p>
                    {stat.pulse && (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Actions + Overview Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Quick Actions Card */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.label}
                  onClick={() => setAdminPage(action.page)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-secondary/50 transition-all btn-press"
                >
                  <div className={`p-2 rounded-lg ${action.bg} ${action.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-[11px] font-medium text-center">{action.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Today's Overview Card */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Today&apos;s Overview
          </h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
                <Wifi className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{onlineNow}</p>
                <p className="text-xs text-muted-foreground">Online now</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-600">
                <Eye className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{todayViews.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Page views</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Categories</span>
          </div>
          <div className="space-y-2">
            {categories.slice(0, 6).map(cat => (
              <div key={cat.id} className="flex items-center justify-between text-xs">
                <span>{cat.icon} {cat.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                  {channels.filter(ch => ch.category === cat.name.toLowerCase()).length}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="h-4 w-4 text-red-500" />
            <span className="text-sm font-semibold">Live Matches</span>
          </div>
          {liveMatches.length === 0 ? (
            <p className="text-xs text-muted-foreground">No live matches right now</p>
          ) : (
            <div className="space-y-2">
              {liveMatches.map(match => (
                <div key={match.id} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1">{match.teamA} vs {match.teamB}</span>
                  <Badge className="bg-red-500/20 text-red-400 text-[10px] px-1.5 h-4 animate-live-pulse">LIVE</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Upcoming</span>
          </div>
          {upcomingMatches.length === 0 ? (
            <p className="text-xs text-muted-foreground">No upcoming matches</p>
          ) : (
            <div className="space-y-2">
              {upcomingMatches.slice(0, 4).map(match => (
                <div key={match.id} className="flex items-center justify-between text-xs">
                  <span className="truncate flex-1">{match.teamA} vs {match.teamB}</span>
                  <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 h-4">
                    {new Date(match.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Matches Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-sm font-semibold">Recent Matches</h3>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              className="gap-1.5 btn-press text-xs h-7"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setAdminPage('matches')}
              className="gap-1.5 btn-press text-xs h-7"
            >
              View All
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
        ) : matches.length === 0 ? (
          <div className="p-8 text-center">
            <Trophy className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-3">No matches found. Add matches from the Matches section.</p>
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding} className="gap-1.5">
              <Database className="h-3.5 w-3.5" />
              {seeding ? 'Seeding...' : 'Seed Demo Data'}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Match</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sport</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">League</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Start Time</th>
                </tr>
              </thead>
              <tbody>
                {matches.slice(0, 8).map((match) => (
                  <tr key={match.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-1.5">
                        {match.teamALogo && match.teamALogo.startsWith('http') ? (
                          <img src={match.teamALogo} alt={match.teamA} className="w-5 h-5 object-contain rounded-full" />
                        ) : match.teamALogo ? (
                          <span className="text-base leading-none">{match.teamALogo}</span>
                        ) : null}
                        <span className="truncate">{match.teamA}</span>
                        <span className="text-muted-foreground text-[10px] font-bold mx-0.5">vs</span>
                        {match.teamBLogo && match.teamBLogo.startsWith('http') ? (
                          <img src={match.teamBLogo} alt={match.teamB} className="w-5 h-5 object-contain rounded-full" />
                        ) : match.teamBLogo ? (
                          <span className="text-base leading-none">{match.teamBLogo}</span>
                        ) : null}
                        <span className="truncate">{match.teamB}</span>
                      </div>
                    </td>
                    <td className="p-3 text-sm capitalize">{match.sport === 'cricket' ? '🏏' : '⚽'} {match.sport}</td>
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
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(match.startTime).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Seed Data Button (shown when no data) */}
      {channels.length === 0 && !loading && (
        <div className="text-center pt-2">
          <Button onClick={handleSeed} disabled={seeding} className="gap-2 btn-press">
            <Database className="h-4 w-4" />
            {seeding ? 'Seeding Demo Data...' : 'Seed Demo Data'}
          </Button>
        </div>
      )}
    </div>
  )
}
