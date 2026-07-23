'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Tv, Edit, Trash2, Search, X, Check, RefreshCw, Eye, Star, ToggleLeft, ToggleRight, Upload, Github, FileUp, FileText, FileJson, CheckSquare, Square, Users, KeyRound, Clock, AlertCircle, Zap, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { fetchChannels, createChannel, updateChannel, deleteChannel, parseM3U, importFileContent, refreshChannel, refreshExpiredChannels, type Channel } from '@/lib/api'
import { toast } from 'sonner'

const categoryOptions = [
  { value: 'news', label: '📰 News' },
  { value: 'sports', label: '🏆 Sports' },
  { value: 'cricket', label: '🏏 Cricket' },
  { value: 'football', label: '⚽ Football' },
  { value: 'entertainment', label: '🎬 Entertainment' },
  { value: 'international', label: '🌍 International' },
]

const streamTypeOptions = [
  { value: 'm3u', label: 'M3U/HLS (auto fallback)' },
  { value: 'm3u8_direct', label: '🎯 Direct HLS (optimized, CORS-open)' },
  { value: 'm3u8_proxy', label: '🛡️ Proxy HLS (CORS/Referer bypass)' },
  { value: 'm3u8_jw', label: 'M3U8 JW Player' },
  { value: 'iframe', label: 'iFrame (proxied + lock)' },
  { value: 'iframe_direct', label: '⬛ iFrame Direct (raw embed, no controls/proxy)' },
  { value: 'mpegts', label: 'MPEG-TS (.ts)' },
  { value: 'dash', label: 'DASH (.mpd)' },
  { value: 'github_m3u', label: 'GitHub M3U' },
  { value: 'fifalive', label: '🔴 FifaLive (auto token refresh)' },
  { value: 'fifalive_proxy', label: '🔴 FifaLive Proxy (/api/fifalive URL)' },
]

interface ChannelFormData {
  name: string
  logo: string
  categories: string[]  // Array of selected categories (stored as comma-separated in DB)
  streamType: string
  streamUrl: string
  githubM3uPath: string
  language: string
  country: string
  tags: string
  isFeatured: boolean
  isActive: boolean
  // Token refresh automation
  sourcePageUrl: string
  refreshPattern: string
  autoRefresh: boolean
}

const emptyForm: ChannelFormData = {
  name: '',
  logo: '',
  categories: ['entertainment'],
  streamType: 'm3u',
  streamUrl: '',
  githubM3uPath: '',
  language: '',
  country: '',
  tags: '',
  isFeatured: false,
  isActive: true,
  sourcePageUrl: '',
  refreshPattern: '',
  autoRefresh: false,
}

/** Parse comma-separated category string into array */
function parseCategories(categoryStr: string): string[] {
  if (!categoryStr) return []
  return categoryStr.split(',').map(c => c.trim()).filter(Boolean)
}

/** Format a token expiry Date (ISO string) as a human-readable relative time. */
function formatExpiry(expiresAt: string | null): { label: string; tone: 'ok' | 'soon' | 'expired' | 'unknown' } {
  if (!expiresAt) return { label: 'no token', tone: 'unknown' }
  const ms = new Date(expiresAt).getTime()
  if (Number.isNaN(ms)) return { label: 'no token', tone: 'unknown' }
  const diff = ms - Date.now()
  if (diff <= 0) return { label: 'expired', tone: 'expired' }
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return { label: `${mins}m left`, tone: mins < 15 ? 'expired' : 'soon' }
  const hrs = Math.floor(mins / 60)
  const remMin = mins % 60
  if (hrs < 24) return { label: `${hrs}h ${remMin}m left`, tone: 'ok' }
  const days = Math.floor(hrs / 24)
  return { label: `${days}d ${hrs % 24}h left`, tone: 'ok' }
}

