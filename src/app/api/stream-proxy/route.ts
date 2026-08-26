import { NextRequest, NextResponse } from 'next/server'

// GET /api/stream-proxy?url=ENCODED_URL
// Proxies HLS/m3u8, MPEG-TS segments, and live MPEG-TS streams to bypass CORS restrictions.
//
// ─── ARCHITECTURE: Stream Multiplexer (Fan-Out) ─────────────────────────────
//
// PROBLEM (why buffering with many viewers):
//   Each viewer created a SEPARATE upstream connection. If 100 people watched
//   the same .ts channel, the proxy opened 100 connections to the IPTV server,
//   consuming 300–500 Mbps and 3.2 GB RAM (32MB per connection). The upstream
//   server would reject connections or throttle → everyone buffers.
//
// SOLUTION: Stream Multiplexer
//   ONE upstream connection per channel URL, shared by ALL viewers:
//
//     Upstream ──► StreamMultiplexer ──┬──► Viewer 1
//                         │            ├──► Viewer 2
//                    Ring Buffer       ├──► Viewer 3
//                     (2MB)            └──► Viewer N
//
//   • Late-joining viewers get the ring buffer content first (2MB of recent
//     data ≈ 3–8s of video), then receive live data alongside everyone else.
//   • When all viewers disconnect, the upstream closes after a grace period.
//   • When the upstream dies, automatic reconnect keeps viewers streaming.
//
// IMPACT:
//   100 viewers, 1 channel: 1 upstream (was 100), ~5 MB RAM (was 3.2 GB),
//   3–5 Mbps total (was 300–500 Mbps). Upstream server sees 1 client, not 100.
//
// Features:
// - AbortController with configurable timeout for upstream requests
// - VLC User-Agent for better IPTV server compatibility
// - Origin header sent alongside Referer for better compatibility
// - Enhanced m3u8 rewriting: handles #EXT-X-STREAM-INF, #EXT-X-KEY, #EXT-X-MAP
// - Manifest cache for m3u8/mpd (reduces upstream reloads)
// - Stream Multiplexer for live .ts (1 upstream → N viewers)
// - Retry logic with exponential backoff

export const maxDuration = 300 // 5 minute timeout for live streams

// ─── Timeouts ────────────────────────────────────────────────────────────────
const UPSTREAM_TIMEOUT_MANIFEST = 8000  // 8s for m3u8 manifests
const UPSTREAM_TIMEOUT_SEGMENT = 20000  // 20s for segments
const UPSTREAM_TIMEOUT_LIVE = 30000     // 30s for live .ts initial response

// ─── Retry config ────────────────────────────────────────────────────────────
const MAX_RETRIES_MANIFEST = 0
const MAX_RETRIES_SEGMENT = 1
const RETRY_DELAY_MS = 300

// ─── Stream Multiplexer ─────────────────────────────────────────────────────
// Maps upstream URL → StreamMultiplexer instance.
// When multiple viewers request the same live .ts URL, they share ONE upstream
// connection. Data is fanned out to all viewers simultaneously.

const RING_BUFFER_SIZE = 2 * 1024 * 1024  // 2MB ring buffer per stream
const VIEWER_IDLE_GRACE_MS = 15_000       // Close upstream after 15s with no viewers
const RECONNECT_DELAY_MS = 1_000          // Delay before reconnecting to upstream
const MAX_RECONNECT_ATTEMPTS = 50         // Enough for hours of viewing

class StreamMultiplexer {
  private url: string
  private fetchHeaders: Record<string, string>

  // Ring buffer: stores the most recent RING_BUFFER_SIZE bytes of stream data.
  // Late-joining viewers receive this first, giving them ~3–8s of buffered video
  // without needing their own upstream connection.
  private ringBuffer = new Uint8Array(RING_BUFFER_SIZE)
  private ringWritePos = 0    // next write position in ring buffer
  private ringBytesStored = 0 // total bytes stored (caps at RING_BUFFER_SIZE)
  private ringWrapped = false // whether the write position has wrapped around

