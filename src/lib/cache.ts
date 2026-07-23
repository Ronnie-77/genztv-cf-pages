// src/lib/cache.ts — Cloudflare Pages: No in-memory caching
// Workers runtime is ephemeral — no persistent state between requests.
// All cache methods are pass-through (no-op).

export const apiCache = {
  getChannels: (_key: string) => null as unknown[] | null,
  setChannels: (_key: string, _data: unknown) => {},
  invalidateChannels: () => {},
  getMatches: (_key: string) => null as unknown[] | null,
  setMatches: (_key: string, _data: unknown) => {},
  invalidateMatches: () => {},
  getSettings: () => null as Record<string, unknown> | null,
  setSettings: (_data: unknown) => {},
  invalidateSettings: () => {},
  getCategories: (_key: string) => null as unknown[] | null,
  setCategories: (_key: string, _data: unknown) => {},
  invalidateCategories: () => {},
  getDashboard: () => null as Record<string, unknown> | null,
  setDashboard: (_data: unknown) => {},
  invalidateDashboard: () => {},
  clear: () => {},
}
