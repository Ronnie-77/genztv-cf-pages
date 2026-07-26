// src/lib/env.ts — Simple env helper
//
// With Neon PostgreSQL, DATABASE_URL is the primary connection method.
// All env vars are accessible via process.env on CF Pages (nodejs_compat).
// No need for getCloudflareContext() anymore — Neon uses standard DATABASE_URL.

export function getEnv(key: string): string | undefined {
  return process.env[key]
}

export function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return value
}
