'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchFeedback, updateFeedback, deleteFeedback, type Feedback } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bug,
  Lightbulb,
  Heart,
  MessageCircle,
  Trash2,
  Mail,
  Monitor,
  Smartphone,
  Tv,
  Clock,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'

// ─────────────────────────────────────────────────────────────────────────────
// AdminFeedback — admin panel page for viewing and managing user feedback.
//
// Features:
//   • List all feedback, newest first
//   • Filter by category + status
//   • Expand a feedback card to read the full message + reply/note
//   • Mark as read / resolved, add admin note, delete
//   • Shows device + browser + page context for bug reports
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  bug: { label: 'Bug', icon: Bug, color: 'text-red-500' },
  feature: { label: 'Feature', icon: Lightbulb, color: 'text-amber-500' },
  compliment: { label: 'Compliment', icon: Heart, color: 'text-emerald-500' },
  other: { label: 'Other', icon: MessageCircle, color: 'text-muted-foreground' },
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'bg-blue-500/15 text-blue-500 border-blue-500/20' },
  read: { label: 'Read', color: 'bg-amber-500/15 text-amber-500 border-amber-500/20' },
  resolved: { label: 'Resolved', color: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' },
}

function formatTimeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(date).toLocaleDateString()
}

function DeviceIcon({ device }: { device: string }) {
  if (device === 'mobile' || device === 'tablet') return <Smartphone className="h-3 w-3" />
  if (device === 'tv') return <Tv className="h-3 w-3" />
  return <Monitor className="h-3 w-3" />
}

export function AdminFeedback() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'new' | 'read' | 'resolved'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [adminNote, setAdminNote] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchFeedback()
      setFeedbacks(data)
    } catch (err) {
      toast.error('Failed to load feedback', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateFeedback(id, { status })
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)))
      toast.success(`Marked as ${status}`)
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  const handleSaveNote = async (id: string) => {
    try {
      await updateFeedback(id, { adminNote })
      setFeedbacks((prev) => prev.map((f) => (f.id === id ? { ...f, adminNote } : f)))
      toast.success('Note saved')
    } catch (err) {
      toast.error('Failed to save note')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this feedback? This cannot be undone.')) return
    try {
      await deleteFeedback(id)
      setFeedbacks((prev) => prev.filter((f) => f.id !== id))
      toast.success('Feedback deleted')
    } catch (err) {
      toast.error('Failed to delete feedback')
    }
  }

  const handleExpand = (fb: Feedback) => {
    if (expandedId === fb.id) {
      setExpandedId(null)
    } else {
      setExpandedId(fb.id)
      setAdminNote(fb.adminNote)
      // Auto-mark as read when expanded
      if (fb.status === 'new') {
        handleStatusChange(fb.id, 'read')
      }
    }
  }

  const filtered = feedbacks.filter((f) => {
    if (filter !== 'all' && f.status !== filter) return false
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
    return true
  })

  const counts = {
    all: feedbacks.length,
    new: feedbacks.filter((f) => f.status === 'new').length,
    read: feedbacks.filter((f) => f.status === 'read').length,
    resolved: feedbacks.filter((f) => f.status === 'resolved').length,
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">User Feedback</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {feedbacks.length} total · {counts.new} new · {counts.resolved} resolved
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status filter */}
        {(['all', 'new', 'read', 'resolved'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/70'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s].label} ({counts[s]})
          </button>
        ))}
        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground border-0 outline-none cursor-pointer"
        >
          <option value="all">All Categories</option>
          <option value="bug">🐛 Bug</option>
          <option value="feature">💡 Feature</option>
          <option value="compliment">❤️ Compliment</option>
          <option value="other">💬 Other</option>
        </select>
      </div>

      {/* Feedback list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-2xl border border-border">
          <MessageCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No feedback found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {filter !== 'all' || categoryFilter !== 'all'
              ? 'Try changing the filters'
              : 'Feedback submitted by users will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((fb) => {
            const cat = CATEGORY_CONFIG[fb.category] || CATEGORY_CONFIG.other
            const CatIcon = cat.icon
            const status = STATUS_CONFIG[fb.status] || STATUS_CONFIG.new
            const isExpanded = expandedId === fb.id
            return (
              <div
                key={fb.id}
                className={`bg-card rounded-2xl border transition-all ${
                  fb.status === 'new'
                    ? 'border-blue-500/30'
                    : isExpanded
                      ? 'border-foreground/20'
                      : 'border-border'
                }`}
              >
                {/* Summary row — clickable to expand */}
                <button
                  onClick={() => handleExpand(fb)}
                  className="w-full flex items-start gap-3 p-4 text-left"
                >
                  <div className={`w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0`}>
                    <CatIcon className={`h-4 w-4 ${cat.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">
                        {fb.subject || fb.message.slice(0, 50) + (fb.message.length > 50 ? '...' : '')}
                      </p>
                      <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${status.color}`}>
                        {status.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {fb.message}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTimeAgo(fb.createdAt)}
                      </span>
                      {fb.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {fb.email}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <DeviceIcon device={fb.device} />
                        {fb.device} · {fb.browser}
                      </span>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  )}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    {/* Full message */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Message
                      </p>
                      <p className="text-sm whitespace-pre-wrap break-words bg-secondary/30 rounded-lg p-3">
                        {fb.message}
                      </p>
                    </div>

                    {/* Context info */}
                    {(fb.page || fb.userAgent) && (
                      <div className="text-[11px] text-muted-foreground space-y-0.5">
                        {fb.page && <p><span className="font-medium">Page:</span> {fb.page}</p>}
                        {fb.userAgent && (
                          <p className="truncate">
                            <span className="font-medium">UA:</span> {fb.userAgent}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Admin note */}
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Admin Note (private)
                      </p>
                      <Textarea
                        value={adminNote}
                        onChange={(e) => setAdminNote(e.target.value)}
                        placeholder="Add a private note for your reference..."
                        className="text-xs min-h-[60px] resize-none"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1.5 text-xs h-7"
                        onClick={() => handleSaveNote(fb.id)}
                      >
                        Save Note
                      </Button>
                      {fb.adminNote && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                          Current note: {fb.adminNote}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {fb.status !== 'resolved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-8 gap-1.5"
                          onClick={() => handleStatusChange(fb.id, 'resolved')}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Mark Resolved
                        </Button>
                      )}
                      {fb.status !== 'new' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-8 gap-1.5"
                          onClick={() => handleStatusChange(fb.id, 'new')}
                        >
                          <Circle className="h-3.5 w-3.5" />
                          Mark New
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-8 gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(fb.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
