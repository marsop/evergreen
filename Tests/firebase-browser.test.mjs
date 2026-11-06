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

test("view history, deep links and navigation preserve the signed-in garden", { timeout: 180000 }, async () => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        // Start on a deep link before authentication or garden data is available.
        await page.goto(origin + "?view=profile&plant=missing-plant");
        await signIn(page, "garden-history@example.test");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await page.locator(".plant-list-row").first().waitFor();
        await page.locator(".brand").click();
        await page.locator(".today-view").waitFor();
        const initialHistory = await page.evaluate(() => history.length);
        const documentToken = await page.evaluate(() => window.historyTestDocument = crypto.randomUUID());
        const counts = await page.locator(".sidebar-foot").innerText();
        const nav = name => page.locator(".primary-nav").getByRole("button", { name, exact: true });
        const view = async (name, ready) => {
            await page.waitForURL(url => url.searchParams.get("view") === name);
            await page.locator(ready).waitFor();
            assert.equal(new URL(page.url()).pathname, "/evergreen/");
        };
        await nav("Plants").click();
        await view("plants", ".plant-list-row");
        await nav("Plants").click();
        assert.equal(await page.evaluate(() => history.length), initialHistory + 1);
        const plantName = await page.locator(".plant-list-row strong").first().innerText();
        await page.locator(".plant-list-row").first().click();
        await view("profile", ".profile-view");
        const profileUrl = page.url();
        assert.ok(new URL(profileUrl).searchParams.get("plant"));
        assert.equal(await page.locator(".profile-title h1").innerText(), plantName);
        await page.getByRole("button", { name: "Open journal", exact: true }).click();
        await view("journal", ".journal-timeline");

        await page.goBack();
        await view("profile", ".profile-view");
        assert.equal(page.url(), profileUrl);
        await page.goBack();
        await view("plants", ".plant-list-row");
        await page.goBack();
        await view(null, ".today-view");
        await page.goForward();
        await view("plants", ".plant-list-row");
        await page.goForward();
        await view("profile", ".profile-view");
        await page.goForward();
        await view("journal", ".journal-timeline");
        assert.equal(await page.evaluate(() => window.historyTestDocument), documentToken);
        assert.equal(await page.locator(".sidebar-foot").innerText(), counts);

        await nav("Places").click();
        await view("places", ".place-card");
        const placeName = await page.locator(".place-card h3").first().innerText();
        await page.locator(".place-card").first().click();
        await view("plants", ".plant-list-row");
        const placeUrl = page.url();
        assert.ok(new URL(placeUrl).searchParams.get("place"));
        assert.equal(await page.locator(".filter-chip.selected").innerText(), placeName);
        const filteredCount = await page.locator(".plant-list-row").count();
        await page.locator(".plant-list-row").first().click();
        await view("profile", ".profile-view");
        await page.goBack();
        await view("plants", ".plant-list-row");
        assert.equal(page.url(), placeUrl);
        assert.equal(await page.locator(".plant-list-row").count(), filteredCount);
        await page.goBack();
        await view("places", ".place-card");
        await page.goForward();
        await view("plants", ".plant-list-row");

        const beforeTransientChanges = await page.evaluate(() => history.length);
        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.getByLabel("Plant name", { exact: true }).fill("Unsaved history fern");
        await page.locator(".modal .language-selector select").selectOption("de");
        assert.equal(await page.getByLabel("Plant name", { exact: true }).count(), 0);
        assert.equal(await page.locator(".modal input[maxlength='60']").inputValue(), "Unsaved history fern");
        assert.equal(page.url(), placeUrl);
        await page.locator(".modal .language-selector select").selectOption("en");
        assert.equal(await page.evaluate(() => history.length), beforeTransientChanges);
        await page.goBack();
        await view("places", ".place-card");
        await page.locator(".modal").waitFor({ state: "hidden" });
        await page.goForward();
        await view("plants", ".plant-list-row");
        await page.locator(".filter-chip").getByText("All", { exact: true }).click();
        await page.getByRole("textbox", { name: "Search plants", exact: true }).fill("Monstera");
        await page.locator(".plant-list-row").filter({ hasText: "Monstera" }).waitFor();
        assert.equal(page.url(), placeUrl);
        assert.equal(await page.evaluate(() => history.length), beforeTransientChanges);
        await page.getByRole("textbox", { name: "Search plants", exact: true }).fill("");

        await page.locator(".plant-list-row").first().click();
        await view("profile", ".profile-view");
        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await view("plants", ".plant-list-row");
        assert.equal(new URL(page.url()).searchParams.has("place"), false);
        await page.locator(".plant-list-row").first().click();
        await view("profile", ".profile-view");
        const reloadProfileUrl = page.url();
        await page.reload();
        await page.locator(".profile-view").waitFor({ timeout: 30000 });
        assert.equal(page.url(), reloadProfileUrl);

        const direct = await context.newPage();
        await direct.goto(reloadProfileUrl);
        await direct.locator(".profile-view").waitFor({ timeout: 30000 });
        await direct.getByRole("button", { name: "Back to plants", exact: true }).click();
        await direct.locator(".plant-list-row").first().waitFor();
        await direct.close();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator(".mobile-nav").getByRole("button", { name: "Journal", exact: true }).click();
        await view("journal", ".journal-timeline");
        await page.goBack();
        await view("profile", ".profile-view");
        await page.goForward();
        await view("journal", ".journal-timeline");
        await page.locator(".mobile-nav").getByRole("button", { name: /^Today/ }).click();
        await view(null, ".today-view");
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload();
        await page.locator(".today-view").waitFor({ timeout: 30000 });
        await context.setOffline(true);
        await page.locator(".water-button").first().click();
        await page.getByText("Offline: 1 edits waiting to sync.", { exact: true }).waitFor();
        const watered = await page.locator(".water-button.done").count();
        await page.locator(".mobile-nav").getByRole("button", { name: "Journal", exact: true }).click();
        await view("journal", ".journal-timeline");
        await page.goBack();
        await view(null, ".today-view");
        assert.equal(await page.locator(".water-button.done").count(), watered);
        await page.getByText("Offline: 1 edits waiting to sync.", { exact: true }).waitFor();
        assert.equal(await page.getByText("Garden synchronized.", { exact: true }).count(), 0);
        await context.setOffline(false);
        await synced(page);

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(origin + "?view=plants&place=missing-place");
        await page.locator(".plant-list-row").first().waitFor({ timeout: 30000 });
        assert.equal(await page.locator(".filter-chip.selected").innerText(), "All");
        assert.equal(await page.locator(".plant-list-row").count(), 23);
        await page.goto(origin + "?view=profile");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor({ timeout: 30000 });
        await page.locator(".account-status select").selectOption("de");
        await page.getByRole("heading", { name: "Pflanze nicht verfügbar", exact: true }).waitFor();
        await page.locator(".account-status select").selectOption("es");
        await page.getByRole("heading", { name: "Planta no disponible", exact: true }).waitFor();
        await page.locator(".account-status select").selectOption("en");
        await synced(page);

        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await view("plants", ".plant-list-row");
        await page.goto(origin + "?view=invalid&plant=missing-plant");
        await view(null, ".today-view");
        assert.equal(new URL(page.url()).search, "");
        await page.goBack();
        await view("plants", ".plant-list-row");

        // A private plant link must not show a previous account's profile after account switching.
        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.getByLabel("Plant name", { exact: true }).fill("Private history fern");
        await submit(page);
        await synced(page);
        await page.locator(".plant-list-row").filter({ hasText: "Private history fern" }).click();
        await view("profile", ".profile-view");
        const privateUrl = page.url();
        await page.getByRole("button", { name: "Sign out", exact: true }).click();
        await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
        await signIn(page, "garden-history-other@example.test");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        assert.equal(page.url(), privateUrl);
        assert.equal(await page.getByText("Private history fern", { exact: true }).count(), 0);
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});

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