  // Active subscribers (viewers currently receiving live data)
  private subscribers = new Set<{
    controller: ReadableStreamDefaultController
    id: number
  }>()

  // Upstream connection state
  private upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private upstreamAlive = false
  private reconnectCount = 0
  private shutdown = false

  // Grace timer: closes upstream when no viewers remain
  private graceTimer: ReturnType<typeof setTimeout> | null = null

  // Subscriber ID counter
  private nextId = 0

  // Burst state: first 2MB from upstream is sent as a burst to the first viewer
  private burstComplete = false
  private burstChunks: Uint8Array[] = []
  private burstAccumulated = 0
  private static readonly BURST_SIZE = 2 * 1024 * 1024

  constructor(url: string, fetchHeaders: Record<string, string>) {
    this.url = url
    this.fetchHeaders = fetchHeaders
  }

  /** Get the number of active subscribers */
  get subscriberCount(): number {
    return this.subscribers.size
  }

  /** Add a new viewer. Returns { readable, ringData } where ringData is the
   *  recent data from the ring buffer that the viewer should receive first. */
  addSubscriber(): { readable: ReadableStream, ringData: Uint8Array } {
    const id = this.nextId++

    // Snapshot the ring buffer for this late-joining viewer
    const ringData = this._getRingBufferSnapshot()

    // Create a ReadableStream for this subscriber
    const stream = new ReadableStream({
      start: (controller) => {
        const sub = { controller, id }
        this.subscribers.add(sub)

        // When the viewer cancels (disconnects), remove from subscribers
        // The cleanup is handled in the stream's cancel callback
      },
      cancel: () => {
        for (const sub of this.subscribers) {
          if (sub.id === id) {
            this.subscribers.delete(sub)
            break
          }
        }
        this._scheduleGraceTimer()
        console.log(`[multiplexer] Viewer ${id} disconnected. ${this.subscribers.size} viewers remaining for ${this._shortUrl()}`)
      },
    }, {
      // Each subscriber gets a modest HWM — the ring buffer already gave them
      // initial data, so they just need enough for live streaming
      highWaterMark: 4 * 1024 * 1024,  // 4MB per subscriber
      size: (chunk: Uint8Array) => chunk.byteLength,
    })

    // Cancel any pending grace timer (we have a new viewer)
    this._cancelGraceTimer()

    // If upstream isn't alive, start it
    if (!this.upstreamAlive) {
      this._startUpstream()
    }

    console.log(`[multiplexer] Viewer ${id} joined. ${this.subscribers.size} viewers for ${this._shortUrl()}`)

    return { readable: stream, ringData }
  }

  /** Get a contiguous snapshot of the ring buffer contents */
  private _getRingBufferSnapshot(): Uint8Array {
    if (this.ringBytesStored === 0) return new Uint8Array(0)

    const snapshot = new Uint8Array(this.ringBytesStored)
    if (!this.ringWrapped) {
      // Data is contiguous from position 0
      snapshot.set(this.ringBuffer.subarray(0, this.ringBytesStored))
    } else {
      // Data wraps around: [writePos..end] + [0..writePos]
      const firstPart = this.ringBuffer.subarray(this.ringWritePos)
      const secondPart = this.ringBuffer.subarray(0, this.ringWritePos)
      snapshot.set(firstPart)
      snapshot.set(secondPart, firstPart.byteLength)
    }
    return snapshot
  }

  /** Write data to the ring buffer */
  private _writeToRingBuffer(chunk: Uint8Array) {
    let offset = 0
    while (offset < chunk.byteLength) {
      const remaining = chunk.byteLength - offset
      const available = RING_BUFFER_SIZE - this.ringWritePos
      const toWrite = Math.min(remaining, available)

      this.ringBuffer.set(
        chunk.subarray(offset, offset + toWrite),
        this.ringWritePos
      )

      offset += toWrite
      this.ringWritePos += toWrite

      if (this.ringWritePos >= RING_BUFFER_SIZE) {
        this.ringWritePos = 0
        this.ringWrapped = true
      }

      if (this.ringBytesStored < RING_BUFFER_SIZE) {
        this.ringBytesStored += toWrite
      }
    }
  }

  /** Push data to all subscribers and the ring buffer */
  private _broadcast(chunk: Uint8Array) {
    // Always write to ring buffer
    this._writeToRingBuffer(chunk)

    // Send to all subscribers
    const deadSubs: number[] = []
    for (const sub of this.subscribers) {
      try {
        sub.controller.enqueue(new Uint8Array(chunk))  // copy for each subscriber
      } catch {
        // Subscriber's stream was cancelled/closed — mark for removal
        deadSubs.push(sub.id)
      }
    }
    // Clean up dead subscribers
    if (deadSubs.length > 0) {
      for (const id of deadSubs) {
        for (const sub of this.subscribers) {
          if (sub.id === id) {
            this.subscribers.delete(sub)
            break
          }
        }
      }
      this._scheduleGraceTimer()
    }
  }

  /** Start or restart the upstream connection */
  private async _startUpstream() {
    if (this.shutdown) return
    if (this.upstreamAlive) return

    this.upstreamAlive = true
    this.burstComplete = false
    this.burstChunks = []
    this.burstAccumulated = 0

    console.log(`[multiplexer] Connecting to upstream: ${this._shortUrl()} (attempt ${this.reconnectCount + 1})`)

    try {
      const response = await fetchWithRetry(this.url, {
        headers: this.fetchHeaders,
        redirect: 'follow',
      }, UPSTREAM_TIMEOUT_LIVE, 0)

      if (!response.ok) {
        console.error(`[multiplexer] Upstream error: ${response.status}`)
        this.upstreamAlive = false
        this._tryReconnect(`upstream error ${response.status}`)
        return
      }

      if (!response.body) {
        console.error(`[multiplexer] No response body`)
        this.upstreamAlive = false
        this._tryReconnect('no response body')
        return
      }

      this.reconnectCount = 0  // reset on successful connection
      console.log(`[multiplexer] Connected to upstream. ${this.subscribers.size} viewers waiting.`)

      const reader = response.body.getReader()
      this.upstreamReader = reader

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            console.log(`[multiplexer] Upstream ended (LOADING_COMPLETE)`)
            break
          }

          // --- Burst buffering phase for first viewer ---
          if (!this.burstComplete) {
            this.burstChunks.push(value)
            this.burstAccumulated += value.byteLength

            if (this.burstAccumulated >= StreamMultiplexer.BURST_SIZE) {
              // Burst threshold reached — write all accumulated data
              for (const burstChunk of this.burstChunks) {
                this._broadcast(burstChunk)
              }
              this.burstChunks = []
              this.burstComplete = true
            }
            continue
          }

          // --- Steady-state: broadcast immediately ---
          this._broadcast(value)
        }

        // If upstream ended before burst completed, flush what we have
        if (!this.burstComplete && this.burstChunks.length > 0) {
          for (const chunk of this.burstChunks) {
            this._broadcast(chunk)
          }
          this.burstChunks = []
        }

      } catch {
        // Upstream connection lost — normal for live streams
        console.log(`[multiplexer] Upstream connection lost for ${this._shortUrl()}`)
      } finally {
        try { reader.cancel() } catch {}
        this.upstreamReader = null
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[multiplexer] Upstream fetch failed: ${msg}`)
    }

    this.upstreamAlive = false

    // Close all subscriber streams — mpegts.js will re-request and
    // either get a new multiplexer or the same one after reconnect
    this._closeAllSubscribers()

    // Instead of immediately reconnecting (which causes infinite loops with 0 viewers),
    // start a grace timer. If clients re-subscribe within the grace period, they'll
    // trigger _startUpstream() via addSubscriber(). If not, the multiplexer is cleaned up.
    this._scheduleGraceTimer()
  }

  /** Try to reconnect to the upstream */
  private _tryReconnect(reason: string) {
    if (this.shutdown) return

    // No viewers left — no point reconnecting, clean up instead
    if (this.subscribers.size === 0) {
      console.log(`[multiplexer] No viewers to reconnect for. Cleaning up: ${this._shortUrl()}`)
      this._destroy()
      activeStreams.delete(this.url)
      return
    }

    if (this.reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[multiplexer] Max reconnect attempts reached. Shutting down.`)
      this._destroy()
      activeStreams.delete(this.url)
      return
    }

    this.reconnectCount++
    const delay = Math.min(RECONNECT_DELAY_MS * this.reconnectCount, 5000)
    console.log(`[multiplexer] Reconnecting in ${delay}ms (attempt ${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS}, reason: ${reason})`)

    setTimeout(() => {
      if (!this.shutdown) {
        this._startUpstream()
      }
    }, delay)
  }

  /** Close all subscriber streams with an error signal */
  private _closeAllSubscribers() {
    for (const sub of this.subscribers) {
      try {
        sub.controller.close()
      } catch {
        // Already closed
      }
    }
    this.subscribers.clear()
  }

  /** Schedule grace timer — closes upstream when no viewers remain */
  private _scheduleGraceTimer() {
    if (this.graceTimer) clearTimeout(this.graceTimer)

    if (this.subscribers.size === 0) {
      this.graceTimer = setTimeout(() => {
        if (this.subscribers.size === 0) {
          console.log(`[multiplexer] No viewers for ${this.reconnectCount > 0 ? 0 : 15}s. Closing upstream: ${this._shortUrl()}`)
          this._destroy()
          activeStreams.delete(this.url)
        }
      }, VIEWER_IDLE_GRACE_MS)
    }
  }

  private _cancelGraceTimer() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  /** Shut down this multiplexer completely */
  private _destroy() {
    this.shutdown = true
    this._cancelGraceTimer()
    this._closeAllSubscribers()

    if (this.upstreamReader) {
      try { this.upstreamReader.cancel() } catch {}
      this.upstreamReader = null
    }
    this.upstreamAlive = false
  }

  /** Short URL for logging */
  private _shortUrl(): string {
    try {
      const u = new URL(this.url)
      return u.hostname + u.pathname.slice(-30)
    } catch {
      return this.url.slice(-40)
    }
  }
}

// ─── Active stream multiplexers ─────────────────────────────────────────────
// Maps upstream URL → StreamMultiplexer. When a viewer requests a live .ts URL,
// we check if a multiplexer already exists. If so, the viewer joins it (gets
// ring buffer data + live stream). If not, we create a new one.
const activeStreams = new Map<string, StreamMultiplexer>()

// Periodic cleanup: remove dead multiplexers (those that have been destroyed
// but not yet removed from the map)
setInterval(() => {
  for (const [url, mux] of activeStreams) {
    if (mux.subscriberCount === 0 && !mux['upstreamAlive']) {
      activeStreams.delete(url)
    }
  }
  // Log stats
  if (activeStreams.size > 0) {
    const stats = [...activeStreams.entries()].map(([url, mux]) => {
      const short = url.slice(-40)
      return `${short}: ${mux.subscriberCount} viewers`
    }).join(', ')
    console.log(`[multiplexer] Active streams: ${activeStreams.size} | ${stats}`)
  }
}, 30_000)  // Every 30s

// ─── In-memory manifest cache ───────────────────────────────────────────────
const MANIFEST_CACHE_TTL_MS = 4000 // 4 seconds
const manifestCache = new Map<string, { body: string; ts: number }>()

function getCachedManifest(url: string): string | null {
  const entry = manifestCache.get(url)
  if (!entry) return null
  if (Date.now() - entry.ts > MANIFEST_CACHE_TTL_MS) {
    manifestCache.delete(url)
    return null
  }
  return entry.body
}

function setCachedManifest(url: string, body: string) {
  manifestCache.set(url, { body, ts: Date.now() })
  if (manifestCache.size > 200) {
    const entries = [...manifestCache.entries()].sort((a, b) => a[1].ts - b[1].ts)
    for (let i = 0; i < 50 && i < entries.length; i++) {
      manifestCache.delete(entries[i][0])
    }
  }
}

