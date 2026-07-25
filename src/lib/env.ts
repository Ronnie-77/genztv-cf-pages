// src/lib/env.ts — Cloudflare Workers env helper
//
// On Cloudflare Pages (production), env vars are accessible through:
//   1. process.env (via nodejs_compat flag) — works for Dashboard-set vars
//   2. getCloudflareContext().env — provides bindings (D1, KV) + vars
//
// This module provides both sync (process.env) and async (CF context) access.
// Use sync for simple vars (ADMIN_PASSWORD), async for bindings (D1).

/**
 * Get an environment variable synchronously via process.env.
 * Works on CF Pages with nodejs_compat flag + Dashboard env vars.
 */
export function getEnv(key: string): string | undefined {
  return process.env[key]
}

/**
 * Get an environment variable asynchronously via Cloudflare context.
 * Falls back to process.env if CF context is unavailable.
 * Use this when you need bindings (D1, KV) or want the most reliable access.
 */
export async function getEnvAsync(key: string): Promise<string | undefined> {
  // Try process.env first (always available on Pages with nodejs_compat)
  if (process.env[key]) {
    return process.env[key]
  }

  // Try Cloudflare context (for bindings + vars)
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext()
    const value = env[key]
    if (typeof value === 'string') {
      return value
    }
  } catch {
    // Not on CF Workers, or context unavailable
  }

  return undefined
}

/**
 * Get a required env var synchronously. Throws if missing.
 */
export function requireEnv(key: string): string {
  const value = getEnv(key)
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}

/**
 * Get a required env var asynchronously. Throws if missing.
 */
export async function requireEnvAsync(key: string): Promise<string> {
  const value = await getEnvAsync(key)
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}
