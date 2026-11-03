// アプリ本体をキャッシュしてオフラインで起動できるようにする。
// キャッシュを先に返しつつ裏で更新するので、変更は次回の起動で反映される。
const CACHE = 'payslip-app-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/backup.js',
  'js/claude.js',
  'js/db.js',
  'js/domain.js',
  'js/lock.js',
  'js/router.js',
  'js/scan.js',
  'js/util.js',
  'js/views/add.js',
  'js/views/detail.js',
  'js/views/form.js',
  'js/views/list.js',
  'js/views/redact.js',
  'js/views/settings.js',
  'js/views/trends.js',
];

self.addEventListener('install', (event) => {
  const requests = ASSETS.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 自サイトの GET だけを扱う。API への通信には関与しない
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      // ブラウザの HTTP キャッシュで更新を見逃さないよう、必ずサーバーに確認する
      const network = fetch(event.request.url, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
