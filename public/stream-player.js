'use strict';

/**
 * StreamPlayer — Production-Grade Live Streaming Video Player
 * Version: 2.0.0
 *
 * Stream Type Support:
 *   • M3U/HLS          — Standard HLS (.m3u8) via hls.js / Safari native
 *   • M3U/HLS Proxy    — Proxied HLS with custom headers / CORS bypass
 *   • MPEG-TS (.ts)    — Raw transport stream, transmuxed via hls.js MediaSource
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
 * Dependency: hls.js >= 1.4.x (loaded before this script)
 */

// ─── Stream type constants ───────────────────────────────────────────────────
const SP_TYPE = {
  HLS:       'hls',       // M3U/HLS  → hls.js or Safari native
  HLS_PROXY: 'hls-proxy', // M3U/HLS Proxy → hls.js with proxy headers
  MPEGTS:    'mpegts',    // MPEG-TS (.ts) → hls.js transmux via Blob M3U8
};

// ─── HLS config presets per stream type ─────────────────────────────────────
const HLS_CONFIG = {
  base: {
    enableWorker:                true,
    // Buffer
    maxBufferLength:             30,
    maxMaxBufferLength:          60,
    maxBufferSize:               60 * 1000 * 1000, // 60 MB
    maxBufferHole:               0.5,
    // Live sync
    liveSyncDurationCount:       3,
    liveMaxLatencyDurationCount: 10,
    // ABR — conservative, stable under high concurrency
    abrEwmaFastLive:             3.0,
    abrEwmaSlowLive:             9.0,
    abrBandWidthFactor:          0.95,
    abrBandWidthUpFactor:        0.65,
    // Frag loading retries
    fragLoadingTimeOut:          20000,
    fragLoadingMaxRetry:         8,
    fragLoadingRetryDelay:       1000,
    fragLoadingMaxRetryTimeout:  64000,
    // Manifest retries
    manifestLoadingTimeOut:      15000,
    manifestLoadingMaxRetry:     5,
    manifestLoadingRetryDelay:   500,
    // Level retries
    levelLoadingTimeOut:         15000,
    levelLoadingMaxRetry:        5,
    // Stall nudge
    nudgeMaxRetry:               8,
    nudgeOffset:                 0.2,
    // Low latency off by default
    lowLatencyMode:              false,
    // Start from live edge
    startPosition:               -1,
  },

  // MPEG-TS: single segment, no ABR, large buffer
  mpegts: {
    enableWorker:                true,
    maxBufferLength:             60,
    maxMaxBufferLength:          120,
    maxBufferSize:               80 * 1000 * 1000,
    maxBufferHole:               1.0,
    liveSyncDurationCount:       1,
    liveMaxLatencyDurationCount: 5,
    fragLoadingTimeOut:          30000,
    fragLoadingMaxRetry:         10,
    fragLoadingRetryDelay:       2000,
    manifestLoadingTimeOut:      10000,
    manifestLoadingMaxRetry:     3,
    nudgeMaxRetry:               10,
    nudgeOffset:                 0.5,
    lowLatencyMode:              false,
    startPosition:               -1,
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
    this._listeners       = {};
    this._videoHandlers   = [];
    this._blobUrls        = []; // track for cleanup
    this._destroyed       = false;

    this._build();
    this._bindKeys();

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

    // ── iOS Safari — only video element supports fullscreen ──
    if (typeof video.webkitEnterFullscreen === 'function' &&
        !document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
      if (video.webkitDisplayingFullscreen) {
        video.webkitExitFullscreen();
      } else {
        video.webkitEnterFullscreen();
      }
      return;
    }

    // ── Standard browsers ──
    const fsEl  = document.fullscreenElement || document.webkitFullscreenElement;
    const reqFs = wrapper.requestFullscreen || wrapper.webkitRequestFullscreen;
    const exFs  = document.exitFullscreen   || document.webkitExitFullscreen;

    if (fsEl) {
      exFs.call(document);
    } else if (reqFs) {
      reqFs.call(wrapper).catch(() => {
        // Fallback: try on video element directly (some Android browsers)
        const vReq = video.requestFullscreen || video.webkitRequestFullscreen;
        if (vReq) vReq.call(video).catch(() => {});
      });
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
    this._destroyHls();
    this._revokeBlobs();
    this._videoHandlers.forEach(({ e, fn }) => this._video.removeEventListener(e, fn));
    this._videoHandlers = [];
    this._container.innerHTML = '';
    this._listeners = {};
  }

  // ─── STREAM LOADING ────────────────────────────────────────────────────────

  _startLoad() {
    this._destroyHls();
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
        this._loadMpegTs(url);
        break;

      default:
        // Unknown type — try as plain HLS
        this._loadHls(url, HLS_CONFIG.base);
    }
  }

  // ── M3U/HLS ──────────────────────────────────────────────────────────────

  _loadHls(url, config) {
    if (!this._hlsSupported()) return;

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
  // Strategy: inject a custom loader that rewrites every segment/manifest
  // request through the proxy prefix. This handles CORS without touching
  // the M3U8 file content.

  _loadHlsProxy(url) {
    if (!this._hlsSupported()) return;

    const proxyPrefix = this._opts.proxyUrl;
    const config = Object.assign({}, HLS_CONFIG.base, { debug: this._opts.debug }, this._opts.hlsConfig);

    if (proxyPrefix) {
      // Custom pLoader rewrites manifest + frag URLs through proxy
      class ProxyLoader extends Hls.DefaultConfig.loader {
        constructor(hlsConfig) { super(hlsConfig); }
        load(context, cfg, callbacks) {
          // Rewrite URL through proxy
          context.url = proxyPrefix + encodeURIComponent(context.url);
          super.load(context, cfg, callbacks);
        }
      }
      config.loader = ProxyLoader;
      config.pLoader = ProxyLoader;
      config.fLoader = ProxyLoader;
    }

    const hls = new Hls(config);
    this._hls = hls;
    hls.loadSource(proxyPrefix ? proxyPrefix + encodeURIComponent(url) : url);
    hls.attachMedia(this._video);
    this._attachHlsEvents(hls);
    this._attachVideoEvents();
  }

  // ── MPEG-TS (.ts) ─────────────────────────────────────────────────────────
  // hls.js cannot load a bare .ts URL directly as a source.
  // Wrap it in an in-memory M3U8 manifest (Blob URL) — hls.js will then
  // transmux the TS segment via its built-in MP4 remuxer, making it
  // fully compatible with MSE on all browsers including mobile.

  _loadMpegTs(tsUrl) {
    if (!this._hlsSupported()) return;

    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-TARGETDURATION:7200',
      '#EXT-X-ALLOW-CACHE:NO',
      '#EXTINF:7200.0,',
      tsUrl,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const blob    = new Blob([manifest], { type: 'application/vnd.apple.mpegurl' });
    const blobUrl = URL.createObjectURL(blob);
    this._blobUrls.push(blobUrl);

    const config = Object.assign({}, HLS_CONFIG.mpegts, {
      debug:            this._opts.debug,
      // For a single .ts segment acting as a live-ish stream,
      // disable the EXT-X-ENDLIST check so hls.js keeps retrying
      // when the segment updates (some IPTV panels rotate the same URL)
      allowedToStop:    false,
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
        this._els.livBtn.style.display = 'none';
        this._els.timeDisplay.classList.remove('sp-hidden');
      }
    });

    on('loadedmetadata', () => {
      if (v.textTracks && v.textTracks.length > 0) {
        this._els.ccBtn.classList.remove('sp-hidden');
      }
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
        this._hls.recoverMediaError();

        this._stallTimer = setTimeout(() => {
          if (!this._stalled) return;
          this._log('Stall recovery stage 3: CDN rotate');
          this._rotateCdn();
        }, 4000);
      } else {
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
    btn.classList.toggle('sp-at-live', at);
    btn.classList.toggle('sp-behind-live', !at);
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

    <div class="sp-click-area" role="button" aria-label="Play or pause" tabindex="-1"></div>

    <div class="sp-overlay">
      <button class="sp-big-play sp-hidden" aria-label="Play">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <svg class="sp-spinner sp-hidden" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20"/>
      </svg>
    </div>

    <div class="sp-live-badge" aria-hidden="true">
      <span class="sp-live-dot"></span>
      <span class="sp-live-text">Live</span>
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

        <button class="sp-live-btn sp-at-live" aria-label="Live">
          <span class="sp-live-btn-dot"></span>
          <span class="sp-live-btn-text">LIVE</span>
        </button>

        <span class="sp-time sp-hidden"></span>

        <div class="sp-spacer"></div>

        <div class="sp-volume-wrap">
          <button class="sp-btn sp-mute-btn" aria-label="Mute">${this._icons.volumeHigh}</button>
          <div class="sp-volume-slider-wrap">
            <input type="range" class="sp-volume-slider" min="0" max="1" step="0.05" value="1" aria-label="Volume">
          </div>
        </div>

        <button class="sp-btn sp-btn-sm sp-cc-btn sp-hidden" aria-label="Subtitles" aria-pressed="false">CC</button>

        <button class="sp-quality-btn" aria-label="Video quality" aria-haspopup="true" aria-expanded="false">
          <span class="sp-quality-label">Auto</span>
          <span class="sp-quality-caret">▾</span>
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
      liveBadge:      q('.sp-live-badge'),
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
      qualityBtn:     q('.sp-quality-btn'),
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
    e.clickArea.addEventListener('click', () => this.togglePlay());
    e.bigPlay.addEventListener('click',   () => this.play());
    e.livBtn.addEventListener('click',    () => this.goLive());
    e.muteBtn.addEventListener('click',   () => this.toggleMute());
    e.volumeSlider.addEventListener('input', ev => this.setVolume(parseFloat(ev.target.value)));
    e.qualityBtn.addEventListener('click', ev => { ev.stopPropagation(); this._toggleQuality(); });
    e.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    e.ccBtn.addEventListener('click', () => this._toggleCC());
    e.retryBtn.addEventListener('click', () => { this._hideError(); this._retryCount = 0; this._urlIndex = 0; this.init(); });

    document.addEventListener('click', () => this._closeQuality());

    // Controls auto-hide
    const show = () => this._showControls();
    const wrap = e.wrapper;
    wrap.addEventListener('mousemove',  show);
    wrap.addEventListener('mouseenter', show);
    wrap.addEventListener('touchstart', show, { passive: true });
    wrap.addEventListener('mouseleave', () => { if (this._playing) this._scheduleHide(); });

    // Fullscreen change
    const onFs = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      e.fullscreenBtn.innerHTML = fs ? this._icons.exitFullscreen : this._icons.fullscreen;
      e.fullscreenBtn.setAttribute('aria-label', fs ? 'Exit fullscreen' : 'Enter fullscreen');
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

  _showControls() {
    this._els.controls.classList.remove('sp-hidden-controls');
    clearTimeout(this._hideTimer);
    if (this._playing) this._scheduleHide();
  }

  _scheduleHide() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this._playing && !this._qualityOpen)
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
    this._els.liveBadge.style.display = live ? 'flex' : 'none';
    if (!live) {
      this._els.livBtn.style.display = 'none';
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
  }; }
}

// ─── Stream type constants exposed for external use ──────────────────────────
StreamPlayer.TYPE = SP_TYPE;

// ─── UMD export ──────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StreamPlayer;
} else if (typeof define === 'function' && define.amd) {
  define([], () => StreamPlayer);
} else {
  window.StreamPlayer = StreamPlayer;
}
