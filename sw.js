// Service worker: permite instalar la app, abrirla rápido y recibir avisos push.
const VERSION = 'inv-v3';
const ARCHIVOS = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/normalize.js', 'js/config.js', 'js/icons.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero la red (para tener siempre la última versión); si no hay, la copia guardada.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // "no-cache": pregunta siempre al servidor si hay versión nueva (si no la hay, no descarga nada)
  const pedido = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(pedido)
      .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Inventario', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Inventario', {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag,
    data: { url: d.url || '#novedades' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = e.notification.data?.url || '#novedades';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs[0];
    if (c) { c.postMessage({ ir: destino.replace(/^#/, '') }); return c.focus(); }
    return self.clients.openWindow('./' + destino);
  }));
});
