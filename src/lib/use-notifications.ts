'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

// Convert base64 string to Uint8Array for push subscription
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export type NotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Check if we're in a restricted environment (iframe)
  const isRestricted = typeof window !== 'undefined' && window !== window.top

  // Check permission status on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) {
      setPermission('unsupported')
      setError('Notifications are not supported in this browser')
      return
    }
    if (!('serviceWorker' in navigator)) {
      setPermission('unsupported')
      setError('Service workers are not supported in this browser')
      return
    }
    if (!VAPID_PUBLIC_KEY) {
      console.warn('[Notifications] VAPID public key not configured — notifications disabled')
      // Don't show error, just mark as unsupported so UI hides notification prompts gracefully
      setPermission('unsupported')
      return
    }

    setPermission(Notification.permission as NotificationPermission)

    // Register service worker
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('[Notifications] Service worker registered successfully')
      setSwRegistration(registration)
      // Check if already subscribed
      return registration.pushManager.getSubscription()
    }).then((subscription) => {
      if (subscription) {
        setIsSubscribed(true)
        console.log('[Notifications] Already subscribed to push')
      }
    }).catch((err) => {
      console.error('[Notifications] Service Worker registration failed:', err)
      if (window !== window.top) {
        // In iframe — don't set unsupported, just set error so bell still shows
        setError('Notifications require opening the site directly')
      } else {
        setError('Failed to register service worker. Please reload the page.')
      }
    })
  }, [])

  // Internal subscribe helper — defined first so subscribe() can reference it
  const doSubscribe = async (registration: ServiceWorkerRegistration) => {
    setIsLoading(true)
    setError(null)
    try {
      // Request permission first
      const perm = await Notification.requestPermission()
      setPermission(perm as NotificationPermission)
      if (perm !== 'granted') {
        const msg = perm === 'denied'
          ? 'Notification permission was denied. Please enable it in your browser settings.'
          : 'Notification permission was not granted'
        setError(msg)
        toast.error(msg)
        return false
      }

      toast.success('Notification permission granted!')

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      // Send subscription to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (res.ok) {
        setIsSubscribed(true)
        toast.success('Notifications enabled successfully! 🔔')
        return true
      } else {
        const data = await res.json().catch(() => ({}))
        const msg = data.error || 'Failed to save subscription on server'
        setError(msg)
        toast.error(msg)
        return false
      }
    } catch (err) {
      console.error('[Notifications] Failed to subscribe:', err)
      let msg = 'Failed to enable notifications'
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          msg = 'Notification permission was denied. Please enable it in your browser settings.'
        } else if (err.message.includes('registration')) {
          msg = 'Please open the site directly to enable notifications'
        } else {
          msg = err.message
        }
      }
      setError(msg)
      toast.error(msg)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) {
      const msg = 'Notifications are not available at this time'
      setError(msg)
      toast.info(msg)
      return false
    }

    // Try to use existing registration, or get a fresh one from the navigator
    let registration = swRegistration

    if (!registration) {
      // Try to register service worker first
      if ('serviceWorker' in navigator) {
        try {
          registration = await navigator.serviceWorker.register('/sw.js')
          setSwRegistration(registration)
          // Continue with this registration
        } catch {
          const msg = window !== window.top
            ? 'Please open the site directly to enable notifications (not in an embedded view)'
            : 'Failed to register service worker. Please reload and try again.'
          setError(msg)
          toast.error(msg)
          return false
        }
      } else {
        const msg = 'Service workers are not supported'
        setError(msg)
        toast.error(msg)
        return false
      }
    }

    // Also try to get the ready registration in case the stored one is stale
    if (!registration && 'serviceWorker' in navigator) {
      try {
        registration = await navigator.serviceWorker.ready
        setSwRegistration(registration)
      } catch {
        // Ignore, use the one we have
      }
    }

    return doSubscribe(registration)
  }, [swRegistration])

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    setIsLoading(true)
    try {
      // Try to use stored registration or get from navigator
      let registration = swRegistration
      if (!registration && 'serviceWorker' in navigator) {
        try {
          registration = await navigator.serviceWorker.ready
        } catch {
          // No registration available
        }
      }
      if (!registration) {
        // No service worker — just mark as unsubscribed
        setIsSubscribed(false)
        toast.success('Notifications disabled')
        return true
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await subscription.unsubscribe()
        // Remove from server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      }
      setIsSubscribed(false)
      toast.success('Notifications disabled')
      return true
    } catch (err) {
      console.error('[Notifications] Failed to unsubscribe:', err)
      // Even on error, mark as unsubscribed locally so user can re-subscribe
      setIsSubscribed(false)
      toast.error('Failed to disable notifications')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [swRegistration])

  // Toggle subscription
  const toggleSubscription = useCallback(async () => {
    if (isSubscribed) {
      return unsubscribe()
    } else {
      return subscribe()
    }
  }, [isSubscribed, subscribe, unsubscribe])

  return {
    permission,
    isSubscribed,
    isLoading,
    error,
    isRestricted,
    subscribe,
    unsubscribe,
    toggleSubscription,
  }
}
