'use client'

import { useEffect, useRef, useState } from 'react'

// Dynamic import to avoid compiling the entire app during initial page load.
// This reduces memory usage during Turbopack/webpack compilation.
//
// Reliability strategy:
//   - 5 retry attempts with backoff (handles transient network/parse failures
//     on weak Smart TV connections, or when the dev server is briefly unreachable).
//   - NO artificial timeout. Slow-but-progressing loads on Smart TVs are NOT
//     interrupted — the user just sees a friendly "Connecting..." screen with
//     live retry progress until the app is ready.
//   - The loading screen shows the current retry attempt number, so the user
//     can see the app is actively trying (not stuck).
//   - A "Try again now" button appears after the first failed attempt, so the
//     user can immediately retry instead of waiting for the next backoff.
//   - If all retries are exhausted, a friendly "Connection problem" screen
//     with Retry + Hard refresh buttons is shown.
const MAX_RETRIES = 5

async function loadAppShellWithRetry(
  onAttempt: (attempt: number, max: number) => void
): Promise<React.ComponentType> {
  let lastError: unknown = null
  for (let i = 0; i < MAX_RETRIES; i++) {
    onAttempt(i + 1, MAX_RETRIES)
    try {
      const mod = await import('@/components/layout/app-shell')
      return mod.AppShell
    } catch (err) {
      lastError = err
      // Exponential backoff between retries: 1s, 2s, 4s, 8s, 16s
      if (i < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)))
      }
    }
  }
  throw lastError
}

export default function Home() {
  const [AppShell, setAppShell] = useState<React.ComponentType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Forces the loading screen to re-render and restart retries when clicked.
  const [retryNonce, setRetryNonce] = useState(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    setAttempt(0)
    setError(null)

    loadAppShellWithRetry((a, max) => {
      if (!cancelled) setAttempt(a)
    })
      .then((Comp) => {
        if (!cancelled) {
          setAppShell(() => Comp)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to load AppShell after retries:', err)
          setError('connection-failed')
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground p-4">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">📡</div>
          <p className="text-lg font-semibold mb-2">Connection problem</p>
          <p className="text-sm text-muted-foreground mb-4">
            The app couldn't reach the server after multiple attempts. This is
            usually temporary — please check your internet connection and try again.
          </p>
          <div className="flex flex-col gap-2 items-center">
            <button
              onClick={() => setRetryNonce((n) => n + 1)}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
            >
              Try again
            </button>
            <a
              href="/"
              className="text-xs text-muted-foreground underline mt-2"
              onClick={(e) => {
                e.preventDefault()
                // Hard reload bypassing cache
                window.location.href = '/'
              }}
            >
              Hard refresh
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (!AppShell) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center px-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Connecting to GenZ TV…</p>
          {attempt > 0 && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Attempt {attempt} of {MAX_RETRIES}
            </p>
          )}
          {attempt >= 2 && (
            <button
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-3 px-4 py-1.5 text-xs border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              Try again now
            </button>
          )}
        </div>
      </div>
    )
  }

  return <AppShell />
}
