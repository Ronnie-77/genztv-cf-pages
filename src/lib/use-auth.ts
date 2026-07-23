'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore, type User } from '@/lib/store'
import { signOut } from 'next-auth/react'

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

  // Google Sign-in is not yet wired up in this deployment. Instead of
  // triggering a broken sign-in redirect, show a friendly "Coming Soon"
  // popup (managed via the global store so the dialog rendered in AppShell
  // opens from any call site: sidebar, account page, more menu).
  const login = useCallback(() => {
    setComingSoonOpen(true)
  }, [setComingSoonOpen])

  const logout = useCallback(async () => {
    try {
      await signOut({ redirect: false })
      setUser(null)
    } catch (error) {
      console.error('[useAuth] Error signing out:', error)
    }
  }, [setUser])

  return {
    user,
    isLoggedIn,
    login,
    logout,
  }
}