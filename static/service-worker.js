const CACHE_NAME = 'bi-voice-v2';
const urlsToCache = [
    '/',
    '/static/css/style.css',
    '/static/js/app.js',
    '/static/js/webrtc.js',
    '/static/icons/icon-192x192.png',
    '/static/icons/icon-512x512.png'
];

// Install event
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                return cache.addAll(urlsToCache);
            })
    );
});

// Fetch event
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request)
            .then(function(response) {
                // Return cached version or fetch from network
                return response || fetch(event.request);
            })
    );
});

// Activate event
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Push notification event
self.addEventListener('push', function(event) {
    if (!event.data) return;
    
    const data = event.data.json();
    
    const options = {
        body: data.body,
        icon: '/static/icons/icon-192x192.png',
        badge: '/static/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        tag: 'bi-voice-notification',
        data: {
            url: data.url || '/'
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Notification click event
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});

// Background sync for offline messages
self.addEventListener('sync', function(event) {
    if (event.tag === 'background-sync') {
        event.waitUntil(doBackgroundSync());
    }
});

async function doBackgroundSync() {
    // This would sync any pending messages when connection is restored
    // Implementation would depend on your specific offline strategy
}