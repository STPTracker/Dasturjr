/* ============================================================
   Service worker — offline shell for the scanner PWA.
   Caches the app shell so the scanner UI still loads offline;
   actual attendance writes still require a live Firebase
   connection (or your own offline-queue implementation — see
   spec section 21 / FIREBASE_SETUP.md for guidance on adding
   IndexedDB-backed sync-on-reconnect).
   ============================================================ */

const CACHE_NAME = "veritap-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./css/scanner.css",
  "./js/demo-data.js",
  "./js/firebase.js",
  "./js/nfc.js",
  "./js/webauthn.js",
  "./js/app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network-first for anything cross-origin (Firebase, fonts); cache-first for the shell.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
