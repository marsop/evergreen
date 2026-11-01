import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { chromium } from "playwright";
import { prepareSite, assetHash } from "../Client/prepare-site.mjs";

const root = path.resolve("publish", "wwwroot");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".css": "text/css", ".wasm": "application/wasm",
    ".png": "image/png", ".svg": "image/svg+xml" };
let temporary, browser, server, origin;
const sites = new Map();
const serverErrors = [];

function manifest(source) {
    const context = { self: {} };
    vm.runInNewContext(source, context);
    return context.self.assetsManifest;
}

before(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "evergreen-pwa-browser-"));
    for (const [key, basePath] of [["root", "/"], ["subpath", "/evergreen/"]]) {
        const directory = path.join(temporary, key);
        await fs.mkdir(directory);
        for (const name of ["index.html", "service-worker-assets.js"]) {
            await fs.copyFile(path.join(root, name), path.join(directory, name));
        }
        await prepareSite(directory, basePath);
        sites.set(basePath, directory);
    }
    server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
            const basePath = pathname.startsWith("/evergreen/") ? "/evergreen/" : "/";
            const relative = pathname.slice(basePath.length) || "index.html";
            response.setHeader("Cache-Control", "no-store");
            if (relative === "firebase-config.json") {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ apiKey: "demo-key", appId: "demo-app",
                    projectId: "demo-evergreen", authDomain: "demo-evergreen.firebaseapp.com", emulators: true }));
                return;
            }
            const file = path.resolve(root, relative);
            if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
            const body = await fs.readFile(["index.html", "404.html", "service-worker-assets.js"].includes(relative)
                ? path.join(sites.get(basePath), relative) : file);
            response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
            response.end(body);
        } catch (error) {
            if (error.code === "ENOENT") response.writeHead(404).end();
            else {
                serverErrors.push(error.message);
                response.writeHead(500).end();
            }
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
});

after(async () => {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (temporary) await fs.rm(temporary, { recursive: true });
});

test("published worker and all generated asset integrity hashes match disk output", async () => {
    assert.match(await fs.readFile(path.join(root, "service-worker.js"), "utf8"), /importScripts/);
    const assets = manifest(await fs.readFile(path.join(root, "service-worker-assets.js"), "utf8")).assets;
    assert.ok(assets.some(asset => asset.url === "manifest.webmanifest"));
    assert.ok(assets.some(asset => asset.url === "icons/icon-512.png"));
    assert.ok(assets.some(asset => /_framework\/de\//.test(asset.url)));
    assert.ok(assets.some(asset => /_framework\/es\//.test(asset.url)));
    for (const asset of assets) {
        assert.equal(asset.hash, assetHash(await fs.readFile(path.join(root, asset.url))), asset.url);
    }
});

test("root and subpath PWAs are installable, reload offline, and activate updates without forced reloads",
    { timeout: 180000 }, async () => {
        const context = await browser.newContext();
        try {
            const pages = [];
            // Install the narrower scope before the root worker can control its first navigation.
            for (const basePath of ["/evergreen/", "/"]) {
                const page = await context.newPage();
                pages.push(page);
                page.on("pageerror", error => console.error("PWA browser:", error.message));
                page.on("console", message => {
                    if (message.type() === "error") console.error("PWA browser:", message.text());
                });
                await page.goto(origin + basePath);
                await page.locator(".account-status select").waitFor({ timeout: 30000 }).catch(async error => {
                    console.error("PWA startup document:", await page.locator("body").innerText());
                    console.error("PWA startup location:", await page.evaluate(() => ({ url: location.href, base: document.baseURI })));
                    throw error;
                });
                await page.evaluate(() => navigator.serviceWorker.ready);
                await page.reload();
                await page.locator(".account-status select").waitFor();
                assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);
                const cdp = await context.newCDPSession(page);
                const appManifest = await cdp.send("Page.getAppManifest");
                assert.deepEqual(appManifest.errors, []);
                assert.equal(JSON.parse(appManifest.data).name, "Evergreen");
                const diagnostics = await cdp.send("Page.getInstallabilityErrors");
                assert.deepEqual(diagnostics.installabilityErrors, []);
                await cdp.detach();
            }
            const subpathPage = pages[0];
            const beforeUpdate = await subpathPage.evaluate(() => caches.keys());
            assert.equal(beforeUpdate.length, 2);
            await context.setOffline(true);
            for (const page of pages) {
                await page.reload();
                await page.locator(".account-status select").waitFor({ timeout: 30000 });
                await page.locator(".account-status select").selectOption("de");
                assert.equal(await page.locator("html").getAttribute("lang"), "de");
                await page.locator(".account-status select").selectOption("es");
                assert.equal(await page.locator("html").getAttribute("lang"), "es");
                await page.reload();
                await page.locator(".account-status select").waitFor();
                assert.equal(await page.locator(".account-status select").inputValue(), "es");
                const image = await page.evaluate(async () => {
                    const image = new Image();
                    image.src = new URL("icons/icon-512.png", document.baseURI).href;
                    await image.decode();
                    return image.naturalWidth;
                });
                assert.equal(image, 512);
            }
            await subpathPage.locator(".account-status select").selectOption("en");
            await subpathPage.goto(origin + "/evergreen/counter");
            await subpathPage.getByRole("button", { name: /Click me/ }).waitFor();
            await subpathPage.getByRole("button", { name: /Click me/ }).click();
            assert.match(await subpathPage.getByRole("status").innerText(), /1/);
            await context.setOffline(false);
            const directory = sites.get("/evergreen/");
            await fs.appendFile(path.join(directory, "index.html"), "\n<!-- PWA update test -->");
            await prepareSite(directory, "/evergreen/");
            const version = manifest(await fs.readFile(path.join(directory, "service-worker-assets.js"), "utf8")).version;
            const updatedCache = "evergreen-assets-" + encodeURIComponent(origin + "/evergreen/") + "-" + version;
            await subpathPage.evaluate(async () => {
                window.pwaSentinel = "editing";
                await (await navigator.serviceWorker.getRegistration()).update();
            });
            await subpathPage.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting !== null);
            assert.equal(await subpathPage.evaluate(() => window.pwaSentinel), "editing");
            assert.match(await subpathPage.getByRole("status").innerText(), /1/);
            await subpathPage.close();
            const reopened = await context.newPage();
            await reopened.goto(origin + "/evergreen/");
            await reopened.waitForFunction(async expected => {
                const keys = await caches.keys();
                return keys.includes(expected) && keys.length === 2;
            }, updatedCache);
            const afterUpdate = await reopened.evaluate(() => caches.keys());
            assert.ok(afterUpdate.includes(beforeUpdate.find(key => key.includes(encodeURIComponent(origin + "/") + "-"))));
            const updatedResponse = await reopened.reload();
            assert.match(await updatedResponse.text(), /PWA update test/);
            await reopened.locator(".account-status select").waitFor();
            assert.deepEqual(serverErrors, []);
        } finally {
            await context.close();
        }
    });
