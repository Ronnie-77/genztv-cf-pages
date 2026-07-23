'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { urlBase64ToUint8Array } from '@/lib/vapid'

type PushStatus = 'unsupported' | 'unsupported-push' | 'denied' | 'subscribed' | 'unsubscribed' | 'subscribing'

export function NotificationBell() {
  const [status, setStatus] = useState<PushStatus>('unsubscribed')
  const [showTooltip, setShowTooltip] = useState(false)

  // Check push notification support and current subscription
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) {
      setStatus('unsupported')
      return
    }
    if (!('PushManager' in window)) {
      setStatus('unsupported-push')
      return
    }

    checkSubscription()
  }, [])

  const checkSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      setStatus(subscription ? 'subscribed' : 'unsubscribed')
    } catch {
      setStatus('unsubscribed')
    }
  }, [])

  const subscribe = useCallback(async () => {
    if (status === 'subscribing') return
    setStatus('subscribing')

    try {
      // Get VAPID public key
      const keyRes = await fetch('/api/push/vapid-key')
      if (!keyRes.ok) throw new Error('Failed to get VAPID key')
      const { publicKey } = await keyRes.json()

      const registration = await navigator.serviceWorker.ready

      // Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      // Send subscription to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      if (!res.ok) throw new Error('Failed to save subscription')

      setStatus('subscribed')
    } catch (error) {
      console.error('[Push] Subscribe error:', error)
      // Check if permission was denied
      if (Notification.permission === 'denied') {
        setStatus('denied')
      } else {
        setStatus('unsubscribed')
      }
    }
  }, [status])

  const unsubscribe = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      
      if (subscription) {
        // Tell server to remove subscription
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        
        // Unsubscribe from browser
        await subscription.unsubscribe()
      }
      
      setStatus('unsubscribed')
    } catch (error) {
      console.error('[Push] Unsubscribe error:', error)
    }
  }, [])

  const handleClick = () => {
    if (status === 'subscribed') {
      unsubscribe()
    } else {
      subscribe()
    }
  }

  // Don't render if push is not supported
  if (status === 'unsupported' || status === 'unsupported-push') return null

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full relative"
        onClick={handleClick}
        disabled={status === 'subscribing' || status === 'denied'}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={
          status === 'subscribed' 
            ? 'Notifications enabled — click to disable' 
            : status === 'denied'
            ? 'Notifications blocked by browser'
            : 'Enable push notifications'
        }
      >
        {status === 'subscribed' ? (
          <BellRing className="h-4 w-4 text-primary" />
        ) : status === 'denied' ? (
          <BellOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {status === 'subscribing' && (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary animate-pulse" />
        )}
      </Button>
      
      {showTooltip && (
        <div className="absolute top-full right-0 mt-1 px-2 py-1 text-[10px] bg-popover text-popover-foreground border rounded shadow-lg whitespace-nowrap z-50">
          {status === 'subscribed' ? 'Notifications ON' : status === 'denied' ? 'Blocked by browser' : 'Enable notifications'}
        </div>
      )}
    </div>
  )
}
