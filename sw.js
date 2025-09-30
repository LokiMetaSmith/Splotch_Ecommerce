const CACHE_NAME = 'splotch-cache-v1';
// We're only caching the core, static assets.
// Build artifacts and non-existent files have been removed.
const urlsToCache = [
  '/',
  '/index.html',
  '/splotch-theme.css',
  '/src/index.js',
  '/favicon.png',
  '/favicon192.png',
  '/manifest.json'
];

// Install a service worker
self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // Use a new Request object to avoid issues with caching POST requests or other complex requests
        const cachePromises = urlsToCache.map(url => {
            return cache.add(new Request(url, {cache: 'reload'}));
        });
        return Promise.all(cachePromises);
      })
      .catch(err => {
        console.error('Service Worker cache.addAll failed:', err);
      })
  );
});

// Cache and return requests
self.addEventListener('fetch', event => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET') {
    return;
  }

  // For API requests, always fetch from the network.
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For other requests, try to serve from cache first, then network.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          (response) => {
            // Check if we received a valid response
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      }
    )
  );
});

// Update a service worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});