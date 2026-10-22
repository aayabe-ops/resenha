// Service worker mínimo para o PWA ser instalável. Estratégia de cache e
// modo offline ainda não estão definidos nos docs; nada é cacheado aqui.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
