// GenZ TV Service Worker
// - Provides offline app-shell caching (network-first, cache fallback)
//   so the PWA can be installed and launched on Smart TVs / phones / PCs.
// - Monetag ad network integration (service worker verification + push ads)
//
// CACHE VERSIONING: Bump CACHE_NAME whenever ad/player code changes
// significantly. Old caches are deleted on `activate`, which forces every
// returning client to fetch fresh JS on their next navigation. Without this,
// the cache-first static-asset policy below would serve stale DynamicAdSlot
// / VideoPlayer bundles forever — and an old sandbox policy (e.g.
// `allow-same-origin` on ad iframes) would keep hijacking iPhone Chrome even
// after a fix ships.
//
// DEV MODE: When running on localhost / 127.0.0.1 (development), the SW does
// NOT intercept or cache ANY fetch requests. This prevents the #1 dev
// headache: a stale cached JS bundle surviving code edits and making the
// admin's security toggle appear non-functional on localhost:3000 even though
// the server serves fresh code. In dev, every request goes straight to the
// network = always fresh code. The activate handler also wipes ALL caches on
// localhost so any previously cached stale bundle is purged the moment this
// SW takes over.

const CACHE_NAME = 'genztv-v5'
const IS_DEV =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname === '0.0.0.0'

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/logo.svg',
  '/favicon.svg',
  '/favicon-dark.svg',
]

// Install event — pre-cache the app shell (production only; in dev we skip
// precaching entirely since we don't cache anything).
self.addEventListener('install', (event) => {
  if (!IS_DEV) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
    )
  }
  // skipWaiting so the new SW activates immediately (replacing any stale one),
  // which is critical for picking up code fixes without waiting for all tabs
  // to close.
  self.skipWaiting()
})

// Activate event — clean up old caches.
// In dev: delete ALL caches (including the current one) so no stale bundle
// can survive. In prod: delete only caches that don't match CACHE_NAME.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const toDelete = IS_DEV ? keys : keys.filter((k) => k !== CACHE_NAME)
      return Promise.all(toDelete.map((k) => caches.delete(k)))
    })
  )
  // claim all clients immediately so the new SW controls the current page
  // right away (otherwise the old SW stays in control until next navigation).
  event.waitUntil(clients.claim())
})

// Fetch event — network-first for navigations AND for JS/CSS chunks (so code
// changes are picked up immediately), cache-first for other static assets.
//
// DEV MODE: In dev we do NOT intercept fetches at all. Returning without
// calling event.respondWith() lets the browser handle the request normally
// (straight to network), which guarantees the freshest code on every reload.
// This is what makes the admin's security toggle reliable on localhost:3000.
self.addEventListener('fetch', (event) => {
  // Dev mode: bypass entirely — no caching, no interception.
  if (IS_DEV) return

  const req = event.request

  // Only handle GET
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Skip cross-origin requests (e.g. ad scripts, stream URLs, analytics)
  if (url.origin !== self.location.origin) return

  // Skip API requests (always go to network)
  if (url.pathname.startsWith('/api/')) return

  // For navigations: network-first, fall back to cached app shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache a copy of the latest navigation response
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    )
    return
  }

  // For JS / CSS / source-map chunks: network-first so code changes ship
  // immediately. Without this, an old DynamicAdSlot sandbox policy would
  // keep hijacking iPhone Chrome until the cache expired.
  const isCodeAsset =
    req.destination === 'script' ||
    req.destination === 'style' ||
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:js|mjs|css|ts|tsx|jsx|map)$/i.test(url.pathname)
  if (isCodeAsset) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || fetch(req)))
    )
    return
  }

  // For other static assets (images, fonts, icons): cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req)
        .then((res) => {
          // Only cache successful, same-origin, basic responses
          if (!res || res.status !== 200 || res.type !== 'basic') return res
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => cached)
    })
  )
})

// ─── Push Notification Handler ───
self.addEventListener('push', (event) => {
  let data = {
    title: 'GenZ TV',
    body: 'New notification',
    url: '/',
    icon: '/logo.svg',
  }

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() }
    } catch {
      data.body = event.data.text()
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/logo.svg',
    badge: '/logo.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Dismiss' },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const urlToOpen = event.notification.data?.url || '/'

  if (event.action === 'close') return

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen)
          return client.focus()
        }
      }
      // Otherwise open a new window
      return clients.openWindow(urlToOpen)
    })
  )
})
