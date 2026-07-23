'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { submitFeedback } from '@/lib/api'
import { toast } from 'sonner'
import { Bug, Lightbulb, Heart, MessageCircle, Send, X } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackDialog — modal where users submit feedback (bug, feature, compliment)
//
// Used by the floating FeedbackButton (in app-shell) and the "Send Feedback"
// link in the More page. Public — no login required.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'bug', label: 'Bug Report', icon: Bug, color: 'text-red-500' },
  { value: 'feature', label: 'Feature Request', icon: Lightbulb, color: 'text-amber-500' },
  { value: 'compliment', label: 'Compliment', icon: Heart, color: 'text-emerald-500' },
  { value: 'other', label: 'Other', icon: MessageCircle, color: 'text-muted-foreground' },
]

interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [category, setCategory] = useState('bug')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setCategory('bug')
        setEmail('')
        setSubject('')
        setMessage('')
      }, 200)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || message.trim().length < 5) {
      toast.error('Message too short', { description: 'Please write at least 5 characters' })
      return
    }

    setSubmitting(true)
    try {
      await submitFeedback({
        category,
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
        page: typeof window !== 'undefined' ? window.location.hash : '',
      })
      toast.success('Feedback sent!', {
        description: 'Thank you for your feedback. We appreciate it!',
        duration: 4000,
      })
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit feedback'
      toast.error('Submission failed', { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            Send Feedback
          </DialogTitle>
          <DialogDescription>
            Found a bug? Have an idea? Let us know — we read every message.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              Type of feedback
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon
                const isActive = category === cat.value
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      isActive
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/20'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? cat.color : ''}`} />
                    {cat.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Email (optional) */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Email <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="text-sm"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Subject
            </label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary"
              className="text-sm"
              maxLength={200}
            />
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Message <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us more..."
              className="text-sm min-h-[100px] resize-none"
              maxLength={5000}
              required
            />
            <p className="text-[10px] text-muted-foreground mt-1 text-right">
              {message.length}/5000
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting || message.trim().length < 5}>
              <Send className="h-4 w-4" />
              {submitting ? 'Sending...' : 'Send Feedback'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
