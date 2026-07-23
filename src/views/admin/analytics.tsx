'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Eye,
  Users,
  Globe,
  Activity,
  TrendingUp,
  TrendingDown,
  Wifi,
  Clock,
  BarChart3,
  Tv,
  Smartphone,
  Monitor,
  RefreshCw,
  Loader2,
  Flame,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

// --- Types ---

interface DayStat {
  views: number
  uniqueVisitors: number
  peakVisitors: number
  topPages: Record<string, number>
  topChannels: Record<string, number>
  topCountries: Record<string, number>
  topDevices: Record<string, number>
  topBrowsers: Record<string, number>
}

interface DailyChartPoint {
  date: string
  views: number
  uniqueVisitors: number
  peakVisitors: number
}

interface TopChannelAllTime {
  id: string
  name: string
  views: number
}

interface TopDeviceAllTime {
  device: string
  count: number
}

interface TopBrowserAllTime {
  browser: string
  count: number
}

interface RecentPageView {
  page: string
  channelId: string | null
  createdAt: string
  country: string
  device: string
  browser: string
}

interface CalendarDay {
  date: string
  views: number
  uniqueVisitors: number
  peakVisitors: number
}

interface AnalyticsData {
  today: DayStat
  yesterday: DayStat
  last7Days: { views: number; uniqueVisitors: number; days: { date: string; views: number; uniqueVisitors: number }[] }
  last30Days: { views: number; uniqueVisitors: number; days: { date: string; views: number; uniqueVisitors: number }[] }
  totalAllTime: { views: number; uniqueVisitors: number }
  dailyChart: DailyChartPoint[]
  topChannelsAllTime: TopChannelAllTime[]
  topCountriesAllTime: { country: string; count: number }[]
  topDevicesAllTime: TopDeviceAllTime[]
  topBrowsersAllTime: TopBrowserAllTime[]
  onlineNow: number
  recentPageViews: RecentPageView[]
  calendar: { year: number; month: number; days: CalendarDay[] }
}

// --- Helpers ---

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function viewsChangePercent(today: number, yesterday: number): number | null {
  if (yesterday === 0) return today > 0 ? null : null
  return Math.round(((today - yesterday) / yesterday) * 100)
}

const DEVICE_META: Record<string, { icon: typeof Tv; label: string; color: string }> = {
  tv: { icon: Tv, label: 'TV', color: 'text-violet-500' },
  mobile: { icon: Smartphone, label: 'Mobile', color: 'text-emerald-500' },
  desktop: { icon: Monitor, label: 'Desktop', color: 'text-sky-500' },
}

const BROWSER_COLORS: Record<string, string> = {
  Chrome: '#4285F4',
  Firefox: '#FF7139',
  Safari: '#1B88CA',
  Edge: '#0C8CE0',
  Opera: '#FF1B2D',
  'Samsung Internet': '#8642C8',
  Other: '#6b7280',
}

function browserColor(name: string): string {
  return BROWSER_COLORS[name] || '#6b7280'
}

// --- Custom chart tooltip ---

interface TooltipPayloadItem {
  dataKey: string
  value: number
  color: string
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur px-3 py-2 shadow-xl">
      <p className="text-[11px] font-semibold text-foreground mb-1.5">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground capitalize">{item.dataKey.replace(/([A-Z])/g, ' $1').trim()}:</span>
            <span className="font-semibold tabular-nums text-foreground">{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Component ---

const REFRESH_INTERVAL_MS = 3000 // auto-refresh every 3 seconds (per user request)

export function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const fetchData = useCallback(async (showRefreshSpinner = false, month?: string) => {
    try {
      if (showRefreshSpinner) setRefreshing(true)
      setError(null)

      const url = month ? `/api/analytics/dashboard?month=${month}` : '/api/analytics/dashboard'
      const res = await fetch(url)
      if (res.status === 401) {
        throw new Error('Authentication required — please log in again')
      }
      if (res.status === 503) {
        throw new Error('Analytics system is initializing — please wait a moment and retry')
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        const detail = errorData.detail || errorData.error || ''
        throw new Error(`Failed to fetch analytics (${res.status})${detail ? ': ' + detail : ''}`)
      }
      const json = await res.json()
      setData(json)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-refresh every 3 seconds — silent (no spinner) so the UI stays calm.
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchData(false)
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchData])

  // --- Loading state ---
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading analytics...</p>
      </div>
    )
  }

