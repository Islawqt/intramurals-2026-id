// Service worker for the installable SSC Admin and SSC Scanner apps: opens instantly from the phone.
// - Files with ?v=<version> never change, so they come straight from the phone (cache first).
// - Pages open from the phone too, then refresh in the background; update.js reloads once when a new version is out.
// - Fonts are kept on the phone. API calls (Apps Script) and version.json always go to the network.
const CACHE = 'ssc-apps-20261109025908';
const PAGES = ['admin.html', 'scanner.html', 'assets/vendor/jsQR.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PAGES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (key, res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return res; };
const cacheFirst = req => caches.match(req).then(hit => hit || fetch(req).then(r => put(req, r)));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));                                    // fonts: keep on the phone
    return;
  }
  if (u.origin !== location.origin || u.pathname.endsWith('/version.json')) return;
  if (req.mode === 'navigate') {
    const key = u.origin + u.pathname;                                 // one saved copy per page
    const net = fetch(req, { cache: 'no-cache' }).then(r => put(key, r));
    if (u.searchParams.has('v')) {                                     // update.js asked for the new version: network first
      e.respondWith(net.catch(() => caches.match(key).then(r => r || Response.error())));
    } else {                                                           // open instantly, refresh in the background
      e.respondWith(caches.match(key).then(hit => hit || net));
      e.waitUntil(net.catch(() => {}));
    }
    return;
  }
  if (u.searchParams.has('v') || /\.(png|webp|jpg|svg|woff2?)$/.test(u.pathname)) {
    e.respondWith(cacheFirst(req));                                    // versioned files and images
    return;
  }
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => put(req, r)).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())));
});
