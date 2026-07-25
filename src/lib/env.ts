// src/lib/env.ts
// ═══════════════════════════════════════════════════════════════
// Centralized environment variable access — CF Workers compatible
// ═══════════════════════════════════════════════════════════════
//
// On Cloudflare Pages/Workers:
//   • Dashboard env vars are NOT in process.env — only available
//     via getCloudflareContext().env (async)
//   • wrangler.toml [vars] + `wrangler secret put` ARE in process.env
//   • D1 bindings are in env.DB, NOT in process.env
//
// This module provides TWO access modes:
//   getEnvAsync(key) — async, always works, use in request handlers
//   getEnv(key)      — sync, uses cached env or process.env fallback
//
// The async call caches env for subsequent sync calls, so db.ts
// (which calls getCloudflareContext first) effectively initializes
// the cache for all later sync reads in the same Worker instance.
//
// CRITICAL: For auth, vapid, push, and other lib files that are
// called from request handlers, always use getEnvAsync() to ensure
// env vars are properly resolved on Cloudflare Workers.

type EnvRecord = Record<string, string | undefined>

let _envCache: EnvRecord | null = null
let _envInitPromise: Promise<EnvRecord> | null = null

async function loadCfEnv(): Promise<EnvRecord> {
  if (_envCache) return _envCache

  if (!_envInitPromise) {
    _envInitPromise = (async () => {
      try {
        const { getCloudflareContext } = await import('@opennextjs/cloudflare')
        const { env } = await getCloudflareContext()
        // Merge: CF env (dashboard vars + bindings) > process.env (wrangler vars/secrets)
        // This ensures dashboard vars override wrangler vars if there are conflicts.
        const merged: EnvRecord = {}
        // process.env first (lower priority)
        for (const [k, v] of Object.entries(process.env)) {
          if (v !== undefined) merged[k] = v
        }
        // CF env overrides (higher priority — dashboard vars are here)
        for (const [k, v] of Object.entries(env as EnvRecord)) {
          if (v !== undefined) merged[k] = v
        }
        _envCache = merged
        return merged
      } catch {
        // Not on CF Workers — just use process.env
        _envCache = process.env as EnvRecord
        return _envCache
      }
    })()
  }

  return _envInitPromise
}

/** Async env access — works everywhere (CF Workers + local dev).
 *  Use this in request handlers and any async context.
 *  Guarantees access to ALL env vars (dashboard + wrangler + process). */
export async function getEnvAsync(key: string): Promise<string | undefined> {
  const env = await loadCfEnv()
  return env[key]
}

/** Sync env access — uses cached env or falls back to process.env.
 *  Only reliable AFTER env has been initialized via getEnvAsync()
 *  or a db.ts getDb() call (which calls getCloudflareContext).
 *  In request handlers, prefer getEnvAsync() for guaranteed access.
 *  For module-level code or non-critical fallbacks, getEnv() is OK. */
export function getEnv(key: string): string | undefined {
  if (_envCache) return _envCache[key]
  return process.env[key]
}

/** Reset env cache — useful when env changes or for testing */
export function resetEnvCache(): void {
  _envCache = null
  _envInitPromise = null
}
