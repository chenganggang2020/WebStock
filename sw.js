const CACHE_NAME = 'webstock-static-v36';
const CORE_ASSETS = [
  '/mobile.html',
  '/css/mobile.css',
  '/WebStock.png',
  '/icons/webstock-192.png',
  '/icons/webstock-512.png',
  '/js/modules/quoteSnapshotClientModel.js',
  '/js/modules/mobileSnapshotView.js',
  '/js/mobileApp.js'
];
const OPTIONAL_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/css/compact-terminal.css',
  '/css/fixed-workspace.css',
  '/css/industry-workspace.css',
  '/js/modules/industryWorkspace.js',
  '/js/modules/fixedWorkspace.js',
  '/js/modules/compactTerminal.js',
  '/js/modules/homeTerminal.js',
  '/js/modules/runtimeDiagnostics.js',
  '/css/sector-rotation.css',
  '/js/modules/eastmoneyDarkRank.js',
  '/js/modules/sectorRotation.js',
  '/vendor/echarts.min.js',
  '/js/modules/state.js',
  '/js/modules/apiClient.js',
  '/js/modules/time.js',
  '/js/modules/search.js',
  '/js/modules/marketSignalModel.js',
  '/js/modules/marketHeatmapModel.js',
  '/js/modules/marketComparison.js',
  '/js/modules/marketOverview.js',
  '/js/modules/volumePace.js',
  '/js/modules/industryChain.js',
  '/js/modules/marketInstitutionalFlow.js',
  '/js/modules/externalResearch.js',
  '/js/modules/stockList.js',
  '/js/modules/hotMarket.js',
  '/js/modules/dashboard.js',
  '/js/modules/news.js',
  '/js/modules/aiResearch.js',
  '/js/modules/portfolio.js',
  '/js/modules/compoundLabModel.js',
  '/js/modules/compoundLab.js',
  '/js/modules/commentStrategyModel.js',
  '/js/modules/commentStrategyLab.js',
  '/js/app.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS).then(function() {
        return Promise.allSettled(OPTIONAL_ASSETS.map(function(asset) {
          return cache.add(asset);
        }));
      });
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
        if (cached) return cached;
        return caches.match(url.pathname === '/mobile.html' ? '/mobile.html' : '/index.html');
      });
    })
  );
});

self.addEventListener('push', function(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || '行情与研究 · 数据变化';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '打开应用查看最新状态。',
    icon: '/icons/webstock-192.png',
    badge: '/icons/webstock-192.png',
    tag: 'webstock-private-update',
    renotify: false,
    data: { url: payload.url || '/mobile.html' }
  }));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url || '/mobile.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windows) {
    const existing = windows.find(function(client) { return new URL(client.url).pathname === '/mobile.html'; });
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
