'use client'

import { useState, useRef } from 'react'
import { Download, Upload, Database, AlertCircle, CheckCircle2, FileJson, HardDrive, Trash2, ArrowRight, Tv } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ExportMeta {
  version: string
  exportedAt: string
  app: string
  type?: string
  count?: number
  counts: {
    channels: number
    matches: number
    categories: number
    dailyStats: number
    visitorSessions: number
    pageViews: number
  }
}

export function AdminData() {
  const [exporting, setExporting] = useState(false)
  const [exportingChannels, setExportingChannels] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<ExportMeta | null>(null)
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importData, setImportData] = useState<Record<string, unknown> | null>(null)
  const [resetting, setResetting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Export All ──
  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/data', { credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.')
          window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: { status: 401 } }))
          return
        }
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `Export failed (${res.status})`)
      }

      const data = await res.json()

      // Create downloadable JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().split('T')[0]
      a.href = url
      a.download = `genztv-backup-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      const counts = data._meta?.counts as Record<string, number> | undefined
      const totalItems = counts ? Object.values(counts).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0) : 0
      toast.success(`Export successful! ${totalItems} items exported.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  // ── Export Channels Only ──
  const handleExportChannels = async () => {
    setExportingChannels(true)
    try {
      const res = await fetch('/api/channels/export', { credentials: 'include' })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.')
          // Trigger admin logout so user can re-login
          window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: { status: 401 } }))
          return
        }
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || data.detail || `Export failed (${res.status})`)
      }

      const data = await res.json()

      // Create downloadable JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().split('T')[0]
      a.href = url
      a.download = `genztv-channels-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      const count = data._meta?.count ?? data.channels?.length ?? 0
      toast.success(`Channels exported! ${count} channels saved.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExportingChannels(false)
    }
  }

  // ── Import ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImportFile(file)
    setImportResult(null)

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (!data._meta || !data._meta.version) {
        toast.error('Invalid backup file — missing metadata header')
        setImportFile(null)
        setImportPreview(null)
        setImportData(null)
        return
      }

      setImportData(data)
      setImportPreview(data._meta)
    } catch {
      toast.error('Invalid JSON file — please select a valid backup file')
      setImportFile(null)
      setImportPreview(null)
      setImportData(null)
    }
  }

  const handleImport = async () => {
    if (!importData) return

    setImporting(true)
    try {
      const res = await fetch('/api/data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(importData),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || data.detail || `Import failed (${res.status})`)
      }

      setImportResult(data.result)
      toast.success('Data imported successfully!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const resetImport = () => {
    setImportFile(null)
    setImportPreview(null)
    setImportData(null)
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Reset All Data ──
  const handleReset = async () => {
    if (!confirm('⚠️ সতর্কতা!\n\nসকল ডাটা মুছে যাবে — চ্যানেল, ম্যাচ, ক্যাটেগরি, অ্যানালিটিক্স সবকিছু।\n\nআগে Export করে নিয়েছেন তো?\n\nআপনি কি নিশ্চিত?')) return
    if (!confirm('এটা শেষবারের মতো নিশ্চিত করছেন? এই কাজ আর পূর্বাবস্থায় ফেরানো যাবে না!')) return

    setResetting(true)
    try {
      const res = await fetch('/api/data/reset', {
        method: 'POST',
        credentials: 'include',
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.')
          window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: { status: 401 } }))
          return
        }
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Reset failed')
      }

      toast.success('All data has been reset')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  // ── Render Import Result ──
  const renderImportResult = () => {
    if (!importResult) return null

    const results = importResult as Record<string, { imported: number; skipped: number } | boolean>
    const items = [
      { key: 'channels', label: 'Channels' },
      { key: 'matches', label: 'Matches' },
      { key: 'categories', label: 'Categories' },
      { key: 'dailyStats', label: 'Daily Stats' },
      { key: 'visitorSessions', label: 'Visitor Sessions' },
      { key: 'pageViews', label: 'Page Views' },
    ]

    return (
      <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <span className="font-semibold text-sm">Import Complete</span>
        </div>
        <div className="space-y-1.5">
          {items.map(item => {
            const data = results[item.key] as { imported: number; skipped: number } | undefined
            if (!data || typeof data === 'boolean') return null
            return (
              <div key={item.key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">
                  {data.imported} imported
                  {data.skipped > 0 && <span className="text-amber-500 ml-1">({data.skipped} skipped)</span>}
                </span>
              </div>
            )
          })}
          {results.settings && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Settings</span>
              <span className="font-medium text-emerald-500">Updated</span>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={resetImport}
        >
          Import Another File
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight">Data Management</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Export your data to backup, import to restore when changing hosting
        </p>
      </div>

      {/* Export Section */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Download className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Export Data</h3>
            <p className="text-sm text-muted-foreground mt-1">
              আপনার সমস্ত ডাটা একটি JSON ফাইলে ডাউনলোড করুন। চ্যানেল, ম্যাচ, ক্যাটেগরি, সেটিংস, অ্যানালিটিক্স — সবকিছু অন্তর্ভুক্ত থাকবে।
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['চ্যানেল', 'ম্যাচ', 'ক্যাটেগরি', 'সেটিংস', 'অ্যানালিটিক্স'].map(item => (
                <span key={item} className="text-[10px] px-2 py-1 rounded-full bg-secondary text-muted-foreground font-medium">
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                onClick={handleExport}
                disabled={exporting}
                className="gap-2"
              >
                {exporting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Export All Data
                  </>
                )}
              </Button>
              <Button
                onClick={handleExportChannels}
                disabled={exportingChannels}
                variant="outline"
                className="gap-2"
              >
                {exportingChannels ? (
                  <>
                    <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Tv className="h-4 w-4 text-orange-500" />
                    Export Channels Only
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Import Section */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <Upload className="h-6 w-6 text-blue-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Import Data</h3>
            <p className="text-sm text-muted-foreground mt-1">
              আগে Export করা JSON ফাইল থেকে ডাটা রিস্টোর করুন। বিদ্যমান ডাটার সাথে মার্জ হবে, ডাটা মুছবে না।
            </p>

            {/* Warning */}
            <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Import করলে বিদ্যমান ডাটার উপরে মার্জ হবে। একই ID এর ডাটা আপডেট হবে, নতুন ID এর ডাটা যোগ হবে। কোনো ডাটা মুছবে না।
              </p>
            </div>

            {/* File Input */}
            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
              {!importFile ? (
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2"
                >
                  <FileJson className="h-4 w-4" />
                  Select Backup File
                </Button>
              ) : (
                <div className="space-y-3">
                  {/* Selected file info */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                    <FileJson className="h-5 w-5 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{importFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(importFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetImport}
                      className="h-7 px-2 text-muted-foreground"
                    >
                      ✕
                    </Button>
                  </div>

                  {/* Preview */}
                  {importPreview && (
                    <div className="p-3 rounded-lg bg-secondary/30 border border-border">
                      <div className="flex items-center gap-2 mb-2">
                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-semibold">Backup Preview</span>
                        {importPreview.type === 'channels-only' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600 font-medium">
                            Channels Only
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Exported: {new Date(importPreview.exportedAt).toLocaleString()}
                      </div>
                      {/* Channels-only preview */}
                      {importPreview.type === 'channels-only' ? (
                        <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-background text-xs">
                          <span>📺 Channels</span>
                          <span className="font-bold">{importPreview.count ?? 0}</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(importPreview.counts).map(([key, count]) => {
                            if (count === 0) return null
                            const labels: Record<string, string> = {
                              channels: '📺 Channels',
                              matches: '⚽ Matches',
                              categories: '📁 Categories',
                              dailyStats: '📊 Daily Stats',
                              visitorSessions: '👥 Visitors',
                              pageViews: '👁️ Page Views',
                            }
                            return (
                              <div key={key} className="flex items-center justify-between px-2 py-1.5 rounded-md bg-background text-xs">
                                <span>{labels[key] || key}</span>
                                <span className="font-bold">{count as number}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Import button */}
                  <Button
                    onClick={handleImport}
                    disabled={importing}
                    className="w-full gap-2"
                  >
                    {importing ? (
                      <>
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Import Data
                        <ArrowRight className="h-3 w-3" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Import result */}
            {renderImportResult()}
          </div>
        </div>
      </div>

      {/* Quick Info */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Hosting Change Guide</h3>
            <p className="text-sm text-muted-foreground mt-1">
              হোস্টিং সাইট চেঞ্জ করার সময় ডাটা হারানোর ভয় নেই:
            </p>
            <div className="mt-3 space-y-2">
              {[
                { step: '১', text: 'পুরনো সাইট থেকে "Export All Data" ক্লিক করে JSON ফাইল ডাউনলোড করুন' },
                { step: '২', text: 'নতুন সাইটে ডেপ্লয় করুন (GitHub push করলেই Railway অটো ডেপ্লয় করবে)' },
                { step: '৩', text: 'নতুন সাইটের অ্যাডমিন প্যানেলে "Select Backup File" দিয়ে JSON ফাইল সিলেক্ট করুন' },
                { step: '৪', text: '"Import Data" ক্লিক করুন — সব ডাটা রিস্টোর হয়ে যাবে!' },
              ].map(item => (
                <div key={item.step} className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                    {item.step}
                  </span>
                  <span className="text-sm text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
