

self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    const options = {
        body: data.body || 'تم وصول بطاقتك، يرجى الحضور للاستلام',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        tag: 'card-notification',
        renotify: true,
        requireInteraction: true,
        data: {
            url: data.url || '/',
            requestNumber: data.requestNumber
        },
        actions: [
            {
                action: 'open',
                title: 'عرض التفاصيل'
            },
            {
                action: 'close',
                title: 'إغلاق'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'الأحوال المدنية', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    if (event.action === 'open') {
        const urlToOpen = event.notification.data?.url || '/';
        event.waitUntil(
            clients.openWindow(urlToOpen)
        );
    }
});

self.addEventListener('notificationclose', function(event) {
    console.log('Notification closed');
});

self.addEventListener('install', function(event) {
    console.log('Service Worker installed');
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    console.log('Service Worker activated');
    event.waitUntil(clients.claim());
});