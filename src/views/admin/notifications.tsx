'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, BellRing, Plus, Trash2, Send, Users, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { fetchNotifications, createNotification, deleteNotification, type PushNotification } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function AdminNotifications() {
  const [notifications, setNotifications] = useState<PushNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null)

  // New notification form
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState('general')
  const [sendPush, setSendPush] = useState(true)
  const [creating, setCreating] = useState(false)

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchNotifications()
      setNotifications(data)
    } catch {
      toast.error('Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSubscriberCount = useCallback(async () => {
    try {
      const res = await fetch('/api/push/subscribers')
      if (res.ok) {
        const data = await res.json()
        setSubscriberCount(data.count)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadNotifications()
    loadSubscriberCount()
  }, [loadNotifications, loadSubscriberCount])

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }

    setCreating(true)
    try {
      const result = await createNotification({
        title: title.trim(),
        body: body.trim(),
        url: url.trim(),
        type,
        sendPush,
      })

      if (sendPush) {
        toast.success(`Notification sent to ${result.sentCount} devices`, {
          description: result.failCount > 0 ? `${result.failCount} failed` : undefined,
        })
      } else {
        toast.success('Notification created (push not sent)')
      }

      setTitle('')
      setBody('')
      setUrl('')
      setType('general')
      loadNotifications()
      loadSubscriberCount()
    } catch {
      toast.error('Failed to create notification')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteNotification(id)
      toast.success('Notification deleted')
      loadNotifications()
    } catch {
      toast.error('Failed to delete notification')
    }
  }

  const typeColors: Record<string, string> = {
    general: 'bg-blue-500/10 text-blue-500',
    live: 'bg-red-500/10 text-red-500',
    match: 'bg-green-500/10 text-green-500',
    update: 'bg-yellow-500/10 text-yellow-500',
    promo: 'bg-purple-500/10 text-purple-500',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Push Notifications
          </h2>
          <p className="text-sm text-muted-foreground">
            Send push notifications to your subscribers
          </p>
        </div>
        {subscriberCount !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-lg">
            <Users className="h-4 w-4" />
            <span>{subscriberCount} subscriber{subscriberCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Create Notification Form */}
      <div className="border rounded-xl p-4 space-y-3 bg-card">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Notification
        </h3>
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Notification title *"
            className="text-sm"
          />
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Notification body (optional)"
            className="text-sm"
          />
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL to open on click (optional)"
              className="text-sm flex-1"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-xs"
            >
              <option value="general">General</option>
              <option value="live">🔴 Live</option>
              <option value="match">⚽ Match</option>
              <option value="update">🔄 Update</option>
              <option value="promo">📢 Promo</option>
            </select>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Switch
                checked={sendPush}
                onCheckedChange={setSendPush}
              />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Send className="h-3 w-3" />
                Send push immediately
              </span>
            </div>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={creating || !title.trim()}
              className="gap-1"
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <BellRing className="h-3 w-3" />
              )}
              {creating ? 'Sending...' : sendPush ? 'Send Push' : 'Create'}
            </Button>
          </div>
        </div>
      </div>

      {/* Notification History */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          History
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No notifications yet
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className="border rounded-lg p-3 bg-card hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{notif.title}</span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', typeColors[notif.type] || typeColors.general)}>
                        {notif.type}
                      </span>
                      {notif.pushSent && (
                        <span className="text-[10px] text-green-500 flex items-center gap-0.5">
                          <CheckCircle2 className="h-3 w-3" />
                          Sent
                        </span>
                      )}
                    </div>
                    {notif.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span>{new Date(notif.createdAt).toLocaleString()}</span>
                      {notif.pushSent && (
                        <span className="flex items-center gap-0.5">
                          <Send className="h-3 w-3" />
                          {notif.sentCount} sent
                          {notif.failCount > 0 && (
                            <span className="text-red-400 ml-1 flex items-center gap-0.5">
                              <XCircle className="h-3 w-3" />
                              {notif.failCount} failed
                            </span>
                          )}
                        </span>
                      )}
                      {notif.url && (
                        <a
                          href={notif.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 hover:text-primary"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Link
                        </a>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(notif.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
