const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync } = require("node:zlib");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "wwwroot", name), "utf8");

test("manifest and icons support root and subpath installation", () => {
    const manifest = JSON.parse(read("manifest.webmanifest"));
    assert.equal(manifest.name, "Evergreen");
    assert.equal(manifest.display, "standalone");
    for (const base of ["https://example.test/", "https://example.test/evergreen/"]) {
        for (const field of ["id", "scope", "start_url"]) {
            assert.equal(new URL(manifest[field], base).href, base);
        }
    }
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512", "512x512"]);
    assert.equal(manifest.icons[2].purpose, "maskable");
    for (const icon of [...manifest.icons, { src: "icons/apple-touch-icon.png", sizes: "180x180" }]) {
        const png = fs.readFileSync(path.join(root, "wwwroot", icon.src));
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        const size = Number(icon.sizes.split("x")[0]);
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
    }
    const index = read("index.html");
    assert.match(index, /rel="manifest" href="manifest.webmanifest"/);
    assert.match(index, /rel="apple-touch-icon" href="icons\/apple-touch-icon.png"/);
    assert.match(index, /name="theme-color" content="#355747"/);
});

function registration({ supported = true, fail = false } = {}) {
    const listeners = {}, errors = [], events = [], calls = [];
    const worker = { state: "installing", addEventListener(name, callback) { this[name] = callback; } };
    const result = {
        installing: worker,
        addEventListener(name, callback) { this[name] = callback; }
    };
    const window = {
        addEventListener(name, callback) { listeners[name] = callback; },
        dispatchEvent(event) { events.push(event.type); }
    };
    const navigator = supported ? { serviceWorker: {
        async register(url, options) {
            calls.push({ url: url.href, options });
            if (fail) throw new Error("Registration failed");
            return result;
        }
    } } : {};
    vm.runInNewContext(read("offline.js"), {
        window, navigator, URL, Event,
        document: { baseURI: "https://example.test/evergreen/" },
        console: { error: (...args) => errors.push(args) }
    });
    return { window, listeners, calls, errors, events, worker };
}

test("registration is scoped and bypasses HTTP caches without forcing activation", async () => {
    const host = registration();
    host.listeners.load();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.calls[0].url, "https://example.test/evergreen/service-worker.js");
    assert.equal(host.calls[0].options.scope, "https://example.test/evergreen/");
    assert.equal(host.calls[0].options.updateViaCache, "none");
    assert.equal(host.window.evergreenOffline.failed, false);
    host.worker.state = "redundant";
    host.worker.statechange();
    assert.equal(host.errors.length, 1);
    assert.deepEqual(host.events, ["evergreen-offline-unavailable"]);
});

test("unsupported browsers and failed registrations explicitly report offline unavailability", async () => {
    assert.equal(registration({ supported: false }).window.evergreenOffline.failed, true);
    const host = registration({ fail: true });
    host.listeners.load();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.window.evergreenOffline.failed, true);
    assert.equal(host.errors.length, 1);
    assert.deepEqual(host.events, ["evergreen-offline-unavailable"]);
});

function worker({ failure = false } = {}) {
    const base = "https://example.test/evergreen/";
    const handlers = {}, stores = new Map(), deleted = [], errors = [], fetched = [];
    const manifest = { version: "v2", assets: [
        { url: "index.html", hash: "sha256-aW5kZXg=" },
        { url: "_framework/dotnet.wasm", hash: "sha256-d2FzbQ==" },
        { url: "firebase-config.json", hash: "sha256-Y29uZmln" },
        { url: "service-worker.js", hash: "sha256-d29ya2Vy" },
        { url: "https://other.test/remote.js", hash: "sha256-cmVtb3Rl" }
    ] };
    const context = vm.createContext({
        URL, Request, Set,
        self: {
            registration: { scope: base },
            location: { origin: "https://example.test" },
            assetsManifest: manifest,
            addEventListener(name, callback) { handlers[name] = callback; }
        },
        importScripts(file) { assert.equal(file, "./service-worker-assets.js"); },
        caches: {
            async open(name) {
                if (!stores.has(name)) stores.set(name, new Map());
                const store = stores.get(name);
                return {
                    async addAll(requests) {
                        if (failure) throw new Error("Integrity mismatch");
                        for (const request of requests) store.set(request.url, request);
                    },
                    async match(request) {
                        const url = typeof request === "string" ? request : request.url;
                        return store.has(url) ? "cached:" + url : undefined;
                    }
                };
            },
            async keys() { return [...stores.keys()]; },
            async delete(name) { deleted.push(name); return stores.delete(name); }
        },
        async fetch(request) { fetched.push(request.url); return "network:" + request.url; },
        console: { error: (...args) => errors.push(args) }
    });
    vm.runInContext(read("service-worker.published.js"), context);
    const cacheName = vm.runInContext("cacheName", context);
    const prefix = vm.runInContext("cachePrefix", context);
    async function lifecycle(name) {
        let pending;
        handlers[name]({ waitUntil(promise) { pending = promise; } });
        return pending;
    }
    function request(url, { method = "GET", mode = "cors" } = {}) {
        let response;
        handlers.fetch({ request: { url: new URL(url, base).href, method, mode },
            respondWith(promise) { response = promise; } });
        return response;
    }
    return { stores, deleted, errors, fetched, cacheName, prefix, lifecycle, request };
}

