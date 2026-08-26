// API helper functions for GenZ TV

const BASE = '/api'

/** Wrapper for admin API calls — auto-handles 401 (session expired) by dispatching event.
 *  Exported so admin sub-views (notices, etc.) can use the same auth-aware fetch. */
export function adminFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, {
    credentials: 'same-origin',
    ...options,
  }).then(res => {
    if (res.status === 401) {
      // Session expired — notify admin view to logout
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: { status: 401 } }))
      }
    }
    return res
  })
}

// ============ Types ============

export interface Channel {
  id: string
  name: string
  logo: string
  category: string
  streamType: string
  streamUrl: string
  githubM3uPath: string
  language: string
  country: string
  tags: string
  isFeatured: boolean
  isActive: boolean
  viewCount: number
  createdAt: string
  updatedAt: string
  // Token refresh automation
  sourcePageUrl: string
  refreshPattern: string
  tokenExpiresAt: string | null
  lastRefreshedAt: string | null
  autoRefresh: boolean
  refreshError: string
}

export interface MatchStream {
  id: string
  matchId: string
  name: string
  channel: string
  type: string
  url: string
}

export interface Match {
  id: string
  title: string
  sport: string
  teamA: string
  teamALogo: string
  teamB: string
  teamBLogo: string
  league: string
  thumbnail: string
  startTime: string
  endTime: string | null
  status: string
  isFeatured: boolean
  createdAt: string
  updatedAt: string
  streams: MatchStream[]
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  order: number
  channelCount: number
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  id: string
  appName: string
  logoUrl: string
  maintenanceMode: boolean
  featuredChannelId: string
  heroBannerText: string
  defaultQuality: string
  bannerAdScript: string | null
  socialBarAdScript: string | null
  customAdScripts: string | null  // JSON array of {id, name, script, position, enabled}
  adsEnabled: boolean
  homeAdsEnabled: boolean
  videoAdsEnabled: boolean
  apkUrl: string
  redirectAdUrl: string
  redirectAdEnabled: boolean
  redirectAdIntervalMinutes: number
  monetagEnabled: boolean
  monetagZoneId: string
  monetagDomain: string
}

// ============ Channels ============

export async function fetchChannels(params?: { category?: string; search?: string; featured?: boolean; includeInactive?: boolean }): Promise<Channel[]> {
  const searchParams = new URLSearchParams()
  if (params?.category) searchParams.set('category', params.category)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.featured) searchParams.set('featured', 'true')
  if (params?.includeInactive) searchParams.set('active', 'all')
  const res = await fetch(`${BASE}/channels?${searchParams.toString()}`)
  if (!res.ok) throw new Error('Failed to fetch channels')
  return res.json()
}

export async function fetchChannel(id: string): Promise<Channel> {
  const res = await fetch(`${BASE}/channels/${id}`)
  if (!res.ok) throw new Error('Failed to fetch channel')
  return res.json()
}

export async function createChannel(data: Partial<Channel>): Promise<Channel> {
  const res = await adminFetch(`${BASE}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create channel')
  return res.json()
}

export async function updateChannel(id: string, data: Partial<Channel>): Promise<Channel> {
  const res = await adminFetch(`${BASE}/channels/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update channel')
  return res.json()
}

export async function deleteChannel(id: string): Promise<void> {
  const res = await adminFetch(`${BASE}/channels/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete channel')
}

// ============ Token Refresh Automation ============

export interface RefreshResult {
  success: boolean
  channel?: Channel
  message?: string
  source?: string
  newExpiresAt?: number | null
}

export interface BatchRefreshResult {
  success: boolean
  total: number
  refreshed: number
  failed: number
  results: Array<{
    id: string
    name: string
    success: boolean
    message: string
    newExpiresAt?: number | null
  }>
}

export interface ReactiveRefreshResult {
  success: boolean
  refreshed: boolean
  streamUrl?: string
  newExpiresAt?: number | null
  reason?: string
  message?: string
}

export interface RefreshStatus {
  total: number
  needingRefresh: number
  expired: number
  channels: Array<{
    id: string
    name: string
    streamType: string
    sourcePageUrl: string
    tokenExpiresAt: string | null
    lastRefreshedAt: string | null
    refreshError: string
    needsRefresh: boolean
    isExpired: boolean
  }>
}

/** Admin: refresh a single channel's stream URL from its source page. */
export async function refreshChannel(id: string, force: boolean = false): Promise<RefreshResult> {
  const res = await adminFetch(`${BASE}/channels/${id}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Refresh failed' }))
    throw new Error(err.error || err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

/** Admin: batch-refresh all expiring channels. */
export async function refreshExpiredChannels(forceAll: boolean = false): Promise<BatchRefreshResult> {
  const res = await adminFetch(`${BASE}/channels/refresh-expired`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceAll }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Batch refresh failed' }))
    throw new Error(err.error || err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

/** Admin: get the refresh status of all autoRefresh channels. */
export async function fetchRefreshStatus(): Promise<RefreshStatus> {
  const res = await adminFetch(`${BASE}/channels/refresh-expired`)
  if (!res.ok) throw new Error('Failed to fetch refresh status')
  return res.json()
}

/**
 * Public: reactive refresh triggered by the player when playback fails (403).
 * Rate-limited per-channel by the server. Returns the new streamUrl if
 * refresh succeeded — caller should reload the player with it.
 */
export async function reactiveRefreshChannel(id: string): Promise<ReactiveRefreshResult> {
  const res = await fetch(`${BASE}/channels/${id}/reactive-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Reactive refresh failed' }))
    throw new Error(err.error || err.reason || `HTTP ${res.status}`)
  }
  return res.json()
}

// ============ Matches ============

export async function fetchMatches(params?: { sport?: string; status?: string; featured?: boolean }): Promise<Match[]> {
  const searchParams = new URLSearchParams()
  if (params?.sport) searchParams.set('sport', params.sport)
  if (params?.status) searchParams.set('status', params.status)
  if (params?.featured) searchParams.set('featured', 'true')
  const res = await fetch(`${BASE}/matches?${searchParams.toString()}`)
  if (!res.ok) throw new Error('Failed to fetch matches')
  return res.json()
}

export async function fetchMatch(id: string): Promise<Match> {
  const res = await fetch(`${BASE}/matches/${id}`)
  if (!res.ok) throw new Error('Failed to fetch match')
  return res.json()
}

export async function createMatch(data: {
  sport?: string
  teamA: string
  teamALogo?: string
  teamB: string
  teamBLogo?: string
  league?: string
  thumbnail?: string
  startTime: string
  endTime?: string
  status?: string
  isFeatured?: boolean
  streams?: { name?: string; channel?: string; type?: string; url?: string }[]
}): Promise<Match> {
  const res = await adminFetch(`${BASE}/matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create match')
  return res.json()
}

export async function updateMatch(id: string, data: Record<string, unknown>): Promise<Match> {
  const res = await adminFetch(`${BASE}/matches/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update match')
  return res.json()
}

export async function deleteMatch(id: string): Promise<void> {
  const res = await adminFetch(`${BASE}/matches/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete match')
}

// ============ Categories ============

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${BASE}/categories`)
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json()
}

export async function createCategory(data: Partial<Category>): Promise<Category> {
  const res = await adminFetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create category')
  return res.json()
}

export async function updateCategory(id: string, data: Partial<Category>): Promise<Category> {
  const res = await adminFetch(`${BASE}/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update category')
  return res.json()
}

export async function deleteCategory(id: string): Promise<void> {
  const res = await adminFetch(`${BASE}/categories/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete category')
}

// ============ Settings ============

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to fetch settings (HTTP ${res.status}): ${text || res.statusText}`)
  }
  return res.json()
}

export async function updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
  const res = await adminFetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to update settings (HTTP ${res.status}): ${text || res.statusText}`)
  }
  return res.json()
}

// ============ M3U Parser ============

export async function parseM3U(url: string): Promise<{ channels: { name: string; logo: string; group: string; url: string }[]; total: number }> {
  const res = await adminFetch(`${BASE}/m3u-parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error('Failed to parse M3U')
  return res.json()
}

// ============ File Import ============

export async function importFileContent(content: string, fileType: string): Promise<{ channels: { name: string; logo: string; group: string; url: string; language?: string; country?: string; streamType?: string }[]; total: number }> {
  const res = await adminFetch(`${BASE}/channels/import-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, fileType }),
  })
  if (!res.ok) throw new Error('Failed to parse import file')
  return res.json()
}

// ============ Match Status Sync ============

export async function syncMatchStatuses(): Promise<{ success: boolean; updatedToLive: number; updatedToEnded: number; totalUpdated: number }> {
  const res = await adminFetch(`${BASE}/matches/sync-statuses`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to sync match statuses')
  return res.json()
}

// ============ Feedback ============

export interface Feedback {
  id: string
  category: string
  email: string
  subject: string
  message: string
  page: string
  userAgent: string
  device: string
  browser: string
  status: string
  adminNote: string
  createdAt: string
  updatedAt: string
}

/** Public: submit a new feedback entry. */
export async function submitFeedback(data: {
  category?: string
  email?: string
  subject?: string
  message: string
  page?: string
}): Promise<{ success: boolean; id: string }> {
  const res = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to submit feedback' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

/** Admin: fetch all feedback entries. */
export async function fetchFeedback(): Promise<Feedback[]> {
  const res = await adminFetch(`${BASE}/feedback`)
  if (!res.ok) throw new Error('Failed to fetch feedback')
  return res.json()
}

/** Admin: update feedback status / admin note. */
export async function updateFeedback(id: string, data: { status?: string; adminNote?: string }): Promise<Feedback> {
  const res = await adminFetch(`${BASE}/feedback/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update feedback')
  return res.json()
}

/** Admin: delete a feedback entry. */
export async function deleteFeedback(id: string): Promise<void> {
  const res = await adminFetch(`${BASE}/feedback/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete feedback')
}
