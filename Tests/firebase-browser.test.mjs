import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { prepareSite } from "../Client/prepare-site.mjs";

let server, browser, origin, prepared;
const root = path.resolve("publish", "wwwroot");
const config = { apiKey: "demo-key", projectId: "demo-evergreen", authDomain: "demo-evergreen.firebaseapp.com", appId: "demo-app", emulators: true };
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".wasm": "application/wasm", ".webp": "image/webp", ".svg": "image/svg+xml" };
before(async () => {
    await fs.access(path.join(root, "index.html"));
    prepared = await fs.mkdtemp(path.join(os.tmpdir(), "evergreen-firebase-site-"));
    for (const name of ["index.html", "service-worker-assets.js"]) {
        await fs.copyFile(path.join(root, name), path.join(prepared, name));
    }
    await prepareSite(prepared, "/evergreen/");
    server = http.createServer(async (request, response) => {
        try {
            const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/evergreen\//, "");
            if (relative === "firebase-config.json") {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify(config));
                return;
            }
            const file = path.resolve(root, relative || "index.html");
            if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
            const body = await fs.readFile(["index.html", "service-worker-assets.js"].includes(relative || "index.html")
                ? path.join(prepared, relative || "index.html") : file);
            response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
            response.end(body);
        } catch (exception) {
            if (exception.code === "ENOENT") response.writeHead(404).end();
            else {
                console.error("Browser test server:", exception);
                response.writeHead(500).end();
            }
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}/evergreen/`;
    browser = await chromium.launch();
});
after(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
    if (prepared) await fs.rm(prepared, { recursive: true });
});

async function signIn(page, email) {
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    if (await popup.getByText(email, { exact: true }).count()) {
        await popup.getByText(email, { exact: true }).click();
    } else {
        await popup.getByText("Add new account", { exact: true }).click();
        await popup.locator("#email-input").fill(email);
        await popup.locator("#display-name-input").fill(email.split("@")[0]);
        await popup.locator("#sign-in").click();
    }
    await page.locator(".app-shell").waitFor({ timeout: 30000 });
}
async function synced(page) {
    await page.getByText("Garden synchronized.", { exact: true }).waitFor({ timeout: 30000 });
}
async function submit(page) {
    await page.locator(".modal button[type='submit']").click();
    await page.locator(".modal").waitFor({ state: "hidden" });
}
test("private seeded garden, compressed photos, offline reload/sync and language", { timeout: 180000 }, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") console.error("BROWSER:", message.text()); });
    await page.goto(origin);
    await signIn(page, "garden-alice@example.test");
    await synced(page);
    assert.match(await page.locator(".sidebar-foot").innerText(), /23 plants/);
    await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
    await page.getByRole("button", { name: "Add plant", exact: true }).click();
    await page.getByLabel("Plant name", { exact: true }).fill("Offline fern");
    await page.locator(".modal .language-selector select").selectOption("de");
    assert.equal(await page.locator(".modal input[maxlength='60']").inputValue(), "Offline fern");
    await page.locator(".modal .language-selector select").selectOption("en");
    await submit(page);
    await synced(page);
    assert.match(await page.locator(".sidebar-foot").innerText(), /24 plants/);
    await page.reload();
    await page.locator(".app-shell").waitFor();
    assert.match(await page.locator(".sidebar-foot").innerText(), /24 plants/);

    await page.getByRole("button", { name: "Log care", exact: true }).click();
    await page.locator(".modal select").filter({ has: page.locator('option[value="Photo"]') }).selectOption("Photo");
    const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 2400; canvas.height = 1800;
        const context = canvas.getContext("2d");
        context.fillStyle = "#47aa77";
        context.fillRect(0, 0, 2400, 1800);
        return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator(".modal input[type='file']").setInputFiles({ name: "plant.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.locator(".photo-preview").waitFor();
    await page.locator(".modal textarea").fill("Photo kept in Firebase");
    await submit(page);
    await synced(page);

    await page.evaluate(() => navigator.serviceWorker.ready.then(registration => registration.active.state));
    await page.reload();
    await page.locator(".app-shell").waitFor();
    await context.setOffline(true);
    await page.locator(".primary-nav").getByRole("button", { name: /^Today/ }).click();
    await page.locator(".water-button").first().click();
    await page.getByText("Offline: 1 edits waiting to sync.", { exact: true }).waitFor();
    await page.locator(".primary-nav").getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: "Add place", exact: true }).click();
    await page.getByLabel("Place name", { exact: true }).fill("Offline room");
    await submit(page);
    await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
    await page.getByRole("button", { name: "Add plant", exact: true }).click();
    await page.getByLabel("Plant name", { exact: true }).fill("Queued plant");
    await page.locator(".modal select").filter({ has: page.locator("option").filter({ hasText: "Offline room" }) }).selectOption({ label: "Offline room" });
    await submit(page);
    await page.getByRole("button", { name: "Log care", exact: true }).click();
    await page.locator(".modal select").filter({ has: page.locator('option[value="Photo"]') }).selectOption("Photo");
    await page.locator(".modal input[type='file']").setInputFiles({ name: "offline.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.locator(".photo-preview").waitFor();
    await page.locator(".modal textarea").fill("Offline photo");
    await submit(page);
    await page.locator(".account-status select").selectOption("de");
    await page.getByText("Offline: 5 Änderungen warten auf Synchronisierung.", { exact: true }).waitFor();
    await page.reload();
    await page.locator(".app-shell").waitFor({ timeout: 30000 });
    assert.equal(await page.locator(".account-status select").inputValue(), "de");
    assert.match(await page.locator(".sidebar-foot").innerText(), /25/);
    await page.locator(".account-status select").selectOption("en");
    await page.getByText("Offline: 6 edits waiting to sync.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByText(/Sign-out is waiting/).waitFor();
    await page.locator(".primary-nav").getByRole("button", { name: /^Today/ }).click();
    assert.ok(await page.locator(".water-button.done").count() >= 1);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry synchronization", exact: true }).click();
    await synced(page);
    await page.locator(".primary-nav").getByRole("button", { name: "Journal", exact: true }).click();
    await page.getByRole("button", { name: "Load photo", exact: true }).first().click();
    const photo = await page.locator(".journal-photo").first().evaluate(image => ({
        bytes: atob(image.src.split(",")[1]).length,
        width: image.naturalWidth, height: image.naturalHeight
    }));
    assert.ok(photo.bytes <= 512 * 1024 && photo.bytes > 0);
    assert.ok(photo.width <= 1600 && photo.height <= 1600);
    await page.locator(".account-status select").selectOption("es");
    await page.getByText("Jardín sincronizado.", { exact: true }).waitFor();
    await page.reload();
    await page.locator(".app-shell").waitFor();
    assert.equal(await page.locator(".account-status select").inputValue(), "es");
    assert.deepEqual(errors, []);
    await context.close();
});

async function editPlant(page, currentName, field, value) {
    await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
    await page.locator(".plant-list-row").filter({ hasText: currentName }).first().click();
    await page.getByRole("button", { name: "Edit plant", exact: true }).click();
    await page.locator(`.modal input[maxlength='${field === "name" ? 60 : 80}']`).fill(value);
    await submit(page);
}
test("simultaneous seed, independent-field merge, last accepted conflict and private accounts", { timeout: 180000 }, async () => {
    const first = await browser.newContext(), second = await browser.newContext();
    const a = await first.newPage(), b = await second.newPage();
    await Promise.all([a.goto(origin), b.goto(origin)]);
    await Promise.all([signIn(a, "garden-shared@example.test"), signIn(b, "garden-shared@example.test")]);
    await Promise.all([synced(a), synced(b)]);
    assert.match(await a.locator(".sidebar-foot").innerText(), /23 plants/);
    assert.match(await b.locator(".sidebar-foot").innerText(), /23 plants/);
    await Promise.all([first.setOffline(true), second.setOffline(true)]);
    await editPlant(a, "Monstera", "name", "Merged monstera");
    await editPlant(b, "Monstera", "species", "Updated species");
    await first.setOffline(false);
    await synced(a);
    await second.setOffline(false);
    await synced(b);
    await b.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
    await b.locator(".plant-list-row").filter({ hasText: "Merged monstera" }).click();
    assert.equal(await b.locator(".species").innerText(), "Updated species");
    await Promise.all([first.setOffline(true), second.setOffline(true)]);
    await editPlant(a, "Merged monstera", "name", "Earlier accepted");
    await editPlant(b, "Merged monstera", "name", "Later accepted");
    await first.setOffline(false);
    await synced(a);
    await second.setOffline(false);
    await synced(b);
    await a.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
    await a.locator(".plant-list-row").filter({ hasText: "Later accepted" }).waitFor();
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const c = await other.newPage();
    await c.goto(origin);
    await signIn(c, "garden-bob@example.test");
    assert.match(await c.locator(".sidebar-foot").innerText(), /23 plants/);
    assert.equal(await c.getByText("Later accepted", { exact: true }).count(), 0);
    assert.equal(await c.locator(".account-status select").inputValue(), "en");
    await Promise.all([first.close(), second.close(), other.close()]);
});

async function loadRules(rules) {
    const environment = await initializeTestEnvironment({
        projectId: "demo-evergreen", firestore: { host: "127.0.0.1", port: 8080, rules }
    });
    await environment.cleanup();
}
test("rejected edits survive reload and retry; multi-tab sign-out clears account state", { timeout: 120000 }, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    await signIn(page, "garden-retry@example.test");
    await synced(page);
    const rules = await fs.readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    try {
        await loadRules("rules_version = '2'; service cloud.firestore { match /databases/{db}/documents { match /{path=**} { allow read: if request.auth != null; allow write: if false; } } }");
        await page.getByRole("button", { name: "Log care", exact: true }).click();
        await page.locator(".modal textarea").fill("Retry survives reload");
        await submit(page);
        await page.getByText(/An edit could not be saved/).waitFor();
        assert.equal(await page.getByText("Garden synchronized.", { exact: true }).count(), 0);
        await page.reload();
        await page.locator(".app-shell").waitFor();
        await page.getByText(/An edit could not be saved/).waitFor();
        await page.locator(".primary-nav").getByRole("button", { name: "Journal", exact: true }).click();
        await page.getByText("Retry survives reload", { exact: true }).waitFor();
    } finally {
        await loadRules(rules);
    }
    await page.getByRole("button", { name: "Retry synchronization", exact: true }).click();
    await synced(page);
    const tab = await context.newPage();
    await tab.goto(origin);
    await tab.locator(".app-shell").waitFor();
    await synced(tab);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
    await tab.getByRole("button", { name: "Sign in with Google" }).waitFor();
    assert.equal(await page.locator(".app-shell").count(), 0);
    assert.equal(await tab.locator(".app-shell").count(), 0);
    await context.close();
});
