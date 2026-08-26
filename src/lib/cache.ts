/**
 * ApiCache — In-memory TTL cache for hot API paths
 *
 * Reduces database load by caching frequently-accessed data with a short TTL.
 * Each category (channels, settings, etc.) has its own TTL and invalidation method.
 *
 * Cache categories & TTLs:
 *   channels      — 30s  (channel list is hot, changes infrequently)
 *   settings      — 60s  (app settings rarely change)
 *   categories    — 60s  (categories rarely change)
 *   matches       — 15s  (match status changes often during live events)
 *   dashboard     — 10s  (analytics dashboard, near-real-time)
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number // epoch ms
}

class ApiCache {
  private store = new Map<string, CacheEntry<unknown>>()

  // ── TTL constants (ms) ──
  private static readonly TTL_CHANNELS = 30_000
  private static readonly TTL_SETTINGS = 60_000
  private static readonly TTL_CATEGORIES = 60_000
  private static readonly TTL_MATCHES = 15_000
  private static readonly TTL_DASHBOARD = 10_000

  // ── Internal helpers ──

  private get<T>(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.data as T
  }

  private set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    })
  }

  private deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }

  // ── Channels ──

  getChannels(cacheKey: string): unknown[] | null {
    return this.get<unknown[]>(`channels:${cacheKey}`)
  }

  setChannels(cacheKey: string, data: unknown[]): void {
    this.set(`channels:${cacheKey}`, data, ApiCache.TTL_CHANNELS)
  }

  invalidateChannels(): void {
    this.deleteByPrefix('channels:')
  }

  // ── Settings ──

  getSettings(): Record<string, unknown> | null {
    return this.get<Record<string, unknown>>('settings:global')
  }

  setSettings(data: Record<string, unknown>): void {
    this.set('settings:global', data, ApiCache.TTL_SETTINGS)
  }

  invalidateSettings(): void {
    this.store.delete('settings:global')
  }

  // ── Categories ──

  getCategories(): unknown[] | null {
    return this.get<unknown[]>('categories:global')
  }

  setCategories(data: unknown[]): void {
    this.set('categories:global', data, ApiCache.TTL_CATEGORIES)
  }

  invalidateCategories(): void {
    this.store.delete('categories:global')
  }

  // ── Matches ──

  getMatches(cacheKey: string): unknown[] | null {
    return this.get<unknown[]>(`matches:${cacheKey}`)
  }

  setMatches(cacheKey: string, data: unknown[]): void {
    this.set(`matches:${cacheKey}`, data, ApiCache.TTL_MATCHES)
  }

  invalidateMatches(): void {
    this.deleteByPrefix('matches:')
  }

  // ── Analytics Dashboard ──

  getDashboard(): Record<string, unknown> | null {
    return this.get<Record<string, unknown>>('analytics:dashboard')
  }

  setDashboard(data: Record<string, unknown>): void {
    this.set('analytics:dashboard', data, ApiCache.TTL_DASHBOARD)
  }

  invalidateDashboard(): void {
    this.store.delete('analytics:dashboard')
  }

  // ── Global ──

  /** Clear all cached entries — used after daily reset */
  clear(): void {
    this.store.clear()
  }
}

/** Singleton instance — shared across all API routes */
export const apiCache = new ApiCache()
