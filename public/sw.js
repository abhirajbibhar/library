/* Service worker: installable app, instant start, and offline reading.
 *
 *  - SHELL   the app's own files (so it opens without a network).
 *  - API     the last answer of read-only API calls (book list, notes, progress ...), used only when offline.
 *  - OFFLINE whole PDFs you saved for offline reading, answered with HTTP range support so the reader works.
 *
 * Everything else, and every write (PUT/POST/PATCH/DELETE), always goes straight to the network. */
const SHELL = 'library-shell-v2';
const API = 'library-api-v1';
const OFFLINE = 'library-offline-v1';
const KEEP = [SHELL, API, OFFLINE];

// Read-only answers worth keeping a copy of
const API_COPY = [
  /^\/api\/documents$/,
  /^\/api\/metadata\/[^/]+$/,
  /^\/api\/annotations(\/[^/]+)?$/,
  /^\/api\/quotes$/,
  /^\/api\/reading$/,
  /^\/api\/storage$/,
  /^\/api\/session$/,
];
const PDF_PATH = /^\/api\/documents\/[^/]+$/;
const COVER_PATH = /^\/api\/covers\/[^/]+$/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png']))
      .catch(() => {}), // e.g. behind a login redirect: pages are cached as they are visited instead
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/** Network first; when the network fails, the last good answer. */
async function networkFirst(req) {
  const cache = await caches.open(API);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req.url);
    if (hit) return hit;
    throw err;
  }
}

/** Covers never change under the same URL (the URL carries a version), so a saved copy is always right. */
async function coverFirst(req) {
  const cache = await caches.open(API);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}

/** A PDF request goes to the network; only if that fails do we answer from a saved copy (with range support). */
async function pdf(req) {
  try {
    return await fetch(req);
  } catch (err) {
    const saved = await savedPdf(req);
    if (saved) return saved;
    throw err;
  }
}

async function savedPdf(req) {
  const cache = await caches.open(OFFLINE);
  const stored = await cache.match(new URL(req.url).pathname, { ignoreMethod: true });
  if (!stored) return null;

  const blob = await stored.blob();
  const size = blob.size;
  const headers = { 'Content-Type': stored.headers.get('Content-Type') || 'application/pdf', 'Accept-Ranges': 'bytes' };
  const etag = stored.headers.get('ETag');
  if (etag) headers.ETag = etag;

  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (!m) return new Response(blob, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });

  let start;
  let end;
  if (m[1] === '') {
    // "the last N bytes"
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start < size) || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    if (PDF_PATH.test(path)) return void event.respondWith(pdf(req));
    if (req.method !== 'GET') return;
    if (COVER_PATH.test(path)) return void event.respondWith(coverFirst(req));
    if (API_COPY.some((re) => re.test(path))) return void event.respondWith(networkFirst(req));
    return; // everything else: network only
  }

  if (req.method !== 'GET') return;

  // Pages: network first, so a new deploy shows up immediately; the saved copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build files and icons never change under the same URL: cache first.
  if (path.startsWith('/assets/') || path.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
