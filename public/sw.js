/**
 * Service worker.
 *
 * Strategy per asset class:
 *
 * - Navigation requests: network first, falling back to the cached shell. A
 *   chat app must never serve a stale page from cache when the network is up,
 *   but an installed app that shows the OS offline page feels broken.
 * - Hashed build assets: cache first. Their filenames change on every build,
 *   so a cached copy is always the correct copy.
 * - Everything else: network first with a cache fallback.
 *
 * The API is never cached: replies and model lists must be live.
 */

const VERSION = 'lumen-shell-v59'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key.startsWith('lumen-shell-') && key !== VERSION).map(key => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Live data only.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            event.waitUntil(caches.open(VERSION).then(cache => cache.put('/index.html', copy)).catch(() => {}))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then(cached => cached ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ??
          fetch(request).then(response => {
            if (response.ok) {
              const copy = response.clone()
              event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy)).catch(() => {}))
            }
            return response
          }),
      ),
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy)).catch(() => {}))
        }
        return response
      })
      .catch(() => caches.match(request).then(cached => cached ?? Response.error())),
  )
})
