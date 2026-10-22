/* Cache only the static editor shell and bundled assets. Private API responses
 * and account pages are NEVER cached here; account-scoped drafts use IndexedDB. */
const CACHE = 'uno-word-editor-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_EDITOR_ASSETS') return;
  const urls = (event.data.urls || []).filter(value => {
    try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && (url.pathname === '/editor' || /^\/assets\/[\w.-]+\.(js|css|woff2?)$/.test(url.pathname)); }
    catch { return false; }
  }).slice(0, 100);
  event.waitUntil(caches.open(CACHE).then(async cache => {
    // Publish a new offline shell only after its complete asset set is cached.
    // Interrupted updates keep the previous working shell instead of mixing builds.
    const assets=[...new Set(urls.filter(value=>new URL(value,self.location.origin).pathname!=='/editor'))];
    await cache.addAll(assets.map(url=>new Request(url,{credentials:'omit'})));
    await cache.add(new Request('/editor',{credentials:'omit'}));
  }).catch(()=>{}));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate' && url.pathname === '/editor') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/editor')).then(response => response || Response.error())));
  } else if (/^\/assets\/[\w.-]+\.(js|css|woff2?)$/.test(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || Response.error())));
  }
});
