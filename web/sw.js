// Service worker: only for notifications. Pushes arrive without a payload; the text is fetched from the server with our own cookie.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let n = { title: 'Kumanda', body: 'Something new happened.', url: '/', tag: 'kumanda' };
  try {
    const r = await fetch('/api/push/last', { credentials: 'same-origin' });
    if (r.ok) n = (await r.json()).notification || n;
  } catch { /* offline: show the generic text */ }
  await self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, renotify: true, data: { url: n.url }, icon: '/icon-192.png', badge: '/icon-192.png',
  });
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) {
      windows[0].postMessage({ go: url.replace(/^\//, '') });
      return windows[0].focus();
    }
    return self.clients.openWindow(url);
  })());
});
