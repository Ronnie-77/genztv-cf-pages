// ═══════════════════════════════════════════════════════════════════
// Database row types — mirror the D1 schema
// ═══════════════════════════════════════════════════════════════════

export interface ChannelRow {
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
  isFeatured: number // SQLite stores boolean as 0/1
  isActive: number
  viewCount: number
  createdAt: string
  updatedAt: string
  sourcePageUrl: string
  refreshPattern: string
  tokenExpiresAt: string | null
  lastRefreshedAt: string | null
  autoRefresh: number
  refreshError: string
}

export interface MatchRow {
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
  isFeatured: number
  liveNotifiedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MatchStreamRow {
  id: string
  matchId: string
  name: string
  channel: string
  type: string
  url: string
}

export interface CategoryRow {
  id: string
  name: string
  icon: string
  color: string
  order: number
  channelCount: number
  createdAt: string
  updatedAt: string
}

export interface AppSettingRow {
  id: string
  appName: string
  logoUrl: string
  maintenanceMode: number
  featuredChannelId: string
  heroBannerText: string
  defaultQuality: string
  bannerAdScript: string
  socialBarAdScript: string
  customAdScripts: string
  adsEnabled: number
  homeAdsEnabled: number
  videoAdsEnabled: number
  apkUrl: string
  ga4MeasurementId: string
  firebaseConfig: string
  securityEnabled: number
  redirectAdUrl: string
  redirectAdEnabled: number
  redirectAdIntervalMinutes: number
  monetagEnabled: number
  monetagZoneId: string
  monetagDomain: string
}

export interface FeedbackRow {
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

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  createdAt: string
}

export interface NoticeRow {
  id: string
  type: string
  title: string
  body: string
  url: string
  imageUrl: string
  isActive: number
  pushSent: number
  createdAt: string
  updatedAt: string
}

export interface AppNotificationRow {
  id: string
  type: string
  title: string
  body: string
  url: string
  imageUrl: string
  isActive: number
  sendPush: number
  pushSent: number
  createdAt: string
  updatedAt: string
}

export interface PageViewRow {
  id: string
  sessionId: string
  page: string
  channelId: string | null
  matchId: string | null
  referrer: string
  userAgent: string
  country: string
  ip: string
  device: string
  browser: string
  createdAt: string
}

export interface DailyStatRow {
  id: string
  date: string
  totalViews: number
  uniqueVisitors: number
  peakVisitors: number
  topPages: string
  topChannels: string
  topCountries: string
  topDevices: string
  topBrowsers: string
  createdAt: string
  updatedAt: string
}

export interface VisitorSessionRow {
  id: string
  sessionId: string
  firstSeen: string
  lastSeen: string
  pageCount: number
  country: string
  userAgent: string
  ip: string
  device: string
  browser: string
  currentChannelId: string | null
  currentMatchId: string | null
}

// ── Helper: convert SQLite row (0/1) to boolean ──────────────────

export function toBool(value: number | null | undefined): boolean {
  return value === 1 || value === true
}

export function toNum(value: boolean | number): number {
  return value ? 1 : 0
}
