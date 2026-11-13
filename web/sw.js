// Servis çalışanı: yalnızca bildirimler için. İtme içeriksiz gelir; metni kendi çerezimizle sunucudan alırız.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let b = { baslik: 'Kumanda', govde: 'Yeni bir gelişme var.', url: '/', etiket: 'kumanda' };
  try {
    const r = await fetch('/api/bildirim/son', { credentials: 'same-origin' });
    if (r.ok) b = (await r.json()).bildirim || b;
  } catch { /* çevrimdışı: genel metinle göster */ }
  await self.registration.showNotification(b.baslik, {
    body: b.govde, tag: b.etiket, renotify: true, data: { url: b.url }, icon: '/ikon-192.png', badge: '/ikon-192.png',
  });
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (pencereler.length) {
      pencereler[0].postMessage({ git: url.replace(/^\//, '') });
      return pencereler[0].focus();
    }
    return self.clients.openWindow(url);
  })());
});