/** Inline cell showing token expiry status + last refresh error if any. */
function TokenCell({ channel }: { channel: Channel }) {
  const expiry = formatExpiry(channel.tokenExpiresAt)
  const toneClasses = {
    ok: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    soon: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
    expired: 'text-red-600 dark:text-red-400 border-red-500/40',
    unknown: 'text-muted-foreground border-border',
  }[expiry.tone]

  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border w-fit ${toneClasses}`}>
        <Clock className="h-2.5 w-2.5" />
        {expiry.label}
      </span>
      {channel.refreshError && (
        <span
          className="inline-flex items-center gap-1 text-[9px] text-red-600 dark:text-red-400 truncate max-w-[140px]"
          title={channel.refreshError}
        >
          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{channel.refreshError}</span>
        </span>
      )}
      {!channel.sourcePageUrl && (
        <span className="text-[9px] text-muted-foreground/60">no source page</span>
      )}
    </div>
  )
}

export function AdminChannels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ChannelFormData>(emptyForm)
  const [saving, setSaving] = useState(false)

  // IPTV Import state
  const [showIptvImport, setShowIptvImport] = useState(false)
  const [iptvUrl, setIptvUrl] = useState('')
  const [iptvLoading, setIptvLoading] = useState(false)
  const [iptvResults, setIptvResults] = useState<{ name: string; logo: string; group: string; url: string }[]>([])
  const [selectedIptvChannels, setSelectedIptvChannels] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [iptvSearch, setIptvSearch] = useState('')

  // File Import state
  const [showFileImport, setShowFileImport] = useState(false)
  const [fileImportLoading, setFileImportLoading] = useState(false)
  const [fileImportResults, setFileImportResults] = useState<{ name: string; logo: string; group: string; url: string; language?: string; country?: string }[]>([])
  const [selectedFileChannels, setSelectedFileChannels] = useState<Set<number>>(new Set())
  const [fileImporting, setFileImporting] = useState(false)
  const [fileImportSearch, setFileImportSearch] = useState('')
  const [fileDragOver, setFileDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Token refresh state
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [batchRefreshing, setBatchRefreshing] = useState(false)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Live viewer counts per channel. Refreshed every 5s by polling
  // /api/admin/live-viewers. REAL counts only (no demo data) — a channel
  // shows 0 if no one is currently watching it.
  const [channelViewers, setChannelViewers] = useState<Record<string, number>>({})

  // Ref for scrolling to form on edit
  const formRef = useRef<HTMLDivElement>(null)

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchChannels({
        ...(filterCategory !== 'all' ? { category: filterCategory } : {}),
        ...(searchQuery ? { search: searchQuery } : {}),
        includeInactive: true,
      })
      setChannels(data)
    } catch {
      toast.error('Error', { description: 'Failed to load channels' })
    } finally {
      setLoading(false)
    }
  }, [filterCategory, searchQuery])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Poll /api/admin/live-viewers every 5s to keep the "Live" column as close
  // to real-time as possible. Sends the current list of channel ids so the
  // server can return counts for exactly those channels (no demo data — a
  // channel with no viewers shows 0). The poll stops when the component
  // unmounts (admin navigates away from the channels tab).
  useEffect(() => {
    if (channels.length === 0) return
    const controller = new AbortController()

    const fetchLiveViewers = async () => {
      try {
        const res = await fetch('/api/admin/live-viewers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelIds: channels.map((c) => c.id) }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = await res.json()
        if (data && typeof data.channelViewers === 'object') {
          setChannelViewers(data.channelViewers)
        }
      } catch {
        // Silent — analytics must never break the admin panel.
      }
    }

    fetchLiveViewers()
    const timer = setInterval(fetchLiveViewers, 5_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [channels])

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Validation Error', { description: 'Channel name is required' })
      return
    }

    setSaving(true)
    try {
      const data = {
        name: form.name,
        logo: form.logo,
        category: form.categories.filter(Boolean).join(','),
        streamType: form.streamType,
        streamUrl: form.streamUrl,
        githubM3uPath: form.githubM3uPath,
        language: form.language,
        country: form.country,
        tags: form.tags,
        isFeatured: form.isFeatured,
        isActive: form.isActive,
        sourcePageUrl: form.sourcePageUrl,
        refreshPattern: form.refreshPattern,
        autoRefresh: form.autoRefresh,
      }

      if (editingId) {
        await updateChannel(editingId, data)
        toast.success('Channel Updated', { description: `${form.name} has been updated successfully` })
      } else {
        await createChannel(data)
        toast.success('Channel Created', { description: `${form.name} has been created successfully` })
      }

      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm)
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to save channel' })
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (channel: Channel) => {
    setEditingId(channel.id)
    const channelCategories = parseCategories(channel.category)
    setForm({
      name: channel.name,
      logo: channel.logo,
      categories: channelCategories.length > 0 ? channelCategories : ['entertainment'],
      streamType: channel.streamType,
      streamUrl: channel.streamUrl,
      githubM3uPath: channel.githubM3uPath,
      language: channel.language,
      country: channel.country,
      tags: channel.tags,
      isFeatured: channel.isFeatured,
      isActive: channel.isActive,
      sourcePageUrl: channel.sourcePageUrl || '',
      refreshPattern: channel.refreshPattern || '',
      autoRefresh: channel.autoRefresh || false,
    })
    setShowForm(true)
    // Scroll to form after a short delay to allow state to render
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const toggleCategory = (catValue: string) => {
    setForm(prev => {
      const cats = prev.categories.includes(catValue)
        ? prev.categories.filter(c => c !== catValue)
        : [...prev.categories, catValue]
      return { ...prev, categories: cats.length > 0 ? cats : ['entertainment'] }
    })
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteChannel(id)
      toast.success('Channel Deleted', { description: 'Channel has been removed' })
      setDeleteConfirm(null)
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to delete channel' })
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} channel${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return

    setBulkDeleting(true)
    let deleted = 0
    let failed = 0
    for (const id of selectedIds) {
      try {
        await deleteChannel(id)
        deleted++
      } catch {
        failed++
      }
    }
    setBulkDeleting(false)
    setSelectedIds(new Set())
    if (deleted > 0) toast.success(`Deleted ${deleted} channel${deleted > 1 ? 's' : ''}`)
    if (failed > 0) toast.error(`Failed to delete ${failed} channel${failed > 1 ? 's' : ''}`)
    loadChannels()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === channels.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(channels.map(ch => ch.id)))
    }
  }

  const handleToggleActive = async (channel: Channel) => {
    try {
      await updateChannel(channel.id, { isActive: !channel.isActive })
      toast.success('Channel Updated', { description: `${channel.name} is now ${!channel.isActive ? 'active' : 'inactive'}` })
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to update channel' })
    }
  }

  const handleToggleFeatured = async (channel: Channel) => {
    try {
      await updateChannel(channel.id, { isFeatured: !channel.isFeatured })
      toast.success('Channel Updated', { description: `${channel.name} featured status updated` })
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to update channel' })
    }
  }

  // ===== Token Refresh Handlers =====

  const handleRefreshChannel = async (channel: Channel, force: boolean = false) => {
    if (!channel.sourcePageUrl) {
      toast.error('No Source Page', {
        description: 'Edit the channel and set a Source Page URL to enable refresh.',
      })
      return
    }
    setRefreshingId(channel.id)
    try {
      const result = await refreshChannel(channel.id, force)
      toast.success('Stream Refreshed', {
        description: `${channel.name}: ${result.message || 'new m3u8 extracted successfully'}`,
      })
      loadChannels()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refresh failed'
      toast.error('Refresh Failed', { description: msg })
    } finally {
      setRefreshingId(null)
    }
  }

  const handleToggleAutoRefresh = async (channel: Channel) => {
    try {
      const newAuto = !channel.autoRefresh
      await updateChannel(channel.id, { autoRefresh: newAuto })
      toast.success('Auto-Refresh Updated', {
        description: `${channel.name}: auto-refresh ${newAuto ? 'enabled' : 'disabled'}`,
      })
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to toggle auto-refresh' })
    }
  }

  const handleRefreshAllExpired = async () => {
    setBatchRefreshing(true)
    try {
      const result = await refreshExpiredChannels(false)
      if (result.total === 0) {
        toast.info('Nothing to Refresh', {
          description: 'No channels are currently expiring or expired.',
        })
      } else {
        toast.success('Batch Refresh Complete', {
          description: `${result.refreshed} refreshed, ${result.failed} failed (of ${result.total} checked)`,
        })
      }
      loadChannels()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch refresh failed'
      toast.error('Batch Refresh Failed', { description: msg })
    } finally {
      setBatchRefreshing(false)
    }
  }

  const handleIptvParse = async () => {
    if (!iptvUrl.trim()) return
    setIptvLoading(true)
    try {
      const result = await parseM3U(iptvUrl)
      setIptvResults(result.channels)
      setSelectedIptvChannels(new Set())
      toast.success('M3U Parsed', { description: `Found ${result.total} channels` })
    } catch {
      toast.error('Error', { description: 'Failed to parse M3U file' })
    } finally {
      setIptvLoading(false)
    }
  }

  const handleImportSelected = async () => {
    setImporting(true)
    let imported = 0
    try {
      for (const idx of selectedIptvChannels) {
        const ch = iptvResults[idx]
        if (ch) {
          try {
            await createChannel({
              name: ch.name,
              logo: ch.logo,
              category: ch.group ? `sports,${ch.group.toLowerCase()}` : 'entertainment',
              streamType: ch.url.includes('.m3u8') ? 'm3u' : 'iframe',
              streamUrl: ch.url,
            })
            imported++
          } catch {
            // skip individual errors
          }
        }
      }
      toast.success('Import Complete', { description: `Successfully imported ${imported} channels` })
      setShowIptvImport(false)
      setIptvUrl('')
      setIptvResults([])
      setSelectedIptvChannels(new Set())
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to import channels' })
    } finally {
      setImporting(false)
    }
  }

  const toggleIptvChannel = (idx: number) => {
    const next = new Set(selectedIptvChannels)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedIptvChannels(next)
  }

  const selectAllIptv = () => {
    if (selectedIptvChannels.size === iptvResults.length) {
      setSelectedIptvChannels(new Set())
    } else {
      setSelectedIptvChannels(new Set(iptvResults.map((_, i) => i)))
    }
  }

  // ===== File Import Handlers =====

  const handleFileUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'm3u' && ext !== 'json') {
      toast.error('Invalid File', { description: 'Only .m3u and .json files are supported' })
      return
    }

    setFileImportLoading(true)
    setFileImportResults([])
    setSelectedFileChannels(new Set())

    try {
      const content = await file.text()
      const fileType = ext === 'm3u' ? 'm3u' : 'json'
      const result = await importFileContent(content, fileType)
      setFileImportResults(result.channels)
      toast.success('File Parsed', { description: `Found ${result.total} channels in ${file.name}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file'
      toast.error('Parse Error', { description: msg })
    } finally {
      setFileImportLoading(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setFileDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const toggleFileChannel = (idx: number) => {
    const next = new Set(selectedFileChannels)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedFileChannels(next)
  }

  const selectAllFileChannels = () => {
    if (selectedFileChannels.size === fileImportResults.length) {
      setSelectedFileChannels(new Set())
    } else {
      setSelectedFileChannels(new Set(fileImportResults.map((_, i) => i)))
    }
  }

  const handleFileImportSelected = async () => {
    setFileImporting(true)
    let imported = 0
    try {
      for (const idx of selectedFileChannels) {
        const ch = fileImportResults[idx]
        if (ch) {
          // 🎯🛡️ Respect streamType from JSON if present (m3u8_direct / m3u8_proxy),
          // otherwise fall back to URL-extension heuristic.
          const inferredType = ch.url.includes('.m3u8') ? 'm3u'
            : ch.url.includes('.ts') ? 'mpegts'
            : ch.url ? 'iframe'
            : 'm3u'
          try {
            await createChannel({
              name: ch.name,
              logo: ch.logo,
              category: ch.group || 'entertainment',
              streamType: ch.streamType || inferredType,
              streamUrl: ch.url,
              language: ch.language || '',
              country: ch.country || '',
            })
            imported++
          } catch {
            // skip individual errors
          }
        }
      }
      toast.success('Import Complete', { description: `Successfully imported ${imported} channels` })
      setShowFileImport(false)
      setFileImportResults([])
      setSelectedFileChannels(new Set())
      loadChannels()
    } catch {
      toast.error('Error', { description: 'Failed to import channels' })
    } finally {
      setFileImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="all">All Categories</option>
            {categoryOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setShowIptvImport(!showIptvImport); setShowFileImport(false) }}
            className="gap-1.5 btn-press text-xs h-9"
          >
            <Github className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">IPTV Import</span>
            <span className="sm:hidden">IPTV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setShowFileImport(!showFileImport); setShowIptvImport(false) }}
            className="gap-1.5 btn-press text-xs h-9"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">File Import</span>
            <span className="sm:hidden">File</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAllExpired}
            disabled={batchRefreshing}
            className="gap-1.5 btn-press text-xs h-9"
            title="Re-extract m3u8 for all channels whose tokens are expiring or expired"
          >
            {batchRefreshing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{batchRefreshing ? 'Refreshing...' : 'Refresh Expired'}</span>
            <span className="sm:hidden">{batchRefreshing ? '...' : 'Refresh'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadChannels}
            className="gap-1.5 btn-press h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              setForm(emptyForm)
              setShowForm(!showForm)
            }}
            className="gap-1.5 btn-press text-xs h-9"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Channel
          </Button>
        </div>
      </div>

      {/* IPTV Import Section */}
      {showIptvImport && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Import from GitHub M3U</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste a GitHub raw M3U file URL. The system will parse and extract all channels.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="https://raw.githubusercontent.com/.../playlist.m3u"
              value={iptvUrl}
              onChange={(e) => setIptvUrl(e.target.value)}
              className="flex-1 h-9"
            />
            <Button onClick={handleIptvParse} disabled={iptvLoading} size="sm" className="btn-press gap-1.5">
              {iptvLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {iptvLoading ? 'Parsing...' : 'Parse'}
            </Button>
          </div>

          {/* Parsed Results */}
          {iptvResults.length > 0 && (
            <div className="space-y-3">
              {/* Search bar for parsed channels */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`Search in ${iptvResults.length} channels...`}
                  value={iptvSearch}
                  onChange={(e) => setIptvSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
                {iptvSearch && (
                  <button
                    onClick={() => setIptvSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  {iptvSearch
                    ? `${iptvResults.filter(ch => ch.name.toLowerCase().includes(iptvSearch.toLowerCase()) || (ch.group || '').toLowerCase().includes(iptvSearch.toLowerCase())).length} of ${iptvResults.length} channels (${selectedIptvChannels.size} selected)`
                    : `Found ${iptvResults.length} channels (${selectedIptvChannels.size} selected)`
                  }
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllIptv} className="text-xs h-7">
                    {selectedIptvChannels.size === iptvResults.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" onClick={handleImportSelected} disabled={importing || selectedIptvChannels.size === 0} className="gap-1 text-xs h-7">
                    <Upload className="h-3 w-3" />
                    {importing ? 'Importing...' : `Import ${selectedIptvChannels.size}`}
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                {iptvResults
                  .filter(ch => !iptvSearch || ch.name.toLowerCase().includes(iptvSearch.toLowerCase()) || (ch.group || '').toLowerCase().includes(iptvSearch.toLowerCase()))
                  .map((ch) => {
                    const idx = iptvResults.indexOf(ch)
                    return (
                  <label
                    key={idx}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedIptvChannels.has(idx) ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/30 hover:bg-secondary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIptvChannels.has(idx)}
                      onChange={() => toggleIptvChannel(idx)}
                      className="rounded"
                    />
                    {ch.logo && <img src={ch.logo} alt="" className="w-8 h-8 rounded object-contain p-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ch.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{ch.group || 'No group'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[9px] shrink-0">
                      {ch.url.includes('.m3u8') ? 'M3U8' : 'Other'}
                    </Badge>
                  </label>
                )})}
              </div>
            </div>
          )}
        </div>
      )}

      {/* File Import Section */}
      {showFileImport && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Import from File</h3>
            </div>
            <Button variant="ghost" size="icon" onClick={() => { setShowFileImport(false); setFileImportResults([]); setSelectedFileChannels(new Set()) }} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a <span className="font-semibold text-foreground">.m3u</span> or <span className="font-semibold text-foreground">.json</span> file to import channels. Supports drag &amp; drop.
          </p>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setFileDragOver(true) }}
            onDragLeave={() => setFileDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              fileDragOver
                ? 'border-primary bg-primary/5 scale-[1.01]'
                : 'border-border hover:border-primary/40 hover:bg-secondary/30'
            } ${fileImportLoading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".m3u,.json"
              onChange={handleFileInputChange}
              className="hidden"
            />
            {fileImportLoading ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm font-medium">Parsing file...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-orange-500" />
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <FileJson className="h-5 w-5 text-emerald-500" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {fileDragOver ? 'Drop your file here' : 'Drop file here or click to browse'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supported: .m3u (M3U playlist) and .json (channel data)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Parsed Results */}
          {fileImportResults.length > 0 && (
            <div className="space-y-3">
              {/* Search bar for parsed channels */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`Search in ${fileImportResults.length} channels...`}
                  value={fileImportSearch}
                  onChange={(e) => setFileImportSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
                {fileImportSearch && (
                  <button
                    onClick={() => setFileImportSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  {fileImportSearch
                    ? `${fileImportResults.filter(ch => ch.name.toLowerCase().includes(fileImportSearch.toLowerCase()) || (ch.group || '').toLowerCase().includes(fileImportSearch.toLowerCase())).length} of ${fileImportResults.length} channels (${selectedFileChannels.size} selected)`
                    : `Found ${fileImportResults.length} channels (${selectedFileChannels.size} selected)`
                  }
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllFileChannels} className="text-xs h-7">
                    {selectedFileChannels.size === fileImportResults.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" onClick={handleFileImportSelected} disabled={fileImporting || selectedFileChannels.size === 0} className="gap-1 text-xs h-7">
                    <Upload className="h-3 w-3" />
                    {fileImporting ? 'Importing...' : `Import ${selectedFileChannels.size}`}
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                {fileImportResults
                  .filter(ch => !fileImportSearch || ch.name.toLowerCase().includes(fileImportSearch.toLowerCase()) || (ch.group || '').toLowerCase().includes(fileImportSearch.toLowerCase()))
                  .map((ch) => {
                    const idx = fileImportResults.indexOf(ch)
                    return (
                  <label
                    key={idx}
                    className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                      selectedFileChannels.has(idx) ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/30 hover:bg-secondary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFileChannels.has(idx)}
                      onChange={() => toggleFileChannel(idx)}
                      className="rounded"
                    />
                    {ch.logo && <img src={ch.logo} alt="" className="w-8 h-8 rounded object-contain p-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ch.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground truncate">{ch.group || 'No group'}</p>
                        {ch.language && <span className="text-[10px] text-muted-foreground">• {ch.language}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="secondary" className="text-[9px]">
                        {ch.url.includes('.m3u8') ? 'M3U8' : ch.url.includes('.ts') ? 'TS' : ch.url ? 'URL' : 'No URL'}
                      </Badge>
                      {ch.country && <span className="text-[9px] text-muted-foreground">{ch.country}</span>}
                    </div>
                  </label>
                )})}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Channel Form */}
      {showForm && (
        <div ref={formRef} className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4 animate-fade-slide scroll-mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editingId ? 'Edit Channel' : 'Add New Channel'}</h3>
            <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Channel Name *</label>
              <Input
                placeholder="e.g. Sony SIX"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Logo URL</label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://..."
                  value={form.logo}
                  onChange={(e) => setForm({ ...form, logo: e.target.value })}
                  className="flex-1"
                />
                {form.logo && (
                  <div className="w-9 h-9 rounded-lg border border-input bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                    <img src={form.logo} alt="" className="w-full h-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Categories</label>
              <p className="text-[10px] text-muted-foreground mb-2">Select all categories this channel belongs to. First selected is primary.</p>
              <div className="flex flex-wrap gap-2">
                {categoryOptions.map(opt => {
                  const isSelected = form.categories.includes(opt.value)
                  const isFirst = form.categories[0] === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleCategory(opt.value)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        isSelected
                          ? isFirst
                            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                            : 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-secondary/50 text-muted-foreground border-border hover:border-primary/30'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {isFirst && isSelected && <span className="text-[9px] opacity-70">(Primary)</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Stream Type</label>
              <select
                value={form.streamType}
                onChange={(e) => setForm({ ...form, streamType: e.target.value })}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {streamTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className={form.streamType === 'github_m3u' ? 'md:col-span-1' : 'md:col-span-2'}>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Stream URL</label>
              <Input
                placeholder={form.streamType === 'iframe' ? 'iFrame HTML or URL' : form.streamType === 'iframe_direct' ? 'Direct embed URL (raw iframe src)' : form.streamType === 'm3u' ? 'M3U8/HLS stream URL' : form.streamType === 'mpegts' ? 'MPEG-TS stream URL (.ts)' : form.streamType === 'fifalive' ? 'Auto-resolved from fifalive.click/play (leave empty)' : form.streamType === 'fifalive_proxy' ? '/api/fifalive?url=ENCODED_URL&mode=m3u8' : 'Stream URL'}
                value={form.streamUrl}
                onChange={(e) => {
                  const newUrl = e.target.value
                  // Auto-detect token in URL — if present + sourcePageUrl given, auto-enable refresh
                  const hasToken = /[?&](hdntl|exp|expires|Expires|token|sig|auth)=/i.test(newUrl)
                  setForm((prev) => ({
                    ...prev,
                    streamUrl: newUrl,
                    // Auto-enable autoRefresh if token detected AND sourcePageUrl is set
                    ...(hasToken && prev.sourcePageUrl && !prev.autoRefresh ? { autoRefresh: true } : {}),
                  }))
                }}
              />
              {/* Token detection indicator */}
              {form.streamUrl && /[?&](hdntl|exp|expires|Expires|token|sig|auth)=/i.test(form.streamUrl) && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Token detected
                  </span>
                  {!form.sourcePageUrl && (
                    <span className="text-muted-foreground">
                      ⚠️ Set a Source Page URL below to enable auto-refresh
                    </span>
                  )}
                  {form.sourcePageUrl && form.autoRefresh && (
                    <span className="text-emerald-500 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      Auto-refresh enabled
                    </span>
                  )}
                </div>
              )}
            </div>
            {form.streamType === 'github_m3u' && (
              <div>
                <label className="text-xs font-medium mb-1.5 block text-muted-foreground">GitHub M3U Path</label>
                <Input
                  placeholder="path/to/file.m3u in repo"
                  value={form.githubM3uPath}
                  onChange={(e) => setForm({ ...form, githubM3uPath: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Language</label>
              <Input
                placeholder="e.g. English, Hindi"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Country</label>
              <Input
                placeholder="e.g. India, USA"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Tags (comma separated)</label>
              <Input
                placeholder="e.g. hd, premium, live"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>
            <div className="md:col-span-2 border border-border rounded-lg p-4 bg-secondary/20 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">Token Refresh Automation</h4>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  For signed-URL streams (Akamai hdntl, strmd.st secure paths)
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-1">
                When the stream URL's token expires, the system can re-extract a fresh m3u8 from the source page automatically.
                Enter the public web page where the embed player lives (e.g. <code className="text-[10px] bg-secondary px-1 rounded">https://fifalive.click/</code>).
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-xs font-medium mb-1.5 block text-muted-foreground flex items-center gap-1.5">
                    <Link2 className="h-3 w-3" />
                    Source Page URL
                  </label>
                  <Input
                    placeholder="https://fifalive.click/  (the page where the player is embedded)"
                    value={form.sourcePageUrl}
                    onChange={(e) => {
                      const newSource = e.target.value
                      // Auto-enable autoRefresh if source page is set AND stream URL has a token
                      const hasToken = /[?&](hdntl|exp|expires|Expires|token|sig|auth)=/i.test(form.streamUrl)
                      setForm((prev) => ({
                        ...prev,
                        sourcePageUrl: newSource,
                        ...(hasToken && newSource && !prev.autoRefresh ? { autoRefresh: true } : {}),
                      }))
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    💡 When you enter a Source Page URL for a token-protected stream, auto-refresh turns on automatically.
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
                    Refresh Pattern (optional regex)
                  </label>
                  <Input
                    placeholder={'e.g. https://prod-cdn01-live\\.toffeelive\\.com/[^\\\'"]+\\.m3u8[^\\\'"]*'}
                    value={form.refreshPattern}
                    onChange={(e) => setForm({ ...form, refreshPattern: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Custom regex to locate the m3u8 in the source page HTML. Leave empty to use a generic m3u8 regex.
                  </p>
                </div>
                <div className="md:col-span-2 flex items-center gap-2 pt-1">
                  <Switch
                    checked={form.autoRefresh}
                    onCheckedChange={(checked) => setForm({ ...form, autoRefresh: checked })}
                  />
                  <label className="text-xs font-medium flex items-center gap-1.5">
                    <Zap className="h-3 w-3 text-amber-500" />
                    Enable Auto-Refresh
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    (proactive cron + reactive player fallback will refresh this channel)
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6 md:col-span-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                />
                <label className="text-xs font-medium">Active</label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isFeatured}
                  onCheckedChange={(checked) => setForm({ ...form, isFeatured: checked })}
                />
                <label className="text-xs font-medium">Featured</label>
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="btn-press gap-1.5">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? 'Saving...' : editingId ? 'Update Channel' : 'Create Channel'}
            </Button>
          </div>
        </div>
      )}

      {/* Channels Table */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading channels...</p>
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <Tv className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold mb-1">No channels found</h3>
          <p className="text-xs text-muted-foreground">
            {searchQuery || filterCategory !== 'all'
              ? 'Try adjusting your search or filters.'
              : 'Add your first channel or import from M3U.'}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          {/* Bulk Actions Bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-destructive/5 border-b border-destructive/20">
              <span className="text-xs font-medium text-destructive">{selectedIds.size} selected</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="h-7 text-xs gap-1.5"
              >
                {bulkDeleting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="p-3 w-10">
                    <button onClick={toggleSelectAll} className="p-0.5 rounded hover:bg-secondary transition-colors" title={selectedIds.size === channels.length ? 'Deselect all' : 'Select all'}>
                      {selectedIds.size === channels.length && channels.length > 0 ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Channel</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Category</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Token</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Views</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr key={ch.id} className={`border-t border-border hover:bg-secondary/30 transition-colors ${selectedIds.has(ch.id) ? 'bg-primary/5' : ''}`}>
                    <td className="p-3 w-10">
                      <button onClick={() => toggleSelect(ch.id)} className="p-0.5 rounded hover:bg-secondary transition-colors">
                        {selectedIds.has(ch.id) ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground/50" />
                        )}
                      </button>
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center overflow-hidden shrink-0 p-0.5">
                          {ch.logo ? (
                            <img src={ch.logo} alt="" className="w-full h-full object-contain" />
                          ) : (
                            <Tv className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate text-sm">{ch.name}</p>
                          {ch.isFeatured && <span className="text-[9px] text-amber-600 dark:text-amber-400">★ Featured</span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex flex-wrap gap-1">
                        {parseCategories(ch.category).map((cat, i) => (
                          <Badge key={i} variant="secondary" className={`capitalize text-[10px] h-4 px-1.5 ${i === 0 ? 'bg-primary/10 text-primary' : ''}`}>
                            {cat}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-xs uppercase text-muted-foreground">
                      <div className="flex flex-col gap-1">
                        <span>{ch.streamType}</span>
                        {ch.autoRefresh && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1.5 gap-0.5 border-amber-500/40 text-amber-600 dark:text-amber-400 w-fit">
                            <Zap className="h-2.5 w-2.5" />
                            Auto
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs">
                      <TokenCell channel={ch} />
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleToggleActive(ch)} className="btn-press">
                          {ch.isActive ? (
                            <ToggleRight className="h-5 w-5 text-emerald-500" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                        <span className={`text-xs ${ch.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                          {ch.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      <div
                        className={`flex items-center gap-1 text-xs ${
                          (channelViewers[ch.id] || 0) > 0
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-muted-foreground'
                        }`}
                        title="Real-time viewers watching this channel right now"
                      >
                        <Users className="h-3 w-3" />
                        {(channelViewers[ch.id] || 0).toLocaleString()}
                        {(channelViewers[ch.id] || 0) > 0 && (
                          <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {ch.viewCount.toLocaleString()}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleToggleFeatured(ch)}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press"
                          title={ch.isFeatured ? 'Remove from featured' : 'Add to featured'}
                        >
                          <Star className={`h-3.5 w-3.5 ${ch.isFeatured ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground'}`} />
                        </button>
                        <button
                          onClick={() => handleToggleAutoRefresh(ch)}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press"
                          title={ch.autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh (requires Source Page URL)'}
                        >
                          <Zap className={`h-3.5 w-3.5 ${ch.autoRefresh ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground'}`} />
                        </button>
                        <button
                          onClick={() => handleRefreshChannel(ch, true)}
                          disabled={refreshingId === ch.id || !ch.sourcePageUrl}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press disabled:opacity-30 disabled:cursor-not-allowed"
                          title={ch.sourcePageUrl ? 'Re-extract m3u8 from source page now' : 'Set a Source Page URL first to enable refresh'}
                        >
                          {refreshingId === ch.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                          ) : (
                            <KeyRound className="h-3.5 w-3.5 text-primary" />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(ch)}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors btn-press"
                          title="Edit channel"
                        >
                          <Edit className="h-3.5 w-3.5 text-primary" />
                        </button>
                        {deleteConfirm === ch.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDelete(ch.id)}
                              className="px-2 py-1 rounded-md bg-destructive text-destructive-foreground text-xs btn-press"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-2 py-1 rounded-md bg-secondary text-xs btn-press"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(ch.id)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors btn-press"
                            title="Delete channel"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border text-xs text-muted-foreground text-center">
            Showing {channels.length} channel{channels.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
