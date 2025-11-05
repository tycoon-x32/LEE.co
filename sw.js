const CACHE_NAME = 'lee-global-v1';
const urlsToCache = [
  './',
  './index.html',
  './invest.html',
  './legal.html',
  './manifest.json',
  'https://tse1.mm.bing.net/th/id/OIP.PoFv4AxPJE5rAIT9PcRpQQAAAA?rs=1&pid=ImgDetMain&o=7&rm=3',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});