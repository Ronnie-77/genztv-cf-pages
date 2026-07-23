'use strict';

/**
 * StreamPlayer — Production-Grade Live Streaming Video Player
 * Version: 2.0.0
 *
 * Stream Type Support:
 *   • M3U/HLS          — Standard HLS (.m3u8) via hls.js / Safari native
 *   • M3U/HLS Proxy    — Proxied HLS with custom headers / CORS bypass
 *   • MPEG-TS (.ts)    — Raw transport stream, transmuxed via hls.js MediaSource
 *   • DASH (.mpd)      — MPEG-DASH adaptive streaming via dash.js
 *
 * Features:
 *   • Zero-buffer aggressive pre-loading strategy
 *   • CDN failover (pass multiple URLs)
 *   • Stall watchdog with 3-stage auto-recovery
 *   • Adaptive quality selection (Auto ABR + manual)
 *   • iOS Safari native fullscreen via webkitEnterFullscreen
 *   • Keyboard shortcuts
 *   • ARIA accessibility
 *
 * Dependency: hls.js >= 1.4.x (imported as a module below)
 */

import Hls from 'hls.js';

// ─── mpegts.js dynamic loader (avoids SSR issues) ───────────────────────────
// mpegts.js uses `window` at import time, so we load it lazily on the client.
// This is the SAME library the old TsPlayer used — it's purpose-built for live
// .ts transport streams and handles infinite/live streams correctly (unlike
// hls.js which expects finite VOD fragments).
let _mpegtsLib = null;
async function _loadMpegtsLib() {
  if (!_mpegtsLib) {
    const mod = await import('mpegts.js');
    _mpegtsLib = mod.default || mod;
  }
  return _mpegtsLib;
}

// ─── dash.js dynamic loader (avoids SSR + Turbopack exports-field issues) ────
// dash.js is the reference player for MPEG-DASH (.mpd) adaptive streaming.
// It handles MPD manifest parsing, segment fetching, ABR switching, and (when
// configured) DRM via EME (Widevine/PlayReady/ClearKey).
//
// WHY WE LOAD VIA <script> TAG INSTEAD OF `import 'dashjs'`:
// dash.js accesses `window`/`document` at import time AND its package.json
// uses a complex `exports` field with multiple conditions (import/browser/
// require/script) that Turbopack in Next.js 16 fails to resolve, producing a
// misleading "Module not found: Can't resolve 'dashjs'" error. Even importing
// the direct bundle path 'dashjs/dist/modern/esm/dash.all.min.js' fails
// because Turbopack respects the `exports` field and blocks subpath access.
//
// SOLUTION: The UMD bundle (dash.all.min.js) is copied to /public at build
// time and loaded here by injecting a <script> tag. The UMD bundle attaches
// itself to `window.dashjs` (via `self.dashjs = factory()`). This completely
// bypasses Turbopack's module resolution — the script is served as a static
// asset and executed in the browser only when a DASH stream is first
// requested. Lazy-loaded, so it adds zero cost to non-DASH playback.
let _dashLib = null;
let _dashScriptPromise = null;
async function _loadDashLib() {
  if (_dashLib) return _dashLib;
  if (typeof window === 'undefined') return null; // SSR guard

  // If window.dashjs is already set (script previously loaded), use it.
  if (window.dashjs) {
    _dashLib = window.dashjs;
    return _dashLib;
  }

  // Inject the UMD script tag once. Cache the promise so concurrent calls
  // share a single script-load attempt.
  if (!_dashScriptPromise) {
    _dashScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/dash.all.min.js';
      script.async = true;
      script.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = (window).dashjs;
        if (lib) {
          _dashLib = lib;
          resolve(lib);
        } else {
          _dashScriptPromise = null; // allow retry
          reject(new Error('dashjs global not found after script load'));
        }
      };
      script.onerror = () => {
        _dashScriptPromise = null; // allow retry on failure
        reject(new Error('Failed to load dashjs script from /dash.all.min.js'));
      };
      document.head.appendChild(script);
    });
  }

  return _dashScriptPromise;
}

// TypeScript declaration for the global dashjs object injected by the UMD
// bundle. The real dashjs MediaPlayer API is quite large — we only need the
// `.MediaPlayer()` factory here, so we declare a minimal type. Downstream
// code accesses the player via `dashLib.MediaPlayer().create()`.
declare global {
  interface Window {
    dashjs?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      MediaPlayer: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Debug: any;
      [key: string]: unknown;
    };
  }
}

// ─── Stream type constants ───────────────────────────────────────────────────
const SP_TYPE = {
  HLS:       'hls',       // M3U/HLS  → hls.js or Safari native
  HLS_PROXY: 'hls-proxy', // M3U/HLS Proxy → hls.js with proxy headers
  MPEGTS:    'mpegts',    // MPEG-TS (.ts) → hls.js transmux via Blob M3U8
  DASH:      'dash',      // MPEG-DASH (.mpd) → dash.js
};

// ─── HLS config presets per stream type ─────────────────────────────────────
//
// LATENCY TUNING RATIONALE:
//   The hls.js `fragLoadingTimeOut` MUST be greater than the proxy's
//   `UPSTREAM_TIMEOUT_SEGMENT` (15s) + retry delay (300ms). Otherwise hls.js
//   times out BEFORE the proxy gives up, triggering a duplicate concurrent
//   upstream fetch — wasting bandwidth and making the stream appear "stuck".
//   We set fragLoadingTimeOut=20000 to stay above the proxy's 15s ceiling.
//
//   Manifest timeouts are kept tight (5s) so dead streams fail fast — the
//   user sees an error in ~10s instead of ~48s (old config: 8s × 2 retries ×
//   2 layers = 32s+ worst case).
//
//   Proxy streams get a LARGER forward buffer (maxBufferLength=12) because
//   each segment fetch goes browser→our server→upstream→our server→browser,
//   adding 100-500ms per segment. A larger buffer absorbs these latency
//   spikes and prevents rebuffer-stutter during playback.
//
// FAST-START TUNING (Task 22):
//   The #1 cause of "m3u8 plays late" was liveSyncDurationCount=2. For a
//   6s segment, hls.js waits for ~12s of buffered content before reaching
//   the live-sync position and starting playback. Dropping to 1 saves ~6s
//   on the first frame for LIVE m3u8 streams.
//   maxBufferLength was also dropped (10→6 direct, 20→12 proxy) so hls.js
//   fills its initial buffer faster — combined with startLevel=0 + no
//   bandwidth probe + progressive parsing, first-frame now happens after
//   ONE fragment download instead of two.
const HLS_CONFIG = {
  base: {
    enableWorker:                true,
    enableFetch:                 true,     // use fetch API (lower latency than XHR)
    // ── Fast-start buffer (smaller = quicker first frame) ──
    maxBufferLength:             6,         // was 10 — fill initial buffer faster
    maxMaxBufferLength:          20,        // was 30 — cap growth lower
    maxBufferSize:               18 * 1000 * 1000,
    maxBufferHole:               0.5,
    backBufferLength:            20,        // keep memory lean on live
    // ── Live sync — 3 segments behind edge for stability ──
    // was 1 — too close to live edge, any jitter caused buffer underrun.
    // With 3 segments (~6–18s), the player absorbs proxy jitter gracefully.
    liveSyncDurationCount:       3,         // was 1 — more stable for live streams
    liveMaxLatencyDurationCount: 8,         // was 4 — more headroom before catch-up
    // ── ABR — start low & ramp up (no bandwidth probe) ──
    startLevel:                  0,         // start at lowest level for instant playback
    testBandwidth:               false,     // skip ABR probing phase
    abrEwmaFastLive:             3.0,
    abrEwmaSlowLive:             9.0,
    abrBandWidthFactor:          0.95,
    abrBandWidthUpFactor:        0.65,
    // ── Progressive + prefetch = parse frag while downloading ──
    startFragPrefetch:           true,
    progressive:                 true,
    // ── Frag loading — MUST be > proxy UPSTREAM_TIMEOUT_SEGMENT (15s) ──
    // was 10000 — too low, caused duplicate concurrent fetches when proxy
    // was still fetching and hls.js already gave up + retried.
    fragLoadingTimeOut:          20000,
    fragLoadingMaxRetry:         2,         // was 3 — fail faster, let stall watchdog recover
    fragLoadingRetryDelay:       500,
    fragLoadingMaxRetryTimeout:  20000,
    // ── Manifest — fail fast (5s × 1 retry = 10s max, was 8s × 2 = 24s) ──
    manifestLoadingTimeOut:      5000,      // was 8000
    manifestLoadingMaxRetry:     1,         // was 2
    manifestLoadingRetryDelay:   400,
    // ── Level — fail fast ──
    levelLoadingTimeOut:         5000,      // was 8000
    levelLoadingMaxRetry:        1,         // was 2
    // ── Stall nudge ──
    nudgeMaxRetry:               8,
    nudgeOffset:                 0.2,
    // ── Low latency off by default (most streams are not LL-HLS) ──
    lowLatencyMode:              false,
    // ── Live duration = Infinity (proper live handling, avoids duration-change stalls) ──
    liveDurationInfinity:        true,
    // ── Start at live edge ──
    startPosition:               -1,
    autoStartLoad:               true,
  },

  // PROXY variant — slightly larger buffer than direct to absorb proxy-segment
  // latency spikes (100-500ms per segment overhead), but still tuned for
  // fast first-frame. Was 20s — too much initial wait.
  proxy: {
    enableWorker:                true,
    enableFetch:                 true,
    maxBufferLength:             12,        // was 20 — faster initial fill, still absorbs proxy lag
    maxMaxBufferLength:          30,        // was 60 — cap growth lower
    maxBufferSize:               36 * 1000 * 1000,
    maxBufferHole:               0.5,
    backBufferLength:            20,
    liveSyncDurationCount:       3,         // was 1 — 3 segments behind edge for stability
    liveMaxLatencyDurationCount: 8,         // was 4 — more headroom before catch-up
    startLevel:                  0,
    testBandwidth:               false,
    abrEwmaFastLive:             3.0,
    abrEwmaSlowLive:             9.0,
    abrBandWidthFactor:          0.95,
    abrBandWidthUpFactor:        0.65,
    startFragPrefetch:           true,
    progressive:                 true,
    fragLoadingTimeOut:          20000,     // > proxy's 15s segment timeout
    fragLoadingMaxRetry:         3,         // was 4 — fail faster, stall watchdog recovers
    fragLoadingRetryDelay:       500,
    fragLoadingMaxRetryTimeout:  20000,
    manifestLoadingTimeOut:      5000,      // match proxy manifest timeout
    manifestLoadingMaxRetry:     1,
    manifestLoadingRetryDelay:   400,
    levelLoadingTimeOut:         5000,
    levelLoadingMaxRetry:        1,
    nudgeMaxRetry:               8,
    nudgeOffset:                 0.2,
    lowLatencyMode:              false,
    liveDurationInfinity:        true,
    startPosition:               -1,
    autoStartLoad:               true,
  },

  // MPEG-TS: single segment, no ABR, large buffer for stable ongoing playback
  // but smaller initial buffer for fast first-frame.
  mpegts: {
    enableWorker:                true,
    maxBufferLength:             20,        // was 60 — faster initial playback
    maxMaxBufferLength:          60,
    maxBufferSize:               60 * 1000 * 1000,
    maxBufferHole:               1.0,
    liveSyncDurationCount:       3,        // was 1 — 3 segments behind edge absorbs proxy jitter
    liveMaxLatencyDurationCount: 8,        // was 5 — more headroom before catch-up
    fragLoadingTimeOut:          15000,     // was 30000
    fragLoadingMaxRetry:         4,         // was 10
    fragLoadingRetryDelay:       1000,      // was 2000
    manifestLoadingTimeOut:      8000,      // was 10000
    manifestLoadingMaxRetry:     2,         // was 3
    levelLoadingTimeOut:         8000,
    levelLoadingMaxRetry:        2,
    nudgeMaxRetry:               10,
    nudgeOffset:                 0.5,
    lowLatencyMode:              false,
    startPosition:               -1,
    startFragPrefetch:           true,
    progressive:                 true,
    // Transmux TS → fMP4
    forceKeyFrameOnDiscontinuity: true,
  },
};

// ─── Main Class ──────────────────────────────────────────────────────────────

class StreamPlayer {
  /**
   * @param {string|HTMLElement} container
   * @param {object}             options
   */
  constructor(container, options = {}) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) throw new Error('[StreamPlayer] Container not found: ' + container);

    this._opts = Object.assign({
      streamUrls:     [],       // string[] — multiple = CDN failover
      streamType:     SP_TYPE.HLS, // SP_TYPE.*
      proxyUrl:       '',       // prefix for HLS_PROXY, e.g. 'https://proxy.example.com/?url='
      autoplay:       true,
      muted:          true,
      defaultQuality: -1,       // -1 = Auto
      lowLatency:     false,
      poster:         '',
      title:          '',
      showTitle:      false,
      accentColor:    '#e63946',
      debug:          false,
      hlsConfig:      {},
    }, options);

    // State
    this._hls             = null;
    this._mpegtsPlayer    = null; // mpegts.js player instance (for .ts streams)
    this._dashPlayer      = null; // dash.js player instance (for .mpd streams)
    this._levels          = [];
    this._currentQuality  = this._opts.defaultQuality;
    this._urlIndex        = 0;
    this._isLive          = true;
    this._atLiveEdge      = false;
    this._volume          = 1.0;
    this._muted           = this._opts.muted;
    this._playing         = false;
    this._stalled         = false;
    this._stallTimer      = null;
    this._watchdogTimer   = null;
    this._lastTime        = 0;
    this._lastTimeAt      = 0;
    this._retryCount      = 0;
    this._maxRetries      = 6;
    this._hideTimer       = null;
    this._qualityOpen     = false;
    this._userHidden      = false; // true when user clicked to hide (desktop)
    this._listeners       = {};
    this._videoHandlers   = [];
    this._blobUrls        = []; // track for cleanup
    this._destroyed       = false;
    this._mpegtsNoVideoTimer = null; // MPEG-2/unsupported codec detection
    this._videoErrorRetries = 0;     // Auto-retry counter for transient video errors

    this._build();
    this._bindKeys();

    // Start the initial auto-hide timer so controls hide after 3s even if
    // the user never interacts with the player (e.g. autoplay stream).
    this._scheduleHide();

    if (this._opts.streamUrls.length) this.init(this._opts);
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  get _url() {
    const urls = this._opts.streamUrls;
    return urls[Math.min(this._urlIndex, urls.length - 1)] || '';
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────────

  /**
   * Load a new stream.
   * @param {object} opts — same shape as constructor options
   */
  init(opts = {}) {
    if (opts.streamUrls)  this._opts.streamUrls  = opts.streamUrls;
    if (opts.streamType)  this._opts.streamType  = opts.streamType;
    if (opts.proxyUrl)    this._opts.proxyUrl     = opts.proxyUrl;

    this._retryCount = 0;
    this._urlIndex   = 0;
    this._hideError();
    this._showSpinner();
    this._hideBigPlay();

    this._startLoad();
  }

  play()         { this._video.play().catch(() => {}); }
  pause()        { this._video.pause(); }
  togglePlay()   { this._video.paused ? this.play() : this.pause(); }
  toggleMute()   { this._video.muted = !this._video.muted; }

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this._video.volume = v;
    if (v > 0) this._video.muted = false;
  }

  setQuality(levelIndex) { this._applyQuality(levelIndex); }

  goLive() {
    if (this._hls && this._hls.liveSyncPosition) {
      this._video.currentTime = this._hls.liveSyncPosition;
    }
    this.play();
    this._setAtLiveEdge(true);
  }

  toggleFullscreen() {
    const video   = this._video;
    const wrapper = this._els.wrapper;
    const isIPhone = /iPhone/i.test(navigator.userAgent) && !/iPad/i.test(navigator.userAgent);

    // ── iPhone: always use webkitEnterFullscreen on the video element ──
    // iPhone's native video fullscreen player automatically supports landscape
    // orientation (when the device is rotated). Element fullscreen (requestFullscreen)
    // on iPhone does NOT rotate and does NOT lock orientation, so the video stays
    // in portrait — which is the bug users reported.
    // webkitEnterFullscreen uses iOS's native AVPlayer fullscreen which handles
    // rotation properly.
    if (isIPhone && typeof video.webkitEnterFullscreen === 'function') {
      if (video.webkitDisplayingFullscreen) {
        video.webkitExitFullscreen();
      } else {
        video.webkitEnterFullscreen();
      }
      return;
    }

    // ── Older iOS / Safari without fullscreenEnabled ──
    if (typeof video.webkitEnterFullscreen === 'function' &&
        !document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
      if (video.webkitDisplayingFullscreen) {
        video.webkitExitFullscreen();
      } else {
        video.webkitEnterFullscreen();
      }
      return;
    }

    // ── Standard browsers (Android, desktop, iPad) ──
    const fsEl  = document.fullscreenElement || document.webkitFullscreenElement;
    const reqFs = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
    const exFs  = document.exitFullscreen   || document.webkitExitFullscreen;

    // Try to lock landscape orientation after entering fullscreen.
    // This is the key fix for Android — screen.orientation.lock('landscape')
    // forces the device into landscape mode while in fullscreen.
    // Only works when the document is in fullscreen mode.
    // Silently fails on desktop (where orientation lock isn't needed).
    const tryLockLandscape = () => {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {
          // Orientation lock can fail if: not in fullscreen, not supported
          // (desktop/iPhone), or user has rotation lock enabled. Ignore.
        });
      }
    };
    const tryUnlockOrientation = () => {
      if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        try { screen.orientation.unlock(); } catch (e) {}
      }
    };

    if (fsEl) {
      exFs.call(document);
      tryUnlockOrientation();
    } else if (reqFs) {
      const result = reqFs.call(wrapper);
      if (result && typeof result.then === 'function') {
        result.then(tryLockLandscape).catch(() => {
          // Fallback: try on video element directly (some Android browsers)
          const vReq = video.requestFullscreen || video.webkitRequestFullscreen;
          if (vReq) {
            const vResult = vReq.call(video);
            if (vResult && typeof vResult.then === 'function') {
              vResult.then(tryLockLandscape).catch(() => {});
            }
          }
        });
      }
    }
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    return this;
  }

  off(event, cb) {
    if (this._listeners[event])
      this._listeners[event] = this._listeners[event].filter(f => f !== cb);
  }

  destroy() {
    this._destroyed = true;
    this._stopWatchdog();
    clearTimeout(this._stallTimer);
    clearTimeout(this._hideTimer);
    clearTimeout(this._userHiddenTimer);
    clearTimeout(this._mpegtsNoVideoTimer);
    this._destroyHls();
    this._destroyMpegts();
    this._destroyDash();
    this._revokeBlobs();
    this._videoHandlers.forEach(({ e, fn }) => this._video.removeEventListener(e, fn));
    this._videoHandlers = [];
    this._container.innerHTML = '';
    this._listeners = {};
  }

  // ─── STREAM LOADING ────────────────────────────────────────────────────────

  _startLoad() {
    this._destroyHls();
    this._destroyMpegts();
    this._destroyDash();
    this._revokeBlobs();

    const type = this._opts.streamType;
    const url  = this._url;

    if (!url) { this._showError('No stream URL provided.', ''); return; }

    this._log('Loading [' + type + ']', url);

    switch (type) {
      case SP_TYPE.HLS:
        this._loadHls(url, HLS_CONFIG.base);
        break;

      case SP_TYPE.HLS_PROXY:
        this._loadHlsProxy(url);
        break;

      case SP_TYPE.MPEGTS:
        // Check if the URL is actually an m3u8 manifest (not a raw .ts file).
        // Some "mpegts" channels store an m3u8 URL that points to .ts segments.
        // In that case, treat it as a proxied HLS stream — the proxy will
        // rewrite segment URLs inside the manifest.
        if (/\.m3u8?(\?|$)/i.test(url)) {
          this._log('MPEGTS type but URL is .m3u8 — loading as proxied HLS');
          this._loadHlsProxy(url);
        } else {
          // _loadMpegTs is async (dynamically imports mpegts.js) — caller
          // doesn't need to await; spinner stays visible until playback starts.
          this._loadMpegTs(url);
        }
        break;

      case SP_TYPE.DASH:
        // _loadDash is async (dynamically imports dash.js) — caller doesn't
        // need to await; spinner stays visible until playback starts.
        this._loadDash(url);
        break;

      default:
        // Unknown type — try as plain HLS
        this._loadHls(url, HLS_CONFIG.base);
    }
  }

  // ── M3U/HLS ──────────────────────────────────────────────────────────────

  _loadHls(url, config) {
    if (!this._hlsSupported()) return;

    // Preconnect to the upstream origin — warms DNS + TCP + TLS so the
    // first hls.js manifest fetch skips the handshake (saves 200-500ms).
    // Only for direct HLS (not proxy — proxy is same-origin).
    try {
      const origin = new URL(url).origin;
      if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      }
    } catch { /* URL parse failed — skip preconnect */ }

    const merged = Object.assign({}, config, { debug: this._opts.debug }, this._opts.hlsConfig);
    if (this._opts.lowLatency) merged.lowLatencyMode = true;

    const hls = new Hls(merged);
    this._hls = hls;
    hls.loadSource(url);
    hls.attachMedia(this._video);
    this._attachHlsEvents(hls);
    this._attachVideoEvents();
  }

  // ── M3U/HLS Proxy ─────────────────────────────────────────────────────────
  // Strategy: load the manifest through the proxy prefix. The proxy server
  // (Next.js /api/stream-proxy) already rewrites segment/key/init URLs inside
  // the m3u8 to also go through the proxy — so we do NOT need a custom loader
  // to re-wrap segment requests. This avoids double/triple-proxying.
  //
  // The proxyPrefix is prepended to the manifest URL only.

  _loadHlsProxy(url) {
    if (!this._hlsSupported()) return;

    const proxyPrefix = this._opts.proxyUrl;
    // Use the dedicated proxy config — larger buffer (20s vs 10s) absorbs
    // the 100-500ms per-segment proxy overhead, preventing rebuffer-stutter.
    const config = Object.assign({}, HLS_CONFIG.proxy, { debug: this._opts.debug }, this._opts.hlsConfig);

    // No custom loader — the proxy server rewrites segment URLs in the m3u8
    // content itself, so hls.js will fetch them through the proxy naturally.

    const hls = new Hls(config);
    this._hls = hls;
    // Load the manifest through the proxy. Segment URLs come from the
    // proxy-rewritten manifest, so they're already proxied.
    const manifestUrl = proxyPrefix ? proxyPrefix + encodeURIComponent(url) : url;
    hls.loadSource(manifestUrl);
    hls.attachMedia(this._video);
    this._attachHlsEvents(hls);
    this._attachVideoEvents();
  }

  // ── MPEG-TS (.ts) ─────────────────────────────────────────────────────────
  // Live .ts transport streams are handled by mpegts.js (NOT hls.js).
  //
  // Why mpegts.js instead of hls.js Blob M3U8?
  //   hls.js expects finite VOD fragments — it loads the entire segment before
  //   demuxing. For a live .ts stream (infinite, chunked HTTP response), hls.js
  //   never gets a "complete" fragment and the video never plays.
  //
  //   mpegts.js is purpose-built for live MPEG-TS: it reads chunks
  //   incrementally via fetch ReadableStream and feeds them to the demuxer in
  //   real-time. This is the SAME library + config the old TsPlayer used —
  //   proven working on sports-fire and other IPTV deployments.
  //
  // IMPORTANT: raw .ts URLs are almost always CORS-blocked in the browser.
  // If a proxyUrl is configured, route the .ts segment through it so the
  // browser can fetch it without CORS errors.

  // ── DASH (.mpd) ────────────────────────────────────────────────────────────
  // MPEG-DASH adaptive streaming is handled by dash.js (NOT hls.js).
  //
  // Why dash.js?
  //   hls.js only understands HLS (.m3u8). DASH uses a completely different
  //   manifest format (MPD — Media Presentation Description, XML-based) with
  //   its own segment addressing (BaseURL, SegmentTemplate, SegmentList).
  //   dash.js is the reference implementation maintained by the DASH-IF
  //   consortium; it handles MPD parsing, ABR, live DVR, and DRM (Widevine /
  //   PlayReady / ClearKey via EME).
  //
  //   We route the MPD through the proxy (if configured) for CORS bypass.
  //   NOTE: DRM-encrypted streams (cenc.mpd) require a license server URL —
  //   passing a cenc.mpd without ProtectionData will fail to decrypt.

  async _loadMpegTs(tsUrl) {
    // Destroy any existing player instances first
    this._destroyHls();
    this._destroyMpegts();
    this._revokeBlobs();

    let mpegtsLib;
    try {
      mpegtsLib = await _loadMpegtsLib();
    } catch (e) {
      this._log('Failed to load mpegts.js, falling back to hls.js Blob M3U8:', e);
      return this._loadMpegTsViaHls(tsUrl);
    }

    // Player may have been destroyed during the async import
    if (this._destroyed) return;

    if (!mpegtsLib.isSupported()) {
      this._log('mpegts.js not supported, falling back to hls.js Blob M3U8');
      return this._loadMpegTsViaHls(tsUrl);
    }

    // Route the .ts URL through the proxy if one is configured.
    // The proxy streams the .ts bytes with permissive CORS headers.
    const proxyPrefix = this._opts.proxyUrl;
    let finalTsUrl = tsUrl;
    if (proxyPrefix) {
      const absoluteProxy = proxyPrefix.startsWith('http')
        ? proxyPrefix
        : window.location.origin + proxyPrefix;
      finalTsUrl = absoluteProxy + encodeURIComponent(tsUrl);
    }

    this._log('Loading MPEG-TS via mpegts.js:', finalTsUrl);

    // Config optimized for live IPTV proxy streams.
    // KEY TUNING DECISIONS:
    //   • enableStashBuffer: TRUE — absorbs network jitter without stalling.
    //     Disabled stash was the #1 cause of constant re-buffering on slow
    //     upstreams: any packet delay → immediate buffer underrun → spinner.
    //   • stashInitialSize: 768KB — larger than 384KB to handle proxy latency.
    //     The proxy now does 2MB initial burst buffering, so 768KB stash
    //     ensures the demuxer has a full cushion even after the burst drains.
    //   • liveSyncDurationCount: 5 — play from 5 segments behind live edge.
    //     Value of 1–3 was TOO CLOSE: any proxy jitter dried up the buffer
    //     → spinner + catch-up attempts. With 5 segments of cushion
    //     (~10–30s), the player absorbs proxy latency spikes gracefully.
    //   • liveMaxLatencyDurationCount: 18 — generous headroom. Prevents
    //     premature internal catch-up attempts that cause stutter.
    //   • maxBufferLength: 45 — 45s forward buffer for proxy streams.
    //     30s was too thin when proxy latency spikes last 3–5s.
    //   • maxMaxBufferLength: 180 — 3min hard cap, autoCleanup keeps actual
    //     usage much lower.
    //   • bufferSize: 64MB — IO read buffer, handles bursty proxy data.
    //   • liveBufferLatencyChasing: FALSE — was the #1 cause of stutter.
    //   • autoCleanupMinBackwardDuration: 10 — keeps old segments longer.
    const player = mpegtsLib.createPlayer({
      type:              'mpegts',
      url:               finalTsUrl,
      isLive:            true,
      cors:              true,
      enableWorker:      true,
      // Stash buffer — IO↔demuxer cushion. For proxy streams the data path
      // is: upstream → proxy server → proxy HTTP → mpegts.js IO. Each hop
      // adds latency. 768KB stash absorbs ~1–8s of proxy jitter at typical
      // IPTV bitrates (600 Kbps–5 Mbps), giving the proxy time to refill.
      // The proxy's 2MB burst buffering works WITH this stash: burst fills
      // the stash quickly, then the stash cushions any gaps between bursts.
      enableStashBuffer: true,
      stashInitialSize:  768 * 1024, // 768KB — absorbs proxy hop jitter + burst drain
    }, {
      // Live latency chasing — DISABLED.
      // Was the #1 cause of "আগে পিছে হওয়া" (stutter / fast-forward):
      // mpegts.js would jump the playhead forward to reduce latency, creating
      // visible video glitches. With chasing OFF, the player plays smoothly.
      // Buffer is bounded by maxBufferLength + autoCleanup instead.
      liveBufferLatencyChasing:           false,
      liveBufferLatencyChasingOnPaused:   false,
      // liveSyncDurationCount: 5 — play from 5 segments behind live edge.
      //   Value of 1 was TOO CLOSE: any proxy jitter (even 200ms) dried up
      //   the buffer → spinner. Value of 3 was better but still too tight
      //   for high-latency proxy chains. With 5 segments of cushion
      //   (~10–30s depending on segment duration), the player has a
      //   comfortable gap that absorbs proxy latency without stalling.
      //   The extra latency is imperceptible for live TV.
      liveSyncDurationCount:              5,
      // liveMaxLatencyDurationCount: 18 — generous headroom. Previous value
      //   of 12 meant that if latency grew beyond 12 segments (~24–72s),
      //   the player would attempt an internal catch-up that could cause
      //   stutter. With 18, the player tolerates much more lag before
      //   trying to recover, giving the proxy time to stabilize.
      liveMaxLatencyDurationCount:        18,

      // Buffer management — optimized for proxy + live streams.
      // Through a proxy, each fetch has added latency (server → upstream → client).
      // 45s forward buffer — generous for live IPTV proxy. Gives mpegts.js
      //   enough runway to refill after a proxy latency spike. 30s was too
      //   thin: a 3–5s proxy delay + segment retransmit could drain the
      //   buffer faster than it refilled, especially on marginal connections.
      // 180s hard cap — generous for proxy. autoCleanup keeps actual usage low.
      maxBufferLength:                    45,
      maxMaxBufferLength:                 180,
      bufferSize:                         64 * 1000 * 1000, // 64MB IO buffer — absorbs bursty proxy data

      // Auto cleanup of old SourceBuffer segments — critical for long viewing.
      // Without aggressive cleanup, the SourceBuffer grows until it hits the
      // browser's hard limit (~150-300MB depending on browser) and playback
      // FREEZES completely. With chasing OFF, cleanup is the only mechanism
      // that keeps the buffer bounded.
      autoCleanupSourceBuffer:            true,
      autoCleanupMaxBackwardDuration:     30,
      autoCleanupMinBackwardDuration:     10,

      // NO lazy loading — causes periodic re-buffer cycles
      lazyLoad:                           false,

      // Stash buffer (also set on mediaDataSource above for older versions)
      enableStashBuffer:                  true,
      stashInitialSize:                   768 * 1024, // 768KB — matches mediaDataSource

      // Fix audio/video timestamp gaps (common with flaky IPTV upstreams)
      fixAudioTimestampGap:               true,
    });

    player.attachMediaElement(this._video);
    player.load();
    this._mpegtsPlayer = player;

    // Auto-play
    if (this._opts.autoplay) {
      this._video.play().catch(() => {
        this._hideSpinner();
        this._showBigPlay();
      });
    }

    this._attachVideoEvents();

    // Bridge mpegts.js events (arrow functions preserve `this` binding)
    player.on(mpegtsLib.Events.ERROR, (_, data) => {
      this._onMpegtsError(data, tsUrl);
    });

    player.on(mpegtsLib.Events.LOADING_COMPLETE, () => {
      // The upstream .ts connection ended. This happens in two scenarios:
      //
      //   1. LIVE infinite .ts stream dropped (upstream closed after 60-90s):
      //      currentTime > 0 → playback was happening → reconnect to resume.
      //
      //   2. FINITE .ts segment finished (single HLS segment like "435.ts"):
      //      currentTime === 0 → playback never started OR already played out.
      //      Reconnecting to the SAME URL just reloads the same finite segment
      //      in a tight loop, preventing the video from ever playing. This was
      //      the #1 cause of ".ts videos not playing" — the player kept
      //      resetting (unload+load) before the first frame could decode.
      //
      // FIX: Only auto-reconnect if playback was actually happening (currentTime
      //      > 0). For finite segments that never played or finished, leave the
      //      player alone — the stall watchdog will handle recovery if needed.
      const played = this._video && this._video.currentTime > 0;
      this._log('mpegts.js LOADING_COMPLETE — played=' + played);

      if (played) {
        // Live stream dropped mid-playback → reconnect to resume.
        // Short delay (400ms) so the user perceives a brief blip rather than
        // a full "video stopped" event. The previous 1500ms delay made the
        // reconnect feel like the player had died.
        setTimeout(() => {
          if (this._destroyed || !this._mpegtsPlayer) return;
          try {
            this._mpegtsPlayer.unload();
            this._mpegtsPlayer.load();
            this._mpegtsPlayer.play().catch(() => {});
          } catch (e) {
            this._log('mpegts.js reconnect failed:', e);
          }
        }, 400);
      } else {
        // Finite segment that never played (likely a single HLS segment URL).
        // Don't reconnect — let the segment decode. If the codec is
        // unsupported (e.g. MPEG-2), the _mpegtsNoVideoTimer below will show
        // a clear error instead of looping forever.
        this._log('mpegts.js: finite segment ended without playback — not reconnecting');
      }
    });

    // ── MPEG-2 / unsupported codec detection ──
    // Some .ts streams use MPEG-2 video (stream type 0x02), which browsers
    // cannot decode via MediaSource Extensions (MSE only supports H.264/HEVC).
    // mpegts.js will demux the container and parse PAT/PMT, but no video
    // frames ever decode (readyState stays 0). Detect this and show a clear
    // error instead of silently failing.
    //
    // SMART TIMER (was 10s flat):
    // The old 10s flat timeout caused FALSE POSITIVES on slow upstreams (e.g.
    // cdn.jsssbd.com ts.php has ~16s TTFB). The timer fired at 10s before ANY
    // data arrived, showing "unsupported codec" on a perfectly valid H.264
    // stream. Now we use a two-stage check:
    //   1. First check at 15s: if NO data received at all (buffered.length===0
    //      AND no statisticsInfo.totalLoadedBytes), it's a SLOW UPSTREAM, not
    //      a codec issue → keep waiting, don't show error.
    //   2. If data WAS received but readyState still < 1 (metadata not loaded),
    //      THEN it's a genuine codec issue → show the error.
    //   3. Hard ceiling at 45s: if still nothing by then, show a generic
    //      "stream not responding" error (covers truly dead streams).
    clearTimeout(this._mpegtsNoVideoTimer);
    this._mpegtsNoVideoTimer = setTimeout(() => {
      if (this._destroyed || !this._mpegtsPlayer) return;
      const v = this._video;
      if (!v) return;
      const hasDecoded = v.readyState >= 1 || v.currentTime > 0;
      if (hasDecoded) return; // playback started — all good

      // Check if mpegts.js has received ANY data from the upstream.
      // statisticsInfo.totalLoadedBytes > 0 means data arrived but didn't
      // decode → likely unsupported codec (MPEG-2).
      // buffered.length > 0 is a fallback check (some mpegts.js versions).
      let bytesLoaded = 0;
      try {
        const stats = this._mpegtsPlayer.statisticsInfo || {};
        bytesLoaded = stats.totalLoadedBytes || 0;
      } catch {}
      const hasBuffered = (v.buffered && v.buffered.length > 0) || bytesLoaded > 0;

      if (hasBuffered) {
        // Data arrived but no video decoded → genuine codec issue.
        this._log('mpegts.js: data received but no video decoded — likely MPEG-2/unsupported codec');
        this._showError(
          'This stream uses an unsupported video codec.',
          'MPEG-2 .ts streams cannot be played in the browser. Try a different channel.'
        );
        this._emit('error', 'Unsupported video codec (MPEG-2).', 'Browser MSE cannot decode MPEG-2 video.');
      } else {
        // No data at all → slow/dead upstream, NOT a codec issue.
        // Don't show the codec error — let the stall watchdog handle recovery.
        this._log('mpegts.js: no data received after 15s — slow upstream, waiting...');
      }
    }, 15000);
  }

  // Handle mpegts.js errors with auto-retry for network errors
  _onMpegtsError(data, originalUrl) {
    const errorType = data && data.type;
    const errMsg    = (data && (data.info || data.reason)) || 'MPEG-TS playback error';
    this._log('mpegts.js error:', JSON.stringify(data));

    // Network errors — retry with backoff
    if (errorType === 'NetworkError' || /network|timeout|Early-EOF/i.test(errMsg)) {
      if (this._retryCount < this._maxRetries) {
        this._retryCount++;
        const delay = Math.min(1000 * this._retryCount, 8000);
        this._log('mpegts.js network error, retry ' + this._retryCount + '/' + this._maxRetries + ' in ' + delay + 'ms');
        setTimeout(() => {
          if (this._destroyed || !this._mpegtsPlayer) return;
          try {
            this._mpegtsPlayer.unload();
            this._mpegtsPlayer.load();
            this._mpegtsPlayer.play().catch(() => {});
          } catch (e) {
            this._onMpegtsError({ type: 'NetworkError', info: 'retry failed' }, originalUrl);
          }
        }, delay);
        return;
      }
    }

    this._showError('Cannot reach the stream.', 'Check your connection and try again.');
    this._emit('error', 'Cannot reach the stream.', errMsg);
  }

  // Fallback: hls.js Blob M3U8 approach (used if mpegts.js fails to load or is
  // unsupported). This is the OLD approach — kept as a safety net. It works for
  // finite .ts segments but NOT for live/infinite .ts streams.
  _loadMpegTsViaHls(tsUrl) {
    if (!this._hlsSupported()) return;

    const proxyPrefix = this._opts.proxyUrl;
    let finalTsUrl = tsUrl;
    if (proxyPrefix) {
      const absoluteProxy = proxyPrefix.startsWith('http')
        ? proxyPrefix
        : window.location.origin + proxyPrefix;
      finalTsUrl = absoluteProxy + encodeURIComponent(tsUrl);
    }

    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-TARGETDURATION:7200',
      '#EXT-X-ALLOW-CACHE:NO',
      '#EXTINF:7200.0,',
      finalTsUrl,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const blob    = new Blob([manifest], { type: 'application/vnd.apple.mpegurl' });
    const blobUrl = URL.createObjectURL(blob);
    this._blobUrls.push(blobUrl);

    const config = Object.assign({}, HLS_CONFIG.mpegts, {
      debug:         this._opts.debug,
      allowedToStop: false,
    }, this._opts.hlsConfig);

    const hls = new Hls(config);
    this._hls = hls;
    hls.loadSource(blobUrl);
    hls.attachMedia(this._video);
    this._attachHlsEvents(hls);
    this._attachVideoEvents();
  }

  // ── iOS Safari fallback (native HLS, no hls.js) ──────────────────────────

  _loadNative(url) {
    // For MPEG-TS on iOS: Safari's AVFoundation can handle .ts natively
    this._video.src = url;
    this._video.load();
    this._attachVideoEvents();
    this._isLive = true;
    this._updateLiveBadge(true);
    if (this._opts.autoplay) this._video.play().catch(() => {
      this._hideSpinner();
      this._showBigPlay();
    });
  }

  // ─── HLS.JS EVENTS ────────────────────────────────────────────────────────

  _attachHlsEvents(hls) {
    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      this._levels = data.levels;
      this._isLive = this._detectLive(hls);
      this._buildQualityPanel();
      this._applyQuality(this._currentQuality);
      this._updateLiveBadge(this._isLive);
      this._emit('levelLoaded', this._levels);

      if (this._opts.autoplay) {
        this._video.play().catch(() => {
          this._hideSpinner();
          this._showBigPlay();
        });
      } else {
        this._hideSpinner();
        this._showBigPlay();
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      this._onQualitySwitch(data.level);
    });

    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      // Fragment loaded — clear stall if we were in recovery
      if (this._stalled) this._clearStall();
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      this._onHlsError(data);
    });
  }

  _detectLive(hls) {
    try {
      const level = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : 0];
      return level && level.details ? level.details.live : true;
    } catch (_) { return true; }
  }

  _onHlsError(data) {
    if (!data.fatal) {
      // Non-fatal: log only in debug
      this._log('Non-fatal HLS error:', data.type, data.details);
      return;
    }

    this._log('Fatal HLS error:', data.type, data.details);

    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        // Emit a 'networkError' event so the wrapper can trigger a reactive
        // token refresh BEFORE exhausting all retries. This lets the player
        // recover from an expired signed-URL token in ~1s instead of waiting
        // for 6 retries (which can take 30+ seconds).
        this._emit('networkError', data.details, data.response);

        if (this._retryCount < this._maxRetries) {
          this._retryCount++;
          const delay = Math.min(1000 * this._retryCount, 8000);
          this._log('Network error, retry #' + this._retryCount + ' in ' + delay + 'ms');
          setTimeout(() => this._rotateCdn(), delay);
        } else {
          this._showError('Cannot reach the stream.', 'Check your connection and try again.');
        }
        break;

      case Hls.ErrorTypes.MEDIA_ERROR:
        this._log('Media error, recovering...');
        this._hls.recoverMediaError();
        break;

      default:
        this._showError('Playback error.', 'Please refresh the page.');
    }
  }

  // ─── VIDEO EVENTS ─────────────────────────────────────────────────────────

  _attachVideoEvents() {
    const v = this._video;
    const on = (e, fn) => {
      v.addEventListener(e, fn);
      this._videoHandlers.push({ e, fn });
    };

    on('play', () => {
      this._playing = true;
      this._els.playBtn.innerHTML = this._icons.pause;
      this._els.playBtn.setAttribute('aria-label', 'Pause');
      this._hideSpinner();
      this._hideBigPlay();
      this._hidePoster();
      this._startWatchdog();
      this._emit('playing');
    });

    on('pause', () => {
      this._playing = false;
      this._els.playBtn.innerHTML = this._icons.play;
      this._els.playBtn.setAttribute('aria-label', 'Play');
      if (!this._isLive) this._showBigPlay();
    });

    on('waiting', () => { this._showSpinner(); });

    on('playing', () => {
      // 'playing' fires after buffering ends — clear spinner
      this._hideSpinner();
      if (this._stalled) this._clearStall();
    });

    on('canplay', () => {
      this._hideSpinner();
      this._emit('ready');
    });

    on('ended', () => {
      this._playing = false;
      this._stopWatchdog();
      this._els.playBtn.innerHTML = this._icons.replay;
      this._els.playBtn.setAttribute('aria-label', 'Replay');
      this._showBigPlay();
    });

    on('volumechange', () => { this._updateVolumeUI(); });

    on('timeupdate',   () => { this._onTimeUpdate(); });
    on('progress',     () => { this._updateBufferBar(); });

    on('durationchange', () => {
      if (!this._isLive && isFinite(this._video.duration)) {
        this._els.progressWrap.classList.remove('sp-live-mode');
        if (this._els.livBtn) this._els.livBtn.style.display = 'none';
        this._els.timeDisplay.classList.remove('sp-hidden');
      }
    });

    on('loadedmetadata', () => {
      if (v.textTracks && v.textTracks.length > 0) {
        this._els.ccBtn.classList.remove('sp-hidden');
      }
    });

    // Video element error handler with AUTO-RETRY for transient errors.
    // MEDIA_ERR_DECODE (code 3) and MEDIA_ERR_SRC_NOT_SUPPORTED (code 4)
    // are often transient in live streams — caused by SourceBuffer overflow,
    // codec init timing, or brief network interruption. They resolve on
    // retry, so we auto-retry up to 5 times before showing an error.
    on('error', () => {
      const err = v.error;
      if (!err) return;

      const isTransient = (
        err.code === MediaError.MEDIA_ERR_DECODE ||
        err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      );

      if (isTransient) {
        this._videoErrorRetries = (this._videoErrorRetries || 0) + 1;
        if (this._videoErrorRetries <= 5) {
          const delay = Math.min(1000 * this._videoErrorRetries, 5000);
          this._log(`Transient video error (code ${err.code}), auto-retry ${this._videoErrorRetries}/5 in ${delay}ms`);
          this._showSpinner();  // Show buffering during retry
          setTimeout(() => {
            if (this._destroyed) return;
            // For mpegts.js streams: unload + reload
            if (this._mpegtsPlayer) {
              try {
                this._mpegtsPlayer.unload();
                this._mpegtsPlayer.load();
                this._mpegtsPlayer.play();
              } catch {}
            }
            // For hls.js streams: recoverMediaError handles most decode errors
            if (this._hls) {
              try { this._hls.recoverMediaError(); } catch {}
            }
          }, delay);
          return;
        }
      }

      // Non-transient or retries exhausted — show error
      this._videoErrorRetries = 0;
      let msg = 'Playback error';
      switch (err.code) {
        case MediaError.MEDIA_ERR_ABORTED: msg = 'Playback aborted'; break;
        case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error — stream unavailable'; break;
        case MediaError.MEDIA_ERR_DECODE: msg = 'Decode error — stream may be unstable'; break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Stream format not supported'; break;
      }
      this._log('Video error (final):', msg);
      this._showError(msg, 'Click play to retry, or try a different channel.');
    });

    // Reset retry counter on successful playback
    on('playing', () => {
      this._videoErrorRetries = 0;
    });

    // iOS: webkitbeginfullscreen / webkitendfullscreen
    on('webkitbeginfullscreen', () => {
      this._els.fullscreenBtn.innerHTML = this._icons.exitFullscreen;
    });
    on('webkitendfullscreen', () => {
      this._els.fullscreenBtn.innerHTML = this._icons.fullscreen;
    });
  }

  // ─── STALL WATCHDOG ───────────────────────────────────────────────────────
  // Runs every 3s. If video.currentTime hasn't advanced for ≥5s while
  // supposedly playing, triggers 3-stage recovery.

  _startWatchdog() {
    this._stopWatchdog();
    this._lastTime   = this._video.currentTime;
    this._lastTimeAt = Date.now();
    this._watchdogTimer = setInterval(() => this._watchdogTick(), 3000);
  }

  _stopWatchdog() {
    if (this._watchdogTimer) { clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
  }

  _watchdogTick() {
    const v = this._video;
    if (v.paused || !this._playing || this._destroyed) return;

    const elapsed   = (Date.now() - this._lastTimeAt) / 1000;
    const advanced  = v.currentTime - this._lastTime;
    this._lastTime   = v.currentTime;
    this._lastTimeAt = Date.now();

    // Threshold: time hasn't moved for ≥5s
    if (advanced < 0.05 && elapsed >= 2.5) {
      this._triggerStallRecovery();
    }
  }

  _triggerStallRecovery() {
    if (this._stalled) return; // already recovering
    this._stalled = true;
    this._showSpinner();
    this._retryCount++;
    this._emit('stalled', this._retryCount);
    this._log('Stall detected — recovery stage 1 (retry #' + this._retryCount + ')');

    // Stage 1: force play
    this._video.play().catch(() => {});

    clearTimeout(this._stallTimer);
    this._stallTimer = setTimeout(() => {
      if (!this._stalled) return;
      this._log('Stall recovery stage 2: recoverMediaError');

      if (this._hls) {
        // HLS path: recoverMediaError + CDN rotate on persistent stall
        this._hls.recoverMediaError();

        this._stallTimer = setTimeout(() => {
          if (!this._stalled) return;
          this._log('Stall recovery stage 3: CDN rotate');
          this._rotateCdn();
        }, 4000);
      } else if (this._mpegtsPlayer) {
        // MPEG-TS path: mpegts.js has no recoverMediaError — do a soft
        // unload+load+play cycle to reconnect to the live .ts stream.
        // This is much faster than a full _rotateCdn() (which destroys +
        // rebuilds the entire player DOM). The previous code skipped this
        // branch entirely and went straight to _rotateCdn(), which made
        // the video visibly "turn off" for ~2-3s on every stall.
        this._log('Stall recovery stage 2 (mpegts): soft reconnect');
        try {
          this._mpegtsPlayer.unload();
          this._mpegtsPlayer.load();
          this._mpegtsPlayer.play().catch(() => {});
        } catch (e) {
          this._log('mpegts soft reconnect failed, rotating CDN:', e);
          this._rotateCdn();
          return;
        }

        // If still stalled after 5s, fall back to full CDN rotate
        this._stallTimer = setTimeout(() => {
          if (!this._stalled) return;
          this._log('Stall recovery stage 3 (mpegts): CDN rotate');
          this._rotateCdn();
        }, 5000);
      } else if (this._dashPlayer) {
        // DASH path: dash.js has its own recovery. Force a seek to live edge.
        this._log('Stall recovery stage 2 (dash): seek to live edge');
        try {
          if (this._dashPlayer.isDynamic && this._dashPlayer.duration) {
            this._video.currentTime = this._dashPlayer.duration;
          }
          this._video.play().catch(() => {});
        } catch (e) {
          this._log('dash seek failed, rotating CDN:', e);
        }
        this._stallTimer = setTimeout(() => {
          if (!this._stalled) return;
          this._log('Stall recovery stage 3 (dash): CDN rotate');
          this._rotateCdn();
        }, 5000);
      } else {
        // No player instance — full reload
        this._rotateCdn();
      }
    }, 3500);
  }

  _clearStall() {
    this._stalled = false;
    clearTimeout(this._stallTimer);
    this._hideSpinner();
    this._lastTime   = this._video.currentTime;
    this._lastTimeAt = Date.now();
  }

  // ─── CDN FAILOVER ─────────────────────────────────────────────────────────

  _rotateCdn() {
    const urls = this._opts.streamUrls;
    if (urls.length > 1) {
      this._urlIndex = (this._urlIndex + 1) % urls.length;
      this._log('CDN rotate → #' + this._urlIndex + ':', this._url);
    }
    if (this._retryCount > this._maxRetries) {
      this._showError('Stream connection lost.', 'Retrying in 10 seconds…');
      setTimeout(() => {
        this._retryCount = 0;
        this._urlIndex   = 0;
        this._hideError();
        this._startLoad();
      }, 10000);
      return;
    }
    this._hideError();
    this._showSpinner();
    this._stalled = false;
    this._startLoad();
  }

  // ─── QUALITY ──────────────────────────────────────────────────────────────

  _buildQualityPanel() {
    const panel = this._els.qualityPanel;
    panel.querySelectorAll('.sp-quality-option').forEach(el => el.remove());

    // Auto
    panel.appendChild(this._makeQOpt(-1, 'Auto', ''));

    // Sorted highest first
    this._levels
      .map((l, i) => ({ i, h: l.height || 0, b: l.bitrate || 0 }))
      .sort((a, b) => b.h - a.h)
      .forEach(({ i, h, b }) => {
        const label = h ? h + 'p' : 'Level ' + i;
        const badge = b ? Math.round(b / 1000) + 'k' : '';
        panel.appendChild(this._makeQOpt(i, label, badge));
      });

    this._highlightQuality(this._currentQuality);
  }

  _makeQOpt(index, label, badge) {
    const el = document.createElement('div');
    el.className = 'sp-quality-option';
    el.setAttribute('role', 'menuitemradio');
    el.setAttribute('aria-checked', 'false');
    el.setAttribute('tabindex', '0');
    el.dataset.level = index;
    el.innerHTML = label + (badge ? `<span class="sp-quality-option-badge">${badge}</span>` : '');
    el.addEventListener('click', () => { this._applyQuality(index); this._closeQuality(); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._applyQuality(index); this._closeQuality(); }
    });
    return el;
  }

  _applyQuality(level) {
    this._currentQuality = level;
    if (this._hls) {
      if (level === -1) {
        this._hls.currentLevel = -1;
      } else {
        this._hls.nextLevel = level;
      }
    }
    this._highlightQuality(level);
    this._updateQualityLabel(level);
  }

  _highlightQuality(active) {
    this._els.qualityPanel.querySelectorAll('.sp-quality-option').forEach(el => {
      const on = parseInt(el.dataset.level) === active;
      el.classList.toggle('sp-active', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  _onQualitySwitch(level) {
    this._emit('qualityChanged', level);
    if (this._currentQuality === -1 && this._levels[level]) {
      const h = this._levels[level].height;
      this._els.qualityLabel.textContent = h ? 'Auto (' + h + 'p)' : 'Auto';
    }
    const h = this._levels[level] && this._levels[level].height;
    if (h) this._announce('Quality: ' + h + 'p');
    if (this._stalled) this._clearStall();
  }

  _updateQualityLabel(level) {
    if (level === -1) {
      this._els.qualityLabel.textContent = 'Auto';
    } else if (this._levels[level]) {
      const h = this._levels[level].height;
      this._els.qualityLabel.textContent = h ? h + 'p' : 'Lvl ' + level;
    }
  }

  // ─── TIME / PROGRESS ──────────────────────────────────────────────────────

  _onTimeUpdate() {
    const v = this._video;

    if (!this._isLive && !isNaN(v.duration) && v.duration > 0) {
      const pct = (v.currentTime / v.duration) * 100;
      this._els.progressPlayed.style.width = pct + '%';
      this._els.progressThumb.style.left   = pct + '%';
      this._els.progressWrap.setAttribute('aria-valuenow', Math.round(pct));
      this._els.timeDisplay.textContent = this._fmt(v.currentTime) + ' / ' + this._fmt(v.duration);
    }

    if (this._isLive && this._hls) {
      const sync = this._hls.liveSyncPosition;
      this._setAtLiveEdge(!sync || Math.abs(v.currentTime - sync) < 8);
    }
  }

  _updateBufferBar() {
    const v = this._video;
    if (!v.duration || !v.buffered.length) return;
    const end = v.buffered.end(v.buffered.length - 1);
    this._els.progressBuffer.style.width = (end / v.duration * 100) + '%';
  }

  _setAtLiveEdge(at) {
    if (this._atLiveEdge === at) return;
    this._atLiveEdge = at;
    const btn = this._els.livBtn;
    if (!btn) return;
    btn.classList.toggle('sp-at-live', at);
    btn.classList.toggle('sp-behind-live', !at);
    if (this._els.livBtnText)
      this._els.livBtnText.textContent = at ? 'LIVE' : 'GO LIVE';
    btn.setAttribute('aria-label', at ? 'Live — at live edge' : 'Go to live edge');
  }

  _fmt(s) {
    if (isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h > 0
      ? h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0')
      : m + ':' + String(sec).padStart(2,'0');
  }

  // ─── HLS SUPPORTED CHECK ──────────────────────────────────────────────────

  _hlsSupported() {
    if (typeof Hls === 'undefined') {
      this._showError('Player failed to initialize.', 'Please refresh the page.');
      return false;
    }
    if (!Hls.isSupported()) {
      // Safari native — handles HLS and usually .ts directly
      this._loadNative(this._url);
      return false;
    }
    return true;
  }

  // ─── DOM BUILD ────────────────────────────────────────────────────────────

  _build() {
    this._container.setAttribute('tabindex', '0');
    this._container.setAttribute('role', 'region');
    this._container.setAttribute('aria-label', 'Video player');

    this._container.innerHTML = `
<div class="sp-wrapper">
  <div class="sp-ratio">

    <video class="sp-video" playsinline webkit-playsinline preload="auto"
      aria-label="Video stream"
      ${this._opts.muted ? 'muted' : ''}></video>

    <div class="sp-poster${this._opts.poster ? '' : ' sp-hidden'}"
      ${this._opts.poster ? `style="background-image:url('${this._opts.poster}')"` : ''}></div>

    <div class="sp-click-area" role="button" aria-label="Toggle controls" tabindex="-1"></div>

    <div class="sp-overlay">
      <button class="sp-big-play sp-hidden" aria-label="Play">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <svg class="sp-spinner sp-hidden" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20"/>
      </svg>
    </div>

    <div class="sp-title-badge sp-hidden"></div>

    <div class="sp-error-overlay sp-hidden" role="alert">
      <svg class="sp-error-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <p class="sp-error-message">Stream unavailable</p>
      <p class="sp-error-sub"></p>
      <button class="sp-retry-btn">Try again</button>
    </div>

    <div class="sp-controls" role="group" aria-label="Player controls">

      <div class="sp-controls-top">
        <button class="sp-btn sp-live-btn sp-at-live" aria-label="Live — at live edge">
          <span class="sp-live-btn-dot"></span>
          <span class="sp-live-btn-text">LIVE</span>
        </button>
      </div>

      <div class="sp-progress-wrap sp-live-mode" role="slider"
        aria-label="Playback progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="sp-progress-track">
          <div class="sp-progress-buffer"></div>
          <div class="sp-progress-played"></div>
          <div class="sp-progress-thumb"></div>
        </div>
        <div class="sp-progress-tooltip">0:00</div>
      </div>

      <div class="sp-bar">
        <button class="sp-btn sp-play-btn" aria-label="Play">${this._icons.play}</button>

        <div class="sp-volume-wrap">
          <button class="sp-btn sp-mute-btn" aria-label="Mute">${this._icons.volumeHigh}</button>
          <div class="sp-volume-slider-wrap">
            <input type="range" class="sp-volume-slider" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          </div>
        </div>

        <span class="sp-time sp-hidden"></span>

        <div class="sp-spacer"></div>

        <button class="sp-btn sp-btn-sm sp-cc-btn sp-hidden" aria-label="Subtitles" aria-pressed="false">CC</button>

        <!-- Settings gear button — opens the quality panel.
             Replaces the old "Auto ▾" text button. The current quality label
             (e.g. "720p", "Auto (1080p)") is shown next to the gear so the
             user can see the active quality at a glance. -->
        <button class="sp-btn sp-settings-btn" aria-label="Video quality settings" aria-haspopup="true" aria-expanded="false">
          <span class="sp-settings-gear">${this._icons.settings}</span>
          <span class="sp-quality-label">Auto</span>
        </button>

        <button class="sp-btn sp-fullscreen-btn" aria-label="Enter fullscreen">${this._icons.fullscreen}</button>
      </div>
    </div>

    <div class="sp-quality-panel" role="menu" aria-label="Quality options">
      <div class="sp-quality-panel-header">Quality</div>
    </div>

    <div class="sp-sr-only" role="status" aria-live="polite" aria-atomic="true"></div>

  </div>
</div>`;

    // Cache refs
    const q = s => this._container.querySelector(s);
    this._els = {
      wrapper:        q('.sp-wrapper'),
      ratio:          q('.sp-ratio'),
      poster:         q('.sp-poster'),
      clickArea:      q('.sp-click-area'),
      bigPlay:        q('.sp-big-play'),
      spinner:        q('.sp-spinner'),
      titleBadge:     q('.sp-title-badge'),
      errorOverlay:   q('.sp-error-overlay'),
      errorMessage:   q('.sp-error-message'),
      errorSub:       q('.sp-error-sub'),
      retryBtn:       q('.sp-retry-btn'),
      controls:       q('.sp-controls'),
      progressWrap:   q('.sp-progress-wrap'),
      progressBuffer: q('.sp-progress-buffer'),
      progressPlayed: q('.sp-progress-played'),
      progressThumb:  q('.sp-progress-thumb'),
      progressTooltip:q('.sp-progress-tooltip'),
      playBtn:        q('.sp-play-btn'),
      livBtn:         q('.sp-live-btn'),
      livBtnText:     q('.sp-live-btn-text'),
      timeDisplay:    q('.sp-time'),
      muteBtn:        q('.sp-mute-btn'),
      volumeSlider:   q('.sp-volume-slider'),
      ccBtn:          q('.sp-cc-btn'),
      qualityBtn:     q('.sp-settings-btn'),
      qualityLabel:   q('.sp-quality-label'),
      qualityPanel:   q('.sp-quality-panel'),
      fullscreenBtn:  q('.sp-fullscreen-btn'),
      announcer:      q('[role="status"]'),
    };
    this._video = q('.sp-video');

    if (this._opts.accentColor !== '#e63946') this._applyAccent(this._opts.accentColor);
    if (this._opts.showTitle && this._opts.title) {
      this._els.titleBadge.textContent = this._opts.title;
      this._els.titleBadge.classList.remove('sp-hidden');
    }

    this._bindUI();
  }

  // ─── UI EVENT BINDING ─────────────────────────────────────────────────────

  _bindUI() {
    const e = this._els;

    e.playBtn.addEventListener('click',   () => this.togglePlay());
    // Single tap/click on the video area toggles CONTROLS visibility (does NOT
    // pause the video). This matches the user's expected behavior:
    //   - Tap once → show controls (if hidden) or hide them (if visible)
    //   - Video keeps playing — only the play button pauses/plays
    // The big-play button (shown when paused) still plays on click.
    e.clickArea.addEventListener('click', () => this._toggleControls());
    e.bigPlay.addEventListener('click',   () => this.play());
    if (e.livBtn) e.livBtn.addEventListener('click',    () => this.goLive());
    e.muteBtn.addEventListener('click',   () => this.toggleMute());
    e.volumeSlider.addEventListener('input', ev => this.setVolume(parseFloat(ev.target.value)));
    e.qualityBtn.addEventListener('click', ev => { ev.stopPropagation(); this._toggleQuality(); });
    e.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    e.ccBtn.addEventListener('click', () => this._toggleCC());
    e.retryBtn.addEventListener('click', () => { this._hideError(); this._retryCount = 0; this._urlIndex = 0; this.init(); });

    document.addEventListener('click', () => this._closeQuality());

    // ── Controls visibility behavior (per user spec) ──
    //   • Mouse hover (desktop) → show controls + 3s auto-hide timer
    //   • Tap/click on video area → toggle (show if hidden, hide if shown)
    //   • No interaction for 3s → auto-hide
    //
    // IMPORTANT: We do NOT bind touchstart to show controls. On mobile,
    // touchstart fires before click — if it showed controls, the subsequent
    // click would immediately toggle (hide) them, so the user would see a
    // brief flash and think "tap does nothing" or "tap pauses." Instead we
    // rely on the click event alone for mobile, which toggles correctly.
    //
    // The `_userHidden` flag prevents mousemove from re-showing controls the
    // user just hid via click. Without this, clicking to hide on desktop
    // would be immediately undone by the next mousemove event. The flag
    // auto-clears after 3s (matching the auto-hide timer) or when the mouse
    // leaves and re-enters the player.
    const wrap = e.wrapper;
    wrap.addEventListener('mousemove', () => {
      // Don't re-show if the user just hid via click (desktop)
      if (this._userHidden) return;
      this._showControls();
    });
    wrap.addEventListener('mouseenter', () => {
      // Mouse re-entered the player — clear the user-hidden flag so hover
      // shows controls again.
      this._userHidden = false;
      this._showControls();
    });
    wrap.addEventListener('mouseleave', () => this._scheduleHide());

    // Fullscreen change
    const onFs = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      e.fullscreenBtn.innerHTML = fs ? this._icons.exitFullscreen : this._icons.fullscreen;
      e.fullscreenBtn.setAttribute('aria-label', fs ? 'Exit fullscreen' : 'Enter fullscreen');
      // When entering fullscreen, show controls briefly then auto-hide.
      // When exiting, also show briefly then auto-hide.
      this._showControls();
    };
    document.addEventListener('fullscreenchange',       onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    // Progress scrub
    this._bindProgress();

    // Progress hover tooltip
    e.progressWrap.addEventListener('mousemove', ev => {
      const v = this._video;
      if (!v.duration) return;
      const rect = e.progressWrap.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      e.progressTooltip.textContent = this._fmt(pct * v.duration);
      e.progressTooltip.style.left  = (pct * 100) + '%';
    });
  }

  _bindProgress() {
    const wrap = this._els.progressWrap;
    const v    = this._video;
    const seek = ev => {
      if (!v.duration) return;
      const rect = wrap.getBoundingClientRect();
      const cx   = ev.touches ? ev.touches[0].clientX : ev.clientX;
      v.currentTime = Math.max(0, Math.min(1, (cx - rect.left) / rect.width)) * v.duration;
    };
    let dragging = false;
    wrap.addEventListener('mousedown', ev => {
      dragging = true; seek(ev);
      const up = () => { dragging = false; document.removeEventListener('mouseup', up); document.removeEventListener('mousemove', move); };
      const move = ev2 => { if (dragging) seek(ev2); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    wrap.addEventListener('touchstart', seek, { passive: true });
    wrap.addEventListener('touchmove',  seek, { passive: true });
  }

  _bindKeys() {
    this._container.addEventListener('keydown', ev => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (ev.key) {
        case ' ': case 'k': case 'K': ev.preventDefault(); this.togglePlay(); break;
        case 'm': case 'M': ev.preventDefault(); this.toggleMute(); break;
        case 'f': case 'F': ev.preventDefault(); this.toggleFullscreen(); break;
        case 'l': case 'L': ev.preventDefault(); this.goLive(); break;
        case 'ArrowUp':    ev.preventDefault(); this.setVolume(this._volume + 0.1); break;
        case 'ArrowDown':  ev.preventDefault(); this.setVolume(this._volume - 0.1); break;
        case 'ArrowRight': if (!this._isLive) { ev.preventDefault(); this._video.currentTime += 10; } break;
        case 'ArrowLeft':  if (!this._isLive) { ev.preventDefault(); this._video.currentTime -= 10; } break;
        case 'Escape': this._closeQuality(); break;
      }
    });
  }

  // ─── CONTROLS VISIBILITY ──────────────────────────────────────────────────
  // Controls auto-hide after 3s. Single tap/click toggles visibility.
  // Controls ALWAYS auto-hide after 3s of inactivity — whether playing OR paused.
  // The only exception is when the quality panel is open (user is selecting).

  _showControls() {
    this._els.controls.classList.remove('sp-hidden-controls');
    clearTimeout(this._hideTimer);
    this._scheduleHide();
  }

  _hideControls() {
    clearTimeout(this._hideTimer);
    this._els.controls.classList.add('sp-hidden-controls');
  }

  _toggleControls() {
    if (this._els.controls.classList.contains('sp-hidden-controls')) {
      // Controls are hidden → show them, clear the user-hidden flag
      this._userHidden = false;
      this._showControls();
    } else {
      // Controls are visible → hide them. Set the user-hidden flag so
      // mousemove doesn't immediately re-show them. The flag auto-clears
      // after 3s (matching the auto-hide timer) or when the mouse leaves
      // and re-enters the player.
      this._userHidden = true;
      this._hideControls();
      clearTimeout(this._userHiddenTimer);
      this._userHiddenTimer = setTimeout(() => {
        this._userHidden = false;
      }, 3000);
    }
  }

  _scheduleHide() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      // Hide controls after 3s — UNLESS the quality panel is open (user is
      // actively selecting a quality level, don't hide the controls under
      // their finger).
      if (!this._qualityOpen)
        this._els.controls.classList.add('sp-hidden-controls');
    }, 3000);
  }

  // ─── QUALITY PANEL ────────────────────────────────────────────────────────

  _toggleQuality() { this._qualityOpen ? this._closeQuality() : this._openQuality(); }

  _openQuality() {
    this._qualityOpen = true;
    this._els.qualityPanel.classList.add('sp-open');
    this._els.qualityBtn.setAttribute('aria-expanded', 'true');
    this._showControls();
  }

  _closeQuality() {
    if (!this._qualityOpen) return;
    this._qualityOpen = false;
    this._els.qualityPanel.classList.remove('sp-open');
    this._els.qualityBtn.setAttribute('aria-expanded', 'false');
  }

  // ─── CC ───────────────────────────────────────────────────────────────────

  _toggleCC() {
    const tracks = this._video.textTracks;
    if (!tracks.length) return;
    const on = tracks[0].mode === 'showing';
    tracks[0].mode = on ? 'disabled' : 'showing';
    this._els.ccBtn.classList.toggle('sp-cc-active', !on);
    this._els.ccBtn.setAttribute('aria-pressed', String(!on));
  }

  // ─── LIVE BADGE ───────────────────────────────────────────────────────────

  _updateLiveBadge(live) {
    this._isLive = live;
    // Live button visibility (interactive LIVE/GO LIVE pill above the
    // pause button). The top-left corner passive indicator was removed.
    if (this._els.livBtn) {
      this._els.livBtn.style.display = live ? '' : 'none';
    }
    if (!live) {
      this._els.progressWrap.classList.remove('sp-live-mode');
      this._els.timeDisplay.classList.remove('sp-hidden');
    }
  }

  // ─── VOLUME UI ────────────────────────────────────────────────────────────

  _updateVolumeUI() {
    const v    = this._video;
    const mute = v.muted || v.volume === 0;
    this._volume = v.volume;
    this._muted  = mute;
    this._els.muteBtn.innerHTML = mute ? this._icons.volumeOff
      : v.volume < 0.5 ? this._icons.volumeMid : this._icons.volumeHigh;
    this._els.muteBtn.setAttribute('aria-label', mute ? 'Unmute' : 'Mute');
    this._els.volumeSlider.value = mute ? 0 : v.volume;
  }

  // ─── ERROR / LOADING UI ───────────────────────────────────────────────────

  _showError(msg, sub) {
    this._els.errorOverlay.classList.remove('sp-hidden');
    this._els.errorMessage.textContent = msg;
    this._els.errorSub.textContent     = sub || '';
    this._hideSpinner();
    this._hideBigPlay();
    this._stopWatchdog();
    this._emit('error', msg, sub);
  }
  _hideError()  { this._els.errorOverlay.classList.add('sp-hidden'); }
  _showSpinner(){ this._els.spinner.classList.remove('sp-hidden'); this._els.bigPlay.classList.add('sp-hidden'); }
  _hideSpinner(){ this._els.spinner.classList.add('sp-hidden'); }
  _showBigPlay(){ this._els.bigPlay.classList.remove('sp-hidden'); this._els.spinner.classList.add('sp-hidden'); }
  _hideBigPlay(){ this._els.bigPlay.classList.add('sp-hidden'); }
  _hidePoster() { this._els.poster.classList.add('sp-hidden'); }

  _announce(text) {
    const el = this._els.announcer;
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = text; });
  }

  // ─── ACCENT COLOR ─────────────────────────────────────────────────────────

  _applyAccent(c) {
    const s = document.createElement('style');
    s.textContent = `.sp-live-dot,.sp-live-btn.sp-at-live{border-color:${c};color:${c}}.sp-live-dot{background:${c}}.sp-progress-played{background:${c}}.sp-progress-thumb{background:${c};box-shadow:0 0 0 3px ${c}40}.sp-spinner circle{stroke:${c}}.sp-retry-btn{background:${c}}.sp-quality-option.sp-active{color:${c};border-left-color:${c}}.sp-big-play:hover{background:${c}cc}`;
    this._container.appendChild(s);
  }

  // ─── CLEANUP ──────────────────────────────────────────────────────────────

  _destroyHls() {
    if (this._hls) {
      this._hls.stopLoad();
      this._hls.detachMedia();
      this._hls.destroy();
      this._hls = null;
    }
    if (this._video) this._video.src = '';
  }

  _destroyMpegts() {
    clearTimeout(this._mpegtsNoVideoTimer);
    if (this._mpegtsPlayer) {
      try {
        this._mpegtsPlayer.pause();
        this._mpegtsPlayer.unload();
        this._mpegtsPlayer.detachMediaElement();
        this._mpegtsPlayer.destroy();
      } catch (e) {
        // ignore — player may already be destroyed
      }
      this._mpegtsPlayer = null;
    }
  }

  _destroyDash() {
    if (this._dashPlayer) {
      try {
        this._dashPlayer.reset();
      } catch (e) {
        // ignore — player may already be destroyed
      }
      this._dashPlayer = null;
    }
  }

  // ── DASH (.mpd) loader ─────────────────────────────────────────────────────
  async _loadDash(mpdUrl) {
    // Destroy any existing player instances first
    this._destroyHls();
    this._destroyMpegts();
    this._destroyDash();
    this._revokeBlobs();

    let dashLib;
    try {
      dashLib = await _loadDashLib();
    } catch (e) {
      this._log('Failed to load dash.js:', e);
      this._showError('Failed to load DASH player library.', String(e));
      return;
    }

    // Player may have been destroyed during the async import
    if (this._destroyed) return;

    // Try DIRECT playback first for DASH streams.
    // Only route through proxy if explicitly needed (proxyUrl is set).
    // Most CDNs serve .mpd with proper CORS headers, so direct playback works.
    // Proxying breaks relative segment URL resolution unless the proxy rewrites
    // the .mpd manifest (which our stream-proxy now does for .mpd).
    const proxyPrefix = this._opts.proxyUrl;
    let finalMpdUrl = mpdUrl;
    if (proxyPrefix) {
      const absoluteProxy = proxyPrefix.startsWith('http')
        ? proxyPrefix
        : window.location.origin + proxyPrefix;
      finalMpdUrl = absoluteProxy + encodeURIComponent(mpdUrl);
      this._log('DASH: routing through proxy:', finalMpdUrl);
    } else {
      this._log('DASH: trying direct playback:', mpdUrl);
    }

    this._log('Loading DASH via dash.js:', finalMpdUrl);

    let player;
    try {
      player = dashLib.MediaPlayer().create();
    } catch (e) {
      this._showError('Failed to create DASH player instance.', String(e));
      return;
    }

    // Basic player configuration — fast start, live edge, stable buffering.
    try {
      player.updateSettings({
        streaming: {
          // Live latency — stay close to the edge
          liveDelay:                   6,
          liveCatchup:                 { enabled: false },
          // Buffer — small initial for fast first-frame, larger steady-state
          stableBufferTime:            20,
          bufferTimeAtTopQuality:      30,
          bufferTimeAtTopQualityLongForm: 60,
          // ABR — start low for instant playback
          abr:                         { initialBitrate: { video: 800 }, autoSwitchBitrate: { video: true } },
          // Fast start
          fastStartEnabled:            true,
          // Jump to live edge on load
          jumpGaps:                    true,
          smallGapLimit:               1.5,
        },
        debug: { logLevel: this._opts.debug ? dashLib.Debug.LOG_LEVEL_INFO : dashLib.Debug.LOG_LEVEL_NONE },
      });
    } catch (e) {
      // Settings API changed between dash.js versions — fall back to defaults.
      this._log('dash.js updateSettings failed, using defaults:', e);
    }

    // Initialize and attach to the video element
    try {
      player.initialize(this._video, finalMpdUrl, !!this._opts.autoplay);
    } catch (e) {
      this._showError('Failed to initialize DASH playback.', String(e));
      return;
    }
    this._dashPlayer = player;

    // Bridge dash.js events.
    // NOTE: dash.js attaches its own src to the video element, so the standard
    // video events (play, pause, playing, timeupdate, waiting, ended) fire on
    // the video element and are already handled by _attachVideoEvents() above.
    // We only bridge dash.js-specific events: ERROR and quality changes.
    try {
      player.on(dashLib.MediaPlayer.events.ERROR, (e) => {
        this._onDashError(e, mpdUrl);
      });
      player.on(dashLib.MediaPlayer.events.QUALITY_CHANGE_RENDERED, (e) => {
        // Bridge to the existing quality-switch handler.
        if (e && typeof e.newQuality !== 'undefined') {
          this._onQualitySwitch(e.newQuality);
        }
      });
    } catch (e) {
      this._log('dash.js event binding failed:', e);
    }

    this._attachVideoEvents();
  }

  _onDashError(e, mpdUrl) {
    this._log('dash.js error:', e);
    // DRM-related errors are unrecoverable without a license server.
    const errId = e && e.error ? e.error.code || e.error.id : '';
    const errMsg = e && e.error ? (e.error.message || String(e.error)) : String(e);

    // Capability errors typically mean DRM/EME not available.
    if (errId === 'capability' || /mediakeys|eme|drm|protection|keysystem/i.test(errMsg)) {
      this._showError(
        'This DASH stream is DRM-encrypted and cannot be played without a license server.',
        'cenc.mpd streams require a DRM license URL.'
      );
      return;
    }

    // Generic error — show with details.
    this._showError('DASH playback error.', errMsg);
  }

  _revokeBlobs() {
    this._blobUrls.forEach(u => URL.revokeObjectURL(u));
    this._blobUrls = [];
  }

  // ─── EMIT ─────────────────────────────────────────────────────────────────

  _emit(ev, ...args) {
    (this._listeners[ev] || []).forEach(fn => fn(...args));
  }

  _log(...args) {
    if (this._opts.debug) console.log('[StreamPlayer]', ...args);
  }

  // ─── ICONS ────────────────────────────────────────────────────────────────

  get _icons() { return {
    play:           `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
    pause:          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    replay:         `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
    volumeHigh:     `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    volumeMid:      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>`,
    volumeOff:      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`,
    fullscreen:     `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
    exitFullscreen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`,
    settings:       `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
  }; }
}

// ─── Stream type constants exposed for external use ──────────────────────────
StreamPlayer.TYPE = SP_TYPE;

// ─── ES module export ─────────────────────────────────────────────────────────
export { StreamPlayer, SP_TYPE };
export default StreamPlayer;
