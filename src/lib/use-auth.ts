'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store'

// CF Pages deployment: no NextAuth (Google login not available in edge runtime)
// Uses simple session API + custom admin auth

export function useAuth() {
  const { user, setUser, isLoggedIn, setComingSoonOpen } = useAppStore()

  // Fetch session on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/user/session')
        const data = await res.json()
        if (data.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || data.user.email.split('@')[0],
            picture: data.user.image,
          })
        }
      } catch (error) {
        console.error('[useAuth] Error fetching session:', error)
      }
    }
    fetchSession()
  }, [setUser])

  // Google Sign-in is not available on CF Pages — show "Coming Soon" popup
  const login = useCallback(() => {
    setComingSoonOpen(true)
  }, [setComingSoonOpen])

  // Logout: clear admin cookie via API, then clear local state
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setUser(null)
    } catch (error) {
      console.error('[useAuth] Error signing out:', error)
      setUser(null) // Clear local state even if API fails
    }
  }, [setUser])

  return {
    user,
    isLoggedIn,
    login,
    logout,
  }
}
