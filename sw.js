const CACHE_NAME = 'webstock-static-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/vendor/echarts.min.js',
  '/WebStock.png',
  '/icons/webstock-192.png',
  '/icons/webstock-512.png',
  '/js/modules/state.js',
  '/js/modules/apiClient.js',
  '/js/modules/search.js',
  '/js/modules/stockList.js',
  '/js/modules/hotMarket.js',
  '/js/modules/dashboard.js',
  '/js/modules/news.js',
  '/js/modules/portfolio.js',
  '/js/app.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) {
        return key !== CACHE_NAME;
      }).map(function(key) {
        return caches.delete(key);
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/ai-status') return;

  event.respondWith(
    fetch(request).then(function(response) {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(request, copy);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(request).then(function(cached) {
        return cached || caches.match('/index.html');
      });
    })
  );
});
