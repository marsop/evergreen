importScripts("./service-worker-assets.js");
const base = self.registration.scope;
const cachePrefix = "evergreen-assets-" + encodeURIComponent(base) + "-";
const cacheName = cachePrefix + self.assetsManifest.version;
const excluded = new Set(["service-worker.js", "service-worker.published.js", "service-worker-assets.js"]);
const assets = self.assetsManifest.assets.filter(asset => {
    const url = new URL(asset.url, base);
    return url.origin === self.location.origin && url.href.startsWith(base) && !excluded.has(asset.url);
});
const requests = assets.map(asset => new Request(new URL(asset.url, base).href, {
    cache: "reload",
    integrity: asset.hash
}));
// Local test hosts may inject configuration rather than include it in the publish manifest.
const configUrl = new URL("firebase-config.json", base).href;
if (!requests.some(request => request.url === configUrl)) {
    requests.push(new Request(configUrl, { cache: "reload" }));
}
const urls = new Set(requests.map(request => request.url));

self.addEventListener("install", event => event.waitUntil(onInstall()));
self.addEventListener("activate", event => event.waitUntil(onActivate()));

async function onInstall() {
    let existingCache = false;
    try {
        existingCache = (await caches.keys()).includes(cacheName);
        const cache = await caches.open(cacheName);
        await cache.addAll(requests);
    } catch (error) {
        console.error("Evergreen: offline asset installation failed.", error);
        if (!existingCache) await caches.delete(cacheName);
        throw error;
    }
}

async function onActivate() {
    const keys = await caches.keys();
    await Promise.all(keys
        .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));
}

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || !url.href.startsWith(base)) return;
    if (event.request.mode === "navigate") {
        event.respondWith(caches.open(cacheName).then(async cache =>
            (await cache.match(new URL("index.html", base).href)) ?? fetch(event.request)));
    } else if (urls.has(url.href)) {
        event.respondWith(caches.open(cacheName).then(async cache =>
            (await cache.match(event.request)) ?? fetch(event.request)));
    }
});
