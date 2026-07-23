'use client'

import { useAppStore } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sparkles, Mail } from 'lucide-react'

/**
 * ComingSoonDialog
 *
 * Shown when a visitor clicks "Sign in with Google". Google OAuth is not yet
 * wired up in this deployment, so instead of triggering a broken sign-in
 * redirect we show a friendly "Coming Soon" popup.
 *
 * Open state is held in the global store so ANY component can trigger it
 * (sidebar, account page, more menu) by calling `setComingSoonOpen(true)`.
 */
export function ComingSoonDialog() {
  const open = useAppStore((s) => s.comingSoonOpen)
  const setOpen = useAppStore((s) => s.setComingSoonOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        {/* Gradient header banner */}
        <div className="relative bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 px-6 pt-8 pb-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm ring-1 ring-white/30">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Coming Soon</h2>
          <p className="mt-1 text-sm text-white/90">
            Google Sign-in is on the way
          </p>
        </div>

        <div className="px-6 pb-6 -mt-4">
          <DialogHeader className="space-y-3">
            <DialogTitle className="sr-only">Sign in with Google — Coming Soon</DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground leading-relaxed">
              We&apos;re putting the finishing touches on Google authentication.
              Soon you&apos;ll be able to sign in with your Google account to
              sync favorites, watch history, and get personalized recommendations
              across all your devices.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span>Stay tuned — updates are on the way!</span>
          </div>

          <DialogFooter className="mt-6 sm:justify-center">
            <Button
              onClick={() => setOpen(false)}
              className="w-full sm:w-auto"
            >
              Got it
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