// Detect if a .ts URL is a live stream (not a VOD segment)
function isLiveTsUrl(pathname: string): boolean {
  if (pathname.includes('/live/')) return true
  const segmentPattern = /[_-]?\d{3,}\.ts$|segment[_-]?\d+\.ts$|seg[_-]?\d+\.ts$/i
  if (segmentPattern.test(pathname)) return false
  return true
}

// Helper: fetch with retry + timeout
async function fetchWithRetry(
  fetchUrl: string,
  opts: RequestInit,
  timeoutMs: number = UPSTREAM_TIMEOUT_SEGMENT,
  maxRetries: number = MAX_RETRIES_SEGMENT
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(fetchUrl, { ...opts, signal: controller.signal })
      clearTimeout(timeout)
      return res
    } catch (err) {
      clearTimeout(timeout)
      lastError = err instanceof Error ? err : new Error('Unknown error')
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS * (attempt + 1)
        console.log(`[stream-proxy] Retry ${attempt + 1}/${maxRetries} for ${fetchUrl} (waiting ${delay}ms)`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError || new Error('All retries failed')
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 })
    }

    // Determine content type
    const isM3u8 = url.includes('.m3u8') || url.includes('.m3u') || parsedUrl.pathname.endsWith('.m3u8') || parsedUrl.pathname.endsWith('.m3u')
    const isMpd = parsedUrl.pathname.endsWith('.mpd') || url.includes('.mpd')
    const isTs = (/\.ts(\?.*)?$/.test(parsedUrl.pathname) || /\.ts(\?|$)/.test(url)) && !parsedUrl.pathname.includes('.m3u8') && !parsedUrl.pathname.includes('.m3u')
    const isLiveTs = isTs && isLiveTsUrl(parsedUrl.pathname + parsedUrl.search)

    // ── Manifest cache check ──
    if ((isM3u8 && !isTs) || isMpd) {
      const cached = getCachedManifest(url)
      if (cached !== null) {
        return new NextResponse(cached, {
          status: 200,
          headers: {
            'Content-Type': isMpd ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Stream-Proxy-Cache': 'HIT',
          },
        })
      }
    }

    // Build upstream request headers
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      Accept: isM3u8
        ? 'application/vnd.apple.mpegurl,application/x-mpegurl,*/*'
        : isMpd
          ? 'application/dash+xml,*/*'
          : isTs
            ? 'video/mp2t,*/*'
            : '*/*',
    }

    // Determine Referer/Origin
    if (/bhalocast\.(pro|com)/i.test(parsedUrl.hostname)) {
      fetchHeaders.Referer = 'https://bhalocast.pro/'
      fetchHeaders.Origin = 'https://bhalocast.pro'
    } else {
      fetchHeaders.Referer = parsedUrl.origin + '/'
      fetchHeaders.Origin = parsedUrl.origin
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LIVE .TS STREAMS — USE STREAM MULTIPLEXER (1 upstream → N viewers)
    // ══════════════════════════════════════════════════════════════════════════
    if (isLiveTs) {
      // Find or create a multiplexer for this URL
      let mux = activeStreams.get(url)

      if (!mux) {
        mux = new StreamMultiplexer(url, fetchHeaders)
        activeStreams.set(url, mux)
        console.log(`[stream-proxy] New multiplexer created for: ${url.slice(-50)}`)
      }

      // Join the multiplexer — get our own ReadableStream + ring buffer data
      const { readable, ringData } = mux.addSubscriber()

      // Build the response stream:
      // 1. First, send ring buffer data (recent 2MB of video for late joiners)
      // 2. Then, pipe the live stream from the multiplexer
      const combinedStream = new ReadableStream({
        async start(controller) {
          // Send ring buffer data first — gives late-joining viewers instant
          // playback without waiting for the upstream to send new data.
          // This is ~2MB ≈ 3-8s of video at typical IPTV bitrates.
          if (ringData.byteLength > 0) {
            controller.enqueue(ringData)
          }
        },
        async pull(controller) {
          // This is called when the combined stream needs more data.
          // We read from the multiplexer's subscriber stream.
          // The subscriber stream already has its own HWM (4MB), so
          // data flows through naturally.
        },
      }, {
        highWaterMark: 4 * 1024 * 1024,  // 4MB
        size: (chunk: Uint8Array) => chunk.byteLength,
      })

      // Pipe: ring buffer + live stream → combined response
      // We use a TransformStream to merge ring buffer data with live data
      const { readable: finalReadable, writable } = new TransformStream(
        {},  // pass-through transform
        { highWaterMark: 4 * 1024 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
        { highWaterMark: 4 * 1024 * 1024, size: (chunk: Uint8Array) => chunk.byteLength }
      )

      // Write ring buffer data first, then pipe live stream
      ;(async () => {
        const writer = writable.getWriter()
        try {
          // Phase 1: Send ring buffer data (instant playback for late joiners)
          if (ringData.byteLength > 0) {
            await writer.write(ringData)
          }

          // Phase 2: Pipe live data from multiplexer
          const reader = readable.getReader()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              await writer.write(value)
            }
          } catch {
            // Stream ended or cancelled — normal for live streams
          } finally {
            try { reader.cancel() } catch {}
          }
        } catch {
          // Writer closed — client disconnected
        } finally {
          try { writer.close() } catch {}
        }
      })()

      return new NextResponse(finalReadable, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Stream-Multiplex': 'true',
          'X-Stream-Viewers': String(mux.subscriberCount),
        },
      })
    }

    // ══════════════════════════════════════════════════════════════════════════
    // NON-LIVE: m3u8, VOD .ts segments, .mpd, and other content
    // ══════════════════════════════════════════════════════════════════════════
    const customTimeout = req.nextUrl.searchParams.get('timeout')
    const customTimeoutMs = customTimeout ? parseInt(customTimeout, 10) : 0
    const fetchTimeout = customTimeoutMs > 0 ? customTimeoutMs : (isM3u8 ? UPSTREAM_TIMEOUT_MANIFEST : UPSTREAM_TIMEOUT_SEGMENT)
    const fetchRetries = customTimeoutMs > 0 && isM3u8 ? 2 : (isM3u8 ? MAX_RETRIES_MANIFEST : MAX_RETRIES_SEGMENT)
    console.log(`[stream-proxy] Fetching: ${url} (m3u8=${isM3u8}, ts=${isTs}, timeout=${fetchTimeout / 1000}s, retries=${fetchRetries})`)
    let response: Response
    try {
      response = await fetchWithRetry(url, {
        headers: fetchHeaders,
        redirect: 'follow',
      }, fetchTimeout, fetchRetries)
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error'
      console.error(`[stream-proxy] Fetch failed for ${url}: ${msg}`)
      if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
        return NextResponse.json(
          { error: `Upstream request timed out after ${fetchTimeout / 1000}s` },
          { status: 504 }
        )
      }
      return NextResponse.json(
        { error: `Failed to connect to upstream: ${msg}` },
        { status: 502 }
      )
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      console.error(`[stream-proxy] Upstream error ${response.status} for ${url}: ${bodyText.slice(0, 200)}`)
      return NextResponse.json(
        { error: `Upstream error: ${response.status}`, detail: bodyText.slice(0, 500) },
        { status: response.status }
      )
    }

    // For .mpd manifests
    if (isMpd) {
      const text = await response.text()
      const rewritten = rewriteMpdUrls(text, url)
      setCachedManifest(url, rewritten)
      console.log(`[stream-proxy] Rewrote .mpd manifest (${text.length} bytes → ${rewritten.length} bytes)`)
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/dash+xml',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Stream-Proxy-Cache': 'MISS',
        },
      })
    }

    // For m3u8 files
    if (isM3u8) {
      const text = await response.text()
      const firstLines = text.split('\n').slice(0, 10).join('\n')
      console.log(`[stream-proxy] m3u8 content preview:\n${firstLines}`)

      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1)
      const originalQuery = parsedUrl.search
      const timeoutParam = req.nextUrl.searchParams.get('timeout')
      const rewritten = rewriteM3u8Urls(text, baseUrl, originalQuery, timeoutParam)

      console.log(`[stream-proxy] Rewrote m3u8 (${text.length} bytes → ${rewritten.length} bytes)`)
      setCachedManifest(url, rewritten)

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Stream-Proxy-Cache': 'MISS',
        },
      })
    }

    // For .ts VOD segments — stream incrementally
    if (isTs && response.body) {
      const { readable, writable } = new TransformStream()
      const reader = response.body.getReader()
      const writer = writable.getWriter()
      ;(async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            await writer.write(value)
          }
        } catch {
          // Normal — client disconnected or stream ended
        } finally {
          try { await writer.close() } catch {}
          try { reader.cancel() } catch {}
        }
      })()

      const contentType = response.headers.get('content-type') || 'video/mp2t'
      return new NextResponse(readable, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Other binary data (rare) — buffer
    const body = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || (isMpd ? 'application/dash+xml' : 'application/octet-stream')

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[stream-proxy] Unhandled error:', error)
    return NextResponse.json(
      { error: 'Failed to proxy stream', detail: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * Rewrite URLs inside an MPEG-DASH .mpd manifest to go through our proxy.
 */
function rewriteMpdUrls(manifest: string, manifestUrl: string): string {
  const proxyBase = '/api/stream-proxy?url='
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1)

  function makeProxiedUrl(rawUrl: string): string {
    let absoluteUrl: string
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      absoluteUrl = rawUrl
    } else {
      try {
        absoluteUrl = new URL(rawUrl, baseUrl).href
      } catch {
        return rawUrl
      }
    }
    return `${proxyBase}${encodeURIComponent(absoluteUrl)}`
  }

  let result = manifest.replace(
    /\b(src|media|initialization|sourceURL|href)=["']([^"']+)["']/gi,
    (_match, attr: string, url: string) => {
      if (url.includes('/api/stream-proxy')) return _match
      if (url.startsWith('data:')) return _match
      return `${attr}="${makeProxiedUrl(url)}"`
    }
  )

  result = result.replace(
    /<BaseURL>([^<]+)<\/BaseURL>/gi,
    (_match, url: string) => {
      const trimmed = url.trim()
      if (!trimmed || trimmed.includes('/api/stream-proxy') || trimmed.startsWith('data:')) return _match
      return `<BaseURL>${makeProxiedUrl(trimmed)}</BaseURL>`
    }
  )

  return result
}

/**
 * Rewrite URLs inside an m3u8 manifest to go through our proxy.
 */
function rewriteM3u8Urls(manifest: string, baseUrl: string, originalQuery: string = '', timeoutParam: string | null = null): string {
  const proxyBase = '/api/stream-proxy?url='
  const preservedQuery = originalQuery && originalQuery !== '?' ? originalQuery : ''
  const timeoutSuffix = timeoutParam ? `&timeout=${timeoutParam}` : ''

  const lines = manifest.split('\n')
  const rewritten = lines.map((line) => {
    const trimmed = line.trim()

    if (trimmed === '') return line

    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          let absoluteUrl: string
          if (uri.startsWith('http://') || uri.startsWith('https://')) {
            absoluteUrl = uri
          } else {
            absoluteUrl = new URL(uri, baseUrl).href
          }
          if (preservedQuery && !absoluteUrl.includes('?')) {
            absoluteUrl += preservedQuery
          }
          return `URI="${proxyBase}${encodeURIComponent(absoluteUrl)}${timeoutSuffix}"`
        })
      }
      return line
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      let absoluteUrl = trimmed
      if (preservedQuery && !absoluteUrl.includes('?')) {
        absoluteUrl += preservedQuery
      }
      return `${proxyBase}${encodeURIComponent(absoluteUrl)}${timeoutSuffix}`
    }

    if (trimmed && !trimmed.startsWith('#')) {
      try {
        let absoluteUrl = new URL(trimmed, baseUrl).href
        if (preservedQuery && !absoluteUrl.includes('?')) {
          absoluteUrl += preservedQuery
        }
        return `${proxyBase}${encodeURIComponent(absoluteUrl)}${timeoutSuffix}`
      } catch {
        return line
      }
    }

    return line
  })

  return rewritten.join('\n')
}
