const CACHE = 'lumen-shell-v21'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  // Cache.put() rejects anything that is not http(s), e.g. chrome-extension://
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (url.origin !== self.location.origin) return
  const isNavigation = request.mode === 'navigate' || (request.headers.get('Accept') || '').includes('text/html')
  event.respondWith(fetch(request).then((response) => {
    if (!response.ok) return response
    const copy = response.clone()
    void caches.open(CACHE).then((cache) => cache.put(request, copy))
    return response
  }).catch(() => caches.match(request).then((cached) => {
    if (cached) return cached
    if (isNavigation) return caches.match('/')
    return Response.error()
  })))
})