test("published worker pre-caches integrity-checked assets, not worker control or external traffic", async () => {
    const host = worker();
    await host.lifecycle("install");
    const cached = host.stores.get(host.cacheName);
    assert.equal(cached.size, 3);
    for (const request of cached.values()) {
        assert.match(request.integrity, /^sha256-/);
        assert.equal(request.cache, "reload");
    }
    assert.equal(host.request("service-worker.js"), undefined);
    assert.equal(host.request("https://other.test/remote.js"), undefined);
    assert.equal(host.request("/other/index.html", { mode: "navigate" }), undefined);
    assert.equal(host.request("index.html", { method: "POST" }), undefined);
    assert.equal(host.request("missing.png"), undefined);
});

test("offline navigation returns the shell and missing cache entries fall through to the network", async () => {
    const host = worker();
    await host.lifecycle("install");
    assert.equal(await host.request("plants/details", { mode: "navigate" }),
        "cached:https://example.test/evergreen/index.html");
    assert.match(await host.request("_framework/dotnet.wasm"), /^cached:/);
    host.stores.get(host.cacheName).clear();
    assert.match(await host.request("plants/details", { mode: "navigate" }), /^network:/);
    assert.match(await host.request("_framework/dotnet.wasm"), /^network:/);
});

test("failed installation rejects and removes the incomplete cache", async () => {
    const host = worker({ failure: true });
    await assert.rejects(host.lifecycle("install"), /Integrity mismatch/);
    assert.equal(host.errors.length, 1);
    assert.equal(host.stores.has(host.cacheName), false);
});

test("failed worker-code updates preserve an existing working cache at the same asset version", async () => {
    const host = worker({ failure: true });
    const existing = new Map([["https://example.test/evergreen/index.html", "working"]]);
    host.stores.set(host.cacheName, existing);
    await assert.rejects(host.lifecycle("install"), /Integrity mismatch/);
    assert.equal(host.stores.get(host.cacheName), existing);
    assert.deepEqual(host.deleted, []);
});

test("activation cleans up only obsolete caches for this exact application scope", async () => {
    const host = worker();
    await host.lifecycle("install");
    host.stores.set(host.prefix + "v1", new Map());
    host.stores.set("evergreen-assets-" + encodeURIComponent("https://example.test/other/") + "-v1", new Map());
    host.stores.set("unrelated-cache", new Map());
    await host.lifecycle("activate");
    assert.deepEqual(host.deleted, [host.prefix + "v1"]);
    assert.equal(host.stores.size, 3);
    assert.doesNotMatch(read("service-worker.published.js"), /skipWaiting|clients\.claim/);
    assert.doesNotMatch(read("offline.js"), /location\.reload/);
    assert.doesNotMatch(read("service-worker.js"), /caches\.|respondWith/);
});

test("Pages preparation preserves entry integrity, routing, and versioning for both base paths", async () => {
    const { prepareSite, assetHash } = await import("../Client/prepare-site.mjs");
    const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "evergreen-pwa-unit-"));
    try {
        await fsp.writeFile(path.join(fixture, "index.html"), '<base href="/" />');
        await fsp.writeFile(path.join(fixture, "service-worker-assets.js"),
            'self.assetsManifest = {"version":"original","assets":[{"url":"index.html","hash":"old"}]};');
        for (const name of ["index.html", "service-worker-assets.js"]) {
            await fsp.writeFile(path.join(fixture, name + ".gz"), gzipSync("stale"));
            await fsp.writeFile(path.join(fixture, name + ".br"), brotliCompressSync("stale"));
        }
        let lastVersion;
        for (const basePath of ["/", "/evergreen/"]) {
            await prepareSite(fixture, basePath);
            const index = await fsp.readFile(path.join(fixture, "index.html"), "utf8");
            const context = { self: {} };
            vm.runInNewContext(await fsp.readFile(path.join(fixture, "service-worker-assets.js"), "utf8"), context);
            const manifest = context.self.assetsManifest;
            assert.equal(index, `<base href="${basePath}" />`);
            assert.equal(manifest.assets[0].hash, assetHash(index));
            assert.notEqual(manifest.version, lastVersion);
            lastVersion = manifest.version;
            assert.equal(await fsp.readFile(path.join(fixture, "404.html"), "utf8"), index);
            for (const name of ["index.html", "service-worker-assets.js"]) {
                const expected = await fsp.readFile(path.join(fixture, name), "utf8");
                assert.equal(gunzipSync(await fsp.readFile(path.join(fixture, name + ".gz"))).toString(), expected);
                assert.equal(brotliDecompressSync(await fsp.readFile(path.join(fixture, name + ".br"))).toString(), expected);
            }
            await fsp.access(path.join(fixture, ".nojekyll"));
            await prepareSite(fixture, basePath);
            vm.runInNewContext(await fsp.readFile(path.join(fixture, "service-worker-assets.js"), "utf8"), context);
            assert.equal(context.self.assetsManifest.version, lastVersion);
        }
        await assert.rejects(prepareSite(fixture, "../escape"), /base path/);
        await fsp.writeFile(path.join(fixture, "service-worker-assets.js"), 'self.assetsManifest = {"assets":[]};');
        await assert.rejects(prepareSite(fixture, "/"), /contain index.html/);
    } finally {
        await fsp.rm(fixture, { recursive: true });
    }
});
