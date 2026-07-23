'use client'

/**
 * InstallAppDialog — device-aware PWA install instructions.
 *
 * Shown when the user clicks "Install App" but the browser does NOT support
 * the native `beforeinstallprompt` flow (iOS Safari, Desktop Firefox).
 * The instructions are tailored to the detected device family.
 *
 * For browsers that DO support the native prompt (Android Chrome, Desktop
 * Chrome/Edge), this dialog is typically not shown — `usePwaInstall.install()`
 * returns `'native'` and the browser's own dialog appears.
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Smartphone, Monitor, Share, MoreVertical, Plus, Home } from 'lucide-react'
import type { DeviceMode, PlatformHint } from '@/lib/use-pwa-install'

interface InstallAppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: DeviceMode
  platform: PlatformHint
}

interface Step {
  icon: React.ReactNode
  text: React.ReactNode
}

function stepsFor(device: DeviceMode, platform: PlatformHint): { title: string; steps: Step[] } {
  // iOS (iPhone / iPad) — Safari only path
  if (platform === 'ios') {
    return {
      title: 'Install on iPhone / iPad',
      steps: [
        { icon: <Share className="h-5 w-5" />, text: <><b>Tap the Share</b> button in Safari's toolbar (square with an up arrow).</> },
        { icon: <Plus className="h-5 w-5" />, text: <><b>Select “Add to Home Screen”</b> from the share sheet.</> },
        { icon: <Home className="h-5 w-5" />, text: <><b>Tap “Add”</b> — GenZ TV appears on your home screen like a native app.</> },
      ],
    }
  }

  // Android — if the native prompt didn't fire
  if (platform === 'android') {
    return {
      title: 'Install on Android',
      steps: [
        { icon: <MoreVertical className="h-5 w-5" />, text: <><b>Tap the menu</b> (⋮) in the top-right of Chrome.</> },
        { icon: <Home className="h-5 w-5" />, text: <><b>Choose “Add to Home screen”</b> or <b>“Install app”</b>.</> },
        { icon: <Plus className="h-5 w-5" />, text: <><b>Confirm</b> — GenZ TV installs to your app drawer & home screen.</> },
      ],
    }
  }

  // Desktop Firefox
  if (platform === 'firefox') {
    return {
      title: 'Install on Firefox (Desktop)',
      steps: [
        { icon: <Home className="h-5 w-5" />, text: <><b>Open the Page Actions menu</b> (•••) in the address bar.</> },
        { icon: <Download className="h-5 w-5" />, text: <><b>Click “Install this site as an app”</b>.</> },
        { icon: <Plus className="h-5 w-5" />, text: <><b>Confirm</b> — GenZ TV launches from your desktop / start menu.</> },
      ],
    }
  }

  // Desktop Safari (macOS) — no PWA install, offer "Add to Dock"
  if (platform === 'safari') {
    return {
      title: 'Install on Safari (Mac)',
      steps: [
        { icon: <Share className="h-5 w-5" />, text: <><b>Click the Share</b> button in the toolbar.</> },
        { icon: <Plus className="h-5 w-5" />, text: <><b>Choose “Add to Dock”</b> to install GenZ TV as a dock app.</> },
        { icon: <Home className="h-5 w-5" />, text: <><b>Launch from the Dock</b> — it opens in a standalone window.</> },
      ],
    }
  }

  // Default — Desktop Chromium fallback (if the native prompt was dismissed)
  return {
    title: 'Install GenZ TV',
    steps: [
      { icon: <MoreVertical className="h-5 w-5" />, text: <>Click the <b>browser menu (⋮)</b> in the top-right corner.</> },
      { icon: <Download className="h-5 w-5" />, text: <>Select <b>“Cast, save, and share” → “Install page as app”</b> (or “Install GenZ TV” if the install icon is shown in the address bar).</> },
      { icon: <Home className="h-5 w-5" />, text: <>Confirm — GenZ TV opens in its own window and is added to your desktop / start menu.</> },
    ],
  }
}

function deviceIcon(device: DeviceMode, platform: PlatformHint) {
  if (platform === 'ios' || platform === 'android' || device === 'mobile') return <Smartphone className="h-8 w-8" />
  return <Monitor className="h-8 w-8" />
}

export function InstallAppDialog({ open, onOpenChange, device, platform }: InstallAppDialogProps) {
  const { title, steps } = stepsFor(device, platform)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0 text-primary">
              {deviceIcon(device, platform)}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Install GenZ TV as an app — works offline & launches like a native app.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ol className="space-y-3 mt-1">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center shrink-0">
                <span className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
              </div>
              <div className="flex items-start gap-2.5 pt-0.5">
                <span className="text-primary shrink-0 mt-0.5">{step.icon}</span>
                <span className="text-sm text-foreground leading-relaxed">{step.text}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-2 rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Tip:</span> Installing adds GenZ TV to your
          device's home screen / app list so you can launch it like a native app — no app store needed.
        </div>

        <div className="flex justify-end gap-2 mt-1">
          <Button onClick={() => onOpenChange(false)} className="gap-1.5">
            <Download className="h-4 w-4" />
            Got it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