  // --- Error state ---
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <Activity className="h-10 w-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  // --- Derived values ---
  const todayViewsChange = viewsChangePercent(data.today.views, data.yesterday.views)
  const maxChartViews = Math.max(...data.dailyChart.map((d) => d.views), 1)
  const maxChartPeak = Math.max(...data.dailyChart.map((d) => d.peakVisitors), 1)

  // Top pages sorted desc
  const topPages = Object.entries(data.today.topPages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
  const topPagesMax = topPages.length > 0 ? topPages[0][1] : 1

  // Top channels from today
  const topChannelsToday = Object.entries(data.today.topChannels)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)

  // Top countries from today (REAL geo data from visitor IPs)
  const topCountries = Object.entries(data.today.topCountries)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
  const topCountriesMax = topCountries.length > 0 ? topCountries[0][1] : 1

  // Top devices — all-time (accumulates a fuller picture of the audience)
  const topDevices = data.topDevicesAllTime
  const totalDeviceCount = topDevices.reduce((sum, d) => sum + d.count, 0) || 1

  // Top browsers — all-time
  const topBrowsers = data.topBrowsersAllTime
  const totalBrowserCount = topBrowsers.reduce((sum, b) => sum + b.count, 0) || 1

  // Recent activity (last 10)
  const recentActivity = data.recentPageViews.slice(0, 10)

  // Channel name map for topChannelsToday
  const channelNameMap = new Map(data.topChannelsAllTime.map((c) => [c.id, c.name]))

