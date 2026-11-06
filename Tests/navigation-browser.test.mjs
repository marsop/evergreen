import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve("publish", "wwwroot");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
    ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml" };
let server, browser, origin;

before(async () => {
    await fs.access(path.join(root, "index.html"));
    server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
            const basePath = pathname.startsWith("/evergreen/") ? "/evergreen/" : "/";
            const relative = pathname.slice(basePath.length) || "index.html";
            const file = path.resolve(root, relative);
            if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
            let body = await fs.readFile(file);
            if (relative === "index.html") {
                body = Buffer.from(body.toString().replace('<base href="/"', `<base href="${basePath}"`));
            }
            response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
            response.end(body);
        } catch (error) {
            if (error.code === "ENOENT") response.writeHead(404).end();
            else {
                console.error("Navigation test server:", error);
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
});

for (const basePath of ["/", "/evergreen/"]) {
test(`Back/Forward, deep links and mobile navigation preserve in-memory garden data at ${basePath}`, { timeout: 120000 }, async () => {
    const site = origin + basePath;
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(site);
        await page.locator(".today-view").waitFor();
        const documentToken = await page.evaluate(() => window.navigationTestDocument = crypto.randomUUID());
        const initialHistory = await page.evaluate(() => history.length);
        const nav = name => page.locator(".primary-nav").getByRole("button", { name, exact: true });
        const destination = async (view, selector) => {
            await page.waitForURL(url => url.searchParams.get("view") === view);
            await page.locator(selector).first().waitFor();
            assert.equal(new URL(page.url()).pathname, basePath);
        };
        await page.locator(".water-button").first().click();
        const watered = await page.locator(".water-button.done").count();
        await nav("Plants").click();
        await destination("plants", ".plant-list-row");
        await nav("Plants").click();
        assert.equal(await page.evaluate(() => history.length), initialHistory + 1);
        await page.locator(".plant-list-row").first().click();
        await destination("profile", ".profile-view");
        const profileUrl = page.url();
        const plantName = await page.locator(".profile-title h1").innerText();
        await page.getByRole("button", { name: "Open journal", exact: true }).click();
        await destination("journal", ".journal-timeline");
        await page.goBack();
        await destination("profile", ".profile-view");
        assert.equal(page.url(), profileUrl);
        await page.goBack();
        await destination("plants", ".plant-list-row");
        await page.goBack();
        await destination(null, ".today-view");
        assert.equal(await page.locator(".water-button.done").count(), watered);
        await page.goForward();
        await destination("plants", ".plant-list-row");
        await page.goForward();
        await destination("profile", ".profile-view");
        assert.equal(await page.locator(".profile-title h1").innerText(), plantName);
        await page.goForward();
        await destination("journal", ".journal-timeline");
        assert.equal(await page.evaluate(() => window.navigationTestDocument), documentToken);

        await nav("Places").click();
        await destination("places", ".place-card");
        const placeName = await page.locator(".place-card h3").first().innerText();
        await page.locator(".place-card").first().click();
        await destination("plants", ".plant-list-row");
        const placeUrl = page.url();
        assert.equal(new URL(placeUrl).searchParams.get("place"), placeName);
        assert.equal(await page.locator(".filter-chip.selected").innerText(), placeName);
        const filteredCount = await page.locator(".plant-list-row").count();
        await page.locator(".plant-list-row").first().click();
        await destination("profile", ".profile-view");
        await page.goBack();
        await destination("plants", ".plant-list-row");
        assert.equal(await page.locator(".plant-list-row").count(), filteredCount);
        await page.goBack();
        await destination("places", ".place-card");
        await page.goForward();
        await destination("plants", ".plant-list-row");
        assert.equal(page.url(), placeUrl);

        const beforeDialog = await page.evaluate(() => history.length);
        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("Unsaved history fern");
        await page.locator(".topbar .language-selector select").selectOption("de");
        assert.equal(await page.locator(".modal input[maxlength='60']").inputValue(), "Unsaved history fern");
        assert.equal(page.url(), placeUrl);
        await page.locator(".topbar .language-selector select").selectOption("en");
        assert.equal(await page.evaluate(() => history.length), beforeDialog);
        await page.goBack();
        await destination("places", ".place-card");
        await page.locator(".modal").waitFor({ state: "hidden" });
        await page.goForward();
        await destination("plants", ".plant-list-row");
        const search = page.locator(".search-box input");
        await search.fill("Monstera");
        await page.locator(".plant-list-row").filter({ hasText: "Monstera" }).waitFor();
        await page.locator(".filter-chip").getByText("All", { exact: true }).click();
        assert.equal(page.url(), placeUrl);
        assert.equal(await page.evaluate(() => history.length), beforeDialog);
        await search.fill("");
        await page.locator(".plant-list-row").first().click();
        await destination("profile", ".profile-view");
        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await destination("plants", ".plant-list-row");
        assert.equal(new URL(page.url()).searchParams.has("place"), false);

        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("History fern");
        await page.locator(".modal button[type='submit']").click();
        await page.locator(".plant-list-row").filter({ hasText: "History fern" }).click();
        await destination("profile", ".profile-view");
        const addedProfileUrl = page.url();
        await page.getByRole("button", { name: "Edit plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("Renamed history fern");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("heading", { name: "Renamed history fern", exact: true }).waitFor();
        assert.equal(page.url(), addedProfileUrl);
        await nav("Journal").click();
        await destination("journal", ".journal-timeline");
        await page.goBack();
        await destination("profile", ".profile-view");
        assert.equal(await page.locator(".profile-title h1").innerText(), "Renamed history fern");
        await page.locator(".brand").click();
        await destination(null, ".today-view");
        assert.equal(await page.locator(".water-button.done").count(), watered);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator(".mobile-nav").getByRole("button", { name: "Plants", exact: true }).click();
        await destination("plants", ".plant-list-row");
        await page.locator(".mobile-nav").getByRole("button", { name: "Places", exact: true }).click();
        await destination("places", ".place-card");
        await page.goBack();
        await destination("plants", ".plant-list-row");
        await page.goForward();
        await destination("places", ".place-card");
        await page.locator(".mobile-nav").getByRole("button", { name: /^Today/ }).click();
        await destination(null, ".today-view");
        await page.locator(".task-plant").first().click();
        await destination("profile", ".profile-view");

        await page.goto(profileUrl);
        await page.locator(".profile-view").waitFor();
        assert.equal(await page.locator(".profile-title h1").innerText(), plantName);
        await page.reload();
        await page.locator(".profile-view").waitFor();
        assert.equal(page.url(), profileUrl);
        assert.equal(await page.locator(".profile-title h1").innerText(), plantName);
        await page.goto(addedProfileUrl);
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("de");
        await page.getByRole("heading", { name: "Pflanze nicht verfügbar", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("es");
        await page.getByRole("heading", { name: "Planta no disponible", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("en");
        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await destination("plants", ".plant-list-row");
        assert.equal(await page.locator(".plant-list-row").count(), 23);
        await page.goto(site + "?view=invalid&plant=missing");
        await destination(null, ".today-view");
        assert.equal(new URL(page.url()).search, "");
        await page.goBack();
        await destination("plants", ".plant-list-row");
        await page.goto(site + "?view=plants&place=missing");
        await page.locator(".plant-list-row").first().waitFor();
        assert.equal(await page.locator(".filter-chip.selected").innerText(), "All");
        assert.equal(await page.locator(".plant-list-row").count(), 23);
        await page.goto(site + "?view=profile");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});
}
