'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Bell,
  Send,
  Plus,
  Trash2,
  Pencil,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Megaphone,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type Notice, adminFetch } from '@/lib/api'

type NoticeType = 'popup' | 'push' | 'both'

const TYPE_META: Record<NoticeType, { label: string; icon: typeof Bell; color: string }> = {
  popup: { label: 'Popup', icon: Eye, color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' },
  push: { label: 'Push', icon: Send, color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  both: { label: 'Popup + Push', icon: Megaphone, color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

export function AdminNotices() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [fType, setFType] = useState<NoticeType>('popup')
  const [fTitle, setFTitle] = useState('')
  const [fBody, setFBody] = useState('')
  const [fUrl, setFUrl] = useState('')
  const [fImage, setFImage] = useState('')
  const [fActive, setFActive] = useState(true)

  const loadNotices = useCallback(async () => {
    try {
      setLoading(true)
      const res = await adminFetch('/api/notices/admin')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setNotices(data.notices || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed to load notices', { description: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotices()
  }, [loadNotices])

  const resetForm = () => {
    setFType('popup')
    setFTitle('')
    setFBody('')
    setFUrl('')
    setFImage('')
    setFActive(true)
    setEditingId(null)
    setShowForm(false)
  }

  const startEdit = (n: Notice) => {
    setEditingId(n.id)
    setFType(n.type as NoticeType)
    setFTitle(n.title)
    setFBody(n.body ?? '')
    setFUrl(n.url)
    setFImage(n.imageUrl)
    setFActive(n.isActive)
    setShowForm(true)
    // Scroll to top so the form is visible
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    if (!fTitle.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        type: fType,
        title: fTitle.trim(),
        body: fBody,
        url: fUrl,
        imageUrl: fImage,
        isActive: fActive,
      }
      let res: Response
      if (editingId) {
        res = await adminFetch(`/api/notices/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await adminFetch('/api/notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.detail || 'Failed to save')

      const pushInfo = data.pushResult
        ? ` • Push sent to ${data.pushResult.sent} user${data.pushResult.sent === 1 ? '' : 's'}`
        : ''
      toast.success(editingId ? 'Notice updated' : 'Notice created', {
        description: pushInfo || undefined,
      })
      resetForm()
      await loadNotices()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed to save notice', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this notice permanently?')) return
    try {
      const res = await adminFetch(`/api/notices/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete')
      }
      toast.success('Notice deleted')
      await loadNotices()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed to delete notice', { description: msg })
    }
  }

  const handleToggleActive = async (n: Notice) => {
    try {
      const res = await adminFetch(`/api/notices/${n.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !n.isActive }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(n.isActive ? 'Notice deactivated' : 'Notice activated')
      await loadNotices()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed to toggle', { description: msg })
    }
  }

  const handleResendPush = async (n: Notice) => {
    if (!confirm(`Resend the push notification "${n.title}" to all subscribers?`)) return
    try {
      const res = await adminFetch(`/api/notices/${n.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendPush: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resend')
      const r = data.pushResult
      toast.success('Push sent', {
        description: r ? `Delivered to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}` : undefined,
      })
      await loadNotices()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Failed to resend push', { description: msg })
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Notices &amp; Broadcasts</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadNotices}
            disabled={loading}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          {!showForm && (
            <Button
              size="sm"
              onClick={() => {
                resetForm()
                setShowForm(true)
              }}
              className="gap-1.5 text-xs h-8"
            >
              <Plus className="h-3.5 w-3.5" />
              New Notice
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-xs text-muted-foreground leading-relaxed">
        <p className="mb-2">
          <strong className="text-foreground">Popup notices</strong> show as a modal popup when a
          user enters the website. The popup appears <em>only</em> when you&apos;ve created an
          active notice here — no notice, no popup.
        </p>
        <p className="mb-2">
          <strong className="text-foreground">Push broadcasts</strong> send an instant push
          notification to every subscribed user (the users who clicked &quot;Enable
          Notifications&quot;). Use for important announcements — match reminders, downtime, etc.
        </p>
        <p>
          <strong className="text-foreground">Both</strong> does both: fires the push now AND shows
          the popup on site entry.
        </p>
      </div>

      {/* Form (create/edit) */}
      {showForm && (
        <div className="bg-card rounded-xl border-2 border-primary/30 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {editingId ? 'Edit Notice' : 'New Notice'}
            </h3>
            <Button variant="ghost" size="icon" onClick={resetForm} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Type selector */}
          <div>
            <label className="text-xs font-medium mb-2 block text-muted-foreground">
              Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_META) as NoticeType[]).map((t) => {
                const meta = TYPE_META[t]
                const Icon = meta.icon
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFType(t)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition text-xs font-medium',
                      fType === t
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {fType === 'popup' && 'Shows as a popup on website entry. No push notification sent.'}
              {fType === 'push' && 'Sends an instant push to all subscribers. No popup shown.'}
              {fType === 'both' && 'Sends a push now AND shows a popup on website entry.'}
            </p>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              Title <span className="text-red-500">*</span>
            </label>
            <Input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              placeholder="e.g. Server Maintenance Tonight"
              maxLength={120}
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              Message
            </label>
            <textarea
              value={fBody}
              onChange={(e) => setFBody(e.target.value)}
              placeholder="Write your notice message here..."
              rows={4}
              maxLength={1000}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {fBody.length}/1000 characters
            </p>
          </div>

          {/* Optional URL + Image */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
                Action URL (optional)
              </label>
              <Input
                value={fUrl}
                onChange={(e) => setFUrl(e.target.value)}
                placeholder="https://... or /#/some-page"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Clicking the popup/push takes the user here.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
                Image URL (optional)
              </label>
              <Input
                value={fImage}
                onChange={(e) => setFImage(e.target.value)}
                placeholder="https://...banner.png"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Shows as a banner image in the popup and push.
              </p>
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-[10px] text-muted-foreground">
                Inactive notices are hidden from users but kept for reference.
              </p>
            </div>
            <Switch checked={fActive} onCheckedChange={setFActive} />
          </div>

          {/* Save / Cancel */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={resetForm} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !fTitle.trim()} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {editingId ? 'Update Notice' : 'Publish Notice'}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Notices list */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : notices.length === 0 ? (
          <div className="bg-card rounded-xl border border-dashed border-border p-10 text-center">
            <Megaphone className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No notices yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click &quot;New Notice&quot; to create your first popup or push broadcast.
            </p>
          </div>
        ) : (
          notices.map((n) => {
            const meta = TYPE_META[n.type as NoticeType] || TYPE_META.popup
            const TypeIcon = meta.icon
            return (
              <div
                key={n.id}
                className={cn(
                  'bg-card rounded-xl border shadow-sm p-4 space-y-2',
                  n.isActive ? 'border-border' : 'border-border opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <Badge variant="outline" className={cn('gap-1 text-[10px]', meta.color)}>
                        <TypeIcon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      {n.isActive ? (
                        <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] gap-1 bg-secondary text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" /> Inactive
                        </Badge>
                      )}
                      {(n.type === 'push' || n.type === 'both') && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {n.pushSent ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Push sent
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3 text-amber-500" /> Push pending
                            </>
                          )}
                        </Badge>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold break-words">{n.title}</h4>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3 break-words">
                        {n.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-2">
                      Updated {formatRelative(n.updatedAt)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleActive(n)}
                    className="gap-1.5 text-xs h-7"
                    title={n.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {n.isActive ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {n.isActive ? 'Hide' : 'Show'}
                  </Button>
                  {(n.type === 'push' || n.type === 'both') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResendPush(n)}
                      className="gap-1.5 text-xs h-7 text-emerald-600 hover:text-emerald-700"
                      title="Resend push notification"
                    >
                      <Send className="h-3 w-3" />
                      Resend
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(n)}
                    className="gap-1.5 text-xs h-7"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(n.id)}
                    className="gap-1.5 text-xs h-7 text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