  return (
    <div className="space-y-6">
      {/* Page Title + Refresh + Live indicator */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            Analytics
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              LIVE
            </span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time traffic &amp; engagement insights
            {lastUpdated && (
              <span className="ml-2 text-xs">· updated {relativeTime(lastUpdated.toISOString())}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="gap-1.5 text-xs h-7"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ─── Top Stats Row ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Online Now */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5 group hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-300">
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-emerald-500/8 group-hover:scale-150 transition-transform duration-500" />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-2.5 rounded-xl bg-emerald-500/10">
              <Wifi className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-500" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums">{data.onlineNow}</p>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">Online Now</p>
            </div>
          </div>
        </div>

        {/* Today's Views */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5 group hover:shadow-lg hover:shadow-teal-500/5 transition-all duration-300">
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-teal-500/8 group-hover:scale-150 transition-transform duration-500" />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-2.5 rounded-xl bg-teal-500/10">
              <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-teal-500" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums">{formatNumber(data.today.views)}</p>
                {todayViewsChange !== null && (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold ${
                    todayViewsChange >= 0
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400'
                  }`}>
                    {todayViewsChange >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {todayViewsChange >= 0 ? '+' : ''}{todayViewsChange}%
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">Today&apos;s Views</p>
            </div>
          </div>
        </div>

        {/* Today's Visitors */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5 group hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300">
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-violet-500/8 group-hover:scale-150 transition-transform duration-500" />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-2.5 rounded-xl bg-violet-500/10">
              <Users className="h-4 w-4 sm:h-5 sm:w-5 text-violet-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums">{formatNumber(data.today.uniqueVisitors)}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">Today&apos;s Visitors</p>
            </div>
          </div>
        </div>

        {/* Today's Peak Concurrent Visitors (NEW — real max online today) */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5 group hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-300">
          <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-amber-500/8 group-hover:scale-150 transition-transform duration-500" />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-2.5 rounded-xl bg-amber-500/10">
              <Flame className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums">{data.today.peakVisitors}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">Today&apos;s Peak</p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Premium Chart: Daily Views + Peak Visitors (14 days) ─── */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Daily Views &amp; Peak Visitors (Last 14 Days)</h3>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-teal-600 to-emerald-400" />
              <span className="text-muted-foreground">Views</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">Peak Visitors</span>
            </span>
          </div>
        </div>
        {data.dailyChart.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No chart data available yet</p>
        ) : (
          <div className="w-full" style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data.dailyChart}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }} />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="views"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#viewsGradient)"
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="uniqueVisitors"
                  stroke="#14b8a6"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="url(#visitorsGradient)"
                  activeDot={{ r: 3, strokeWidth: 0 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="peakVisitors"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── Devices & Browsers row (NEW) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Devices */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Monitor className="h-4 w-4 text-sky-500" />
            <h3 className="text-sm font-semibold">Devices — All Time</h3>
          </div>
          {topDevices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No device data yet</p>
          ) : (
            <div className="space-y-3">
              {topDevices.map(({ device, count }) => {
                const meta = DEVICE_META[device] || { icon: Monitor, label: device || 'Unknown', color: 'text-muted-foreground' }
                const Icon = meta.icon
                const pct = Math.round((count / totalDeviceCount) * 100)
                return (
                  <div key={device} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium">
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                        {meta.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {count.toLocaleString()} <span className="text-muted-foreground/60">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Top Browsers */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold">Browsers — All Time</h3>
          </div>
          {topBrowsers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No browser data yet</p>
          ) : (
            <div className="space-y-3">
              {topBrowsers.map(({ browser, count }) => {
                const pct = Math.round((count / totalBrowserCount) * 100)
                const color = browserColor(browser)
                return (
                  <div key={browser} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                        {browser}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {count.toLocaleString()} <span className="text-muted-foreground/60">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Two-column layout ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column */}
        <div className="space-y-4">
          {/* Top Pages */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Eye className="h-4 w-4 text-teal-500" />
              <h3 className="text-sm font-semibold">Top Pages Today</h3>
            </div>
            {topPages.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No page view data yet</p>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto scrollbar-hide">
                {topPages.map(([page, count]) => (
                  <div key={page} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 mr-2 font-medium">{page}</span>
                      <span className="text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${(count / topPagesMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Channels Today */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Tv className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-semibold">Top Channels Today</h3>
            </div>
            {topChannelsToday.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No channel data yet</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-hide">
                {topChannelsToday.map(([channelId, count], i) => (
                  <div key={channelId} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-secondary/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-muted-foreground tabular-nums w-4 text-right">{i + 1}</span>
                      <span className="truncate font-medium">
                        {channelNameMap.get(channelId) || channelId}
                      </span>
                    </div>
                    <span className="text-muted-foreground tabular-nums ml-2">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Top Countries */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Top Countries Today</h3>
            </div>
            {topCountries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No country data yet</p>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto scrollbar-hide">
                {topCountries.map(([country, count]) => (
                  <div key={country} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{country}</span>
                      <span className="text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
                        style={{ width: `${(count / topCountriesMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity (enhanced with country/device/browser) */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Recent Activity</h3>
            </div>
            {recentActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No recent page views</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto scrollbar-hide">
                {recentActivity.map((pv, i) => (
                  <div
                    key={`${pv.createdAt}-${i}`}
                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-secondary/50 transition-colors gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {(() => {
                        const meta = DEVICE_META[pv.device]
                        const Icon = meta?.icon || Monitor
                        return <Icon className={`h-3 w-3 shrink-0 ${meta?.color || 'text-muted-foreground'}`} />
                      })()}
                      <span className="truncate flex-1">{pv.page}</span>
                      {pv.browser && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: browserColor(pv.browser) }}
                          title={pv.browser}
                        />
                      )}
                      {pv.country && (
                        <span className="text-[9px] text-muted-foreground/70 shrink-0 hidden sm:inline">{pv.country}</span>
                      )}
                    </div>
                    <span className="text-muted-foreground whitespace-nowrap shrink-0">{relativeTime(pv.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── 7-Day & 30-Day Summary Cards ─── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-teal-500" />
            <h3 className="text-sm font-semibold">Last 7 Days</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xl font-bold tracking-tight">{formatNumber(data.last7Days.views)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Views</p>
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">{formatNumber(data.last7Days.uniqueVisitors)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Unique Visitors</p>
            </div>
          </div>
          {/* Daily breakdown */}
          {data.last7Days.days.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5 max-h-32 overflow-y-auto scrollbar-hide">
              {data.last7Days.days.map(d => (
                <div key={d.date} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{formatShortDate(d.date)}</span>
                  <span className="tabular-nums">
                    <span className="font-medium">{d.views.toLocaleString()}</span>
                    <span className="text-muted-foreground ml-2">{d.uniqueVisitors.toLocaleString()} UV</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Last 30 Days</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xl font-bold tracking-tight">{formatNumber(data.last30Days.views)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Views</p>
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">{formatNumber(data.last30Days.uniqueVisitors)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Unique Visitors</p>
            </div>
          </div>
          {/* Daily breakdown */}
          {data.last30Days.days.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5 max-h-32 overflow-y-auto scrollbar-hide">
              {[...data.last30Days.days].reverse().slice(0, 7).map(d => (
                <div key={d.date} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{formatShortDate(d.date)}</span>
                  <span className="tabular-nums">
                    <span className="font-medium">{d.views.toLocaleString()}</span>
                    <span className="text-muted-foreground ml-2">{d.uniqueVisitors.toLocaleString()} UV</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Calendar Section ─── */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Daily Stats Calendar</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => {
                const [y, m] = calendarMonth.split('-').map(Number)
                const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
                setCalendarMonth(prev)
                fetchData(false, prev)
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {new Date(calendarMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => {
                const [y, m] = calendarMonth.split('-').map(Number)
                const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
                setCalendarMonth(next)
                fetchData(false, next)
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Calendar Grid */}
        {(() => {
          const calData = data.calendar
          const daysInMonth = new Date(calData.year, calData.month, 0).getDate()
          const firstDayOfWeek = new Date(calData.year, calData.month - 1, 1).getDay()
          const dayMap = new Map(calData.days.map(d => [d.date, d]))
          const todayStr = new Date().toISOString().slice(0, 10)
          const maxViews = Math.max(...calData.days.map(d => d.views), 1)

          const cells: React.ReactNode[] = []

          // Day headers
          const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          const headers = dayLabels.map(d => (
            <div key={d} className="text-[10px] font-semibold text-muted-foreground text-center py-1">
              {d}
            </div>
          ))

          // Empty cells before first day
          for (let i = 0; i < firstDayOfWeek; i++) {
            cells.push(<div key={`empty-${i}`} />)
          }

          // Day cells
          for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${calData.year}-${String(calData.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayData = dayMap.get(dateStr)
            const isToday = dateStr === todayStr
            const isFuture = new Date(dateStr) > new Date()
            const intensity = dayData ? Math.max(dayData.views / maxViews, 0) : 0

            cells.push(
              <div
                key={dateStr}
                className={`relative rounded-lg p-1.5 text-center transition-all duration-200 ${
                  isToday
                    ? 'ring-2 ring-primary bg-primary/5'
                    : isFuture
                    ? 'opacity-30'
                    : 'hover:bg-secondary/50'
                }`}
                title={dayData ? `${dateStr}: ${dayData.views.toLocaleString()} views, ${dayData.uniqueVisitors.toLocaleString()} visitors, peak ${dayData.peakVisitors}` : dateStr}
              >
                <div className="text-[10px] font-medium text-muted-foreground mb-0.5">{day}</div>
                {dayData && !isFuture && (
                  <>
                    <div className="text-[10px] font-bold tabular-nums leading-tight">
                      {dayData.views >= 1000 ? `${(dayData.views / 1000).toFixed(1)}K` : dayData.views}
                    </div>
                    <div className="text-[8px] text-muted-foreground tabular-nums leading-tight">
                      {dayData.uniqueVisitors >= 1000 ? `${(dayData.uniqueVisitors / 1000).toFixed(1)}K` : dayData.uniqueVisitors} UV
                    </div>
                    {/* Intensity bar */}
                    <div className="mt-1 h-0.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400"
                        style={{ width: `${Math.max(intensity * 100, 2)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          }

          return (
            <div className="grid grid-cols-7 gap-1">
              {headers}
              {cells}
            </div>
          )
        })()}
      </div>

      {/* ─── Top Channels All Time ─── */}
      {data.topChannelsAllTime.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Tv className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Top Channels — All Time</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.topChannelsAllTime.slice(0, 9).map((ch, i) => (
              <div
                key={ch.id}
                className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-secondary/30 hover:bg-secondary/60 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground tabular-nums w-4 text-right">{i + 1}</span>
                  <span className="truncate font-medium">{ch.name}</span>
                </div>
                <span className="text-muted-foreground tabular-nums ml-2">{formatNumber(ch.views)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Top Countries All Time ─── */}
      {data.topCountriesAllTime && data.topCountriesAllTime.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Top Countries — All Time</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {data.topCountriesAllTime.slice(0, 12).map(({ country, count }) => (
              <div key={country} className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-secondary/30">
                <span className="font-medium truncate">{country}</span>
                <span className="text-muted-foreground tabular-nums ml-2">{formatNumber(count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
