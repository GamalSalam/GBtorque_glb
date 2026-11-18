// ═══════════════════════════════════════════════════════════════════
// Gearbox Torque Analyzer -- Service Worker
//
// Purpose: once a user opens the app while online (or "installs" it to
// their phone's home screen), it keeps working with ZERO signal from
// then on. Whenever the app IS online, it quietly checks for a newer
// version in the background and lets the page know -- the page then
// shows a small "tap to update" banner instead of reloading on its own,
// so nobody loses in-progress form data mid-calculation.
//
// ── HOW TO SHIP AN UPDATE ─────────────────────────────────────────
// Bump CACHE_VERSION below (e.g. 'v3' -> 'v4') any time you change
// index.html, src/units.json, or any cached asset. That's the ONLY step
// required -- the version bump is what makes browsers detect this file
// as "changed" and go through the update flow below.
// ═══════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v3';
const CACHE_NAME = 'gbtorque-cache-' + CACHE_VERSION;

// Must ALL exist -- cache.addAll() fails entirely if even one 404s.
const CORE_SHELL = [
    './index.html',
    './manifest.json',
    './src/favicon.png',
    './src/header-logo.png',
    './src/linkage-diagram.png',
    './src/icon-192.png',
    './src/icon-512.png',
];

// Best-effort -- these are optional overrides some users may not have.
// Missing files here must NOT break installation of the core shell.
const OPTIONAL_SHELL = [
    './database.json',
    './src/units.json',
    './equations.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_SHELL);
        await Promise.all(OPTIONAL_SHELL.map(async (url) => {
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (res && res.ok) await cache.put(url, res);
            } catch (e) { /* fine if it doesn't exist -- skip silently */ }
        }));
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

// The page sends this once the user taps the "update available" banner.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // don't touch POSTs etc.

    const url = new URL(req.url);
    const isHTML = req.mode === 'navigate' ||
                   (req.headers.get('accept') || '').includes('text/html');
    const isDataFile = url.pathname.endsWith('.json') || url.pathname.endsWith('equations.js');

    if (isHTML || isDataFile) {
        // Network-first for HTML & data files (units.json, equations.js):
        // always fetch the latest version when online and update the cache;
        // fall back to the cached copy immediately when offline.
        event.respondWith((async () => {
            try {
                const fresh = await fetch(req, { cache: 'no-cache' });
                if (fresh && fresh.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req, fresh.clone());
                }
                return fresh;
            } catch (e) {
                const cached = await caches.match(req);
                return cached || (isHTML ? caches.match('./index.html') : Response.error());
            }
        })());
    } else {
        // Cache-first for static assets (images, icons, etc.)
        event.respondWith((async () => {
            const cached = await caches.match(req);
            const networkFetch = fetch(req).then((res) => {
                if (res && res.ok) {
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
                }
                return res;
            }).catch(() => null);
            return cached || (await networkFetch) || Response.error();
        })());
    }
});
