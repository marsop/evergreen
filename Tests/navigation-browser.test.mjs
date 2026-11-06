import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve("publish", "wwwroot");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
    ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml",
    ".webp": "image/webp", ".avif": "image/avif" };
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

const gardenKey = "evergreen.garden";
const storedGarden = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), gardenKey);
const goToView = (page, name) => page.locator(".primary-nav").getByRole("button", { name: name === "Today" ? /^Today/ : name, exact: true }).click();
const submitForm = async page => {
    await page.locator(".modal button[type='submit']").click();
    await page.locator(".modal").waitFor({ state: "hidden" });
};

for (const basePath of ["/", "/evergreen/"]) {
    test(`all garden edits and compressed photos survive reload and reopening at ${basePath}`, { timeout: 120000 }, async () => {
        const context = await browser.newContext({ locale: "en-US" });
        try {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", error => errors.push(error.message));
            await page.goto(origin + basePath + "?view=places");
            await page.getByRole("button", { name: "Add place", exact: true }).click();
            await page.locator(".modal input[maxlength='50']").fill("Loft");
            await submitForm(page);
            await page.reload();
            await page.locator(".place-entry").filter({ hasText: "Loft" }).waitFor();

            await page.locator(".place-entry").filter({ hasText: "Mos Eisley South" }).getByRole("button", { name: "Edit place", exact: true }).click();
            await page.locator(".modal input[maxlength='50']").fill("Window");
            await page.locator(".modal textarea").fill("My sunny window");
            await submitForm(page);
            await page.reload();
            const renamed = page.locator(".place-entry").filter({ hasText: "Window" });
            await renamed.waitFor();
            assert.equal(await renamed.locator(".place-note").innerText(), "My sunny window");
            assert.equal((await storedGarden(page)).plants.filter(plant => plant.location === "Window").length, 8);

            await page.locator(".place-entry").filter({ hasText: "Garden" }).getByRole("button", { name: "Delete place", exact: true }).click();
            await page.getByRole("alertdialog").getByRole("button", { name: "Delete place", exact: true }).click();
            await page.getByRole("alertdialog").waitFor({ state: "hidden" });
            await page.reload();
            await page.locator(".place-entry").first().waitFor();
            assert.equal(await page.locator(".place-entry").filter({ hasText: "Garden" }).count(), 0);

            await goToView(page, "Plants");
            await page.getByRole("button", { name: "Add plant", exact: true }).click();
            await page.locator(".modal input[maxlength='60']").fill("Persistent fern");
            await page.locator(".modal input[maxlength='80']").fill("My botanical name");
            await page.locator(".modal select").first().selectOption("Loft");
            await submitForm(page);
            await page.locator(".plant-list-row").filter({ hasText: "Persistent fern" }).click();
            const profileUrl = page.url();
            const plantId = new URL(profileUrl).searchParams.get("plant");
            await page.getByRole("button", { name: "Edit plant", exact: true }).click();
            await page.locator(".modal input[maxlength='60']").fill("Renamed fern");
            await submitForm(page);
            await page.reload();
            await page.getByRole("heading", { name: "Renamed fern", exact: true }).waitFor();
            assert.equal(await page.locator(".species").innerText(), "My botanical name");
            assert.equal(page.url(), profileUrl);

            await page.getByRole("button", { name: "Log care", exact: true }).click();
            await page.locator(".modal select").nth(1).selectOption(plantId);
            await page.locator(".modal textarea").fill("Manual watering stays after undo");
            await submitForm(page);
            await goToView(page, "Today");
            const plantTask = page.locator(".task-row").filter({ hasText: "Renamed fern" });
            await plantTask.locator(".water-button").click();
            await plantTask.locator(".water-button.done").waitFor();
            await page.reload();
            await plantTask.locator(".water-button.done").waitFor();
            await plantTask.locator(".water-button").click();
            await page.waitForFunction(key => {
                const garden = JSON.parse(localStorage.getItem(key));
                return garden.entries.length === 1;
            }, gardenKey);
            assert.equal((await storedGarden(page)).entries[0].userNote, "Manual watering stays after undo");
            await page.getByRole("button", { name: "Water everything", exact: true }).click();
            await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).entries.length === 25, gardenKey);
            await page.reload();
            await page.locator(".water-button.done").first().waitFor();
            assert.equal(await page.locator(".water-button.done").count(), 24);

            await page.getByRole("button", { name: "Log care", exact: true }).click();
            await page.locator(".modal select").first().selectOption("Photo");
            await page.locator(".modal select").nth(1).selectOption(plantId);
            const imageSource = await page.evaluate(() => {
                const canvas = document.createElement("canvas");
                canvas.width = 2560;
                canvas.height = 640;
                return canvas.toDataURL("image/png");
            });
            await page.locator("input[type='file']").setInputFiles({
                name: "transparent.png", mimeType: "image/png", buffer: Buffer.from(imageSource.split(",")[1], "base64")
            });
            await page.locator(".photo-preview").waitFor();
            const attachment = await page.locator(".photo-preview").getAttribute("src");
            assert.ok(attachment.startsWith("data:image/jpeg;base64,"));
            const dimensions = await page.locator(".photo-preview").evaluate(async image => {
                await image.decode();
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 1;
                const context = canvas.getContext("2d");
                context.drawImage(image, 0, 0);
                return { width: image.naturalWidth, height: image.naturalHeight, pixel: [...context.getImageData(0, 0, 1, 1).data] };
            });
            assert.deepEqual(dimensions, { width: 1280, height: 320, pixel: [255, 255, 255, 255] });
            await page.locator(".modal textarea").fill("Compressed attachment");
            await submitForm(page);
            const saved = await storedGarden(page);
            assert.equal(saved.entries[0].photoData, attachment);
            await page.reload();
            await page.locator(".today-view").waitFor();
            await goToView(page, "Journal");
            const photoEntry = page.locator(".journal-entry").filter({ hasText: "Compressed attachment" });
            await photoEntry.waitFor();
            assert.equal(await photoEntry.locator("img").getAttribute("src"), attachment);
            const beforeLanguage = await page.evaluate(key => localStorage.getItem(key), gardenKey);
            await page.locator(".topbar .language-selector select").selectOption("de");
            await page.locator(".topbar .language-selector select").selectOption("en");
            assert.equal(await page.evaluate(key => localStorage.getItem(key), gardenKey), beforeLanguage);
            await page.goBack();
            await page.locator(".today-view").waitFor();
            assert.equal(await page.locator(".water-button.done").count(), 24);

            const reopened = await context.newPage();
            await reopened.goto(profileUrl);
            await reopened.getByRole("heading", { name: "Renamed fern", exact: true }).waitFor();
            assert.equal(await reopened.locator(".profile-history .history-row").count(), 3);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    });
}

test("failed mutations retain both committed data and form inputs, including atomic bulk watering", { timeout: 120000 }, async () => {
    const context = await browser.newContext({ locale: "en-US" });
    try {
        const page = await context.newPage();
        await page.goto(origin);
        await page.locator(".water-button").first().click();
        await page.locator(".water-button.done").waitFor();
        const saved = await page.evaluate(key => localStorage.getItem(key), gardenKey);
        await page.evaluate(() => {
            const setItem = Storage.prototype.setItem;
            window.rejectGardenWrites = true;
            Storage.prototype.setItem = function (key, value) {
                if (key === "evergreen.garden" && window.rejectGardenWrites) throw new DOMException("Full", "QuotaExceededError");
                return setItem.call(this, key, value);
            };
        });
        const unchanged = async () => assert.equal(await page.evaluate(key => localStorage.getItem(key), gardenKey), saved);
        await page.getByRole("button", { name: "Water everything", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.locator(".water-button.done").count(), 1);
        await unchanged();
        await page.locator(".water-button.done").click();
        assert.equal(await page.locator(".water-button.done").count(), 1);
        await unchanged();

        await goToView(page, "Plants");
        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("Unsaved fern");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.locator(".modal input[maxlength='60']").inputValue(), "Unsaved fern");
        assert.equal(await page.locator(".plant-list-row").count(), 23);
        await unchanged();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.locator(".plant-list-row").first().click();
        await page.getByRole("button", { name: "Edit plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("Unsaved rename");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("alert").waitFor();
        assert.notEqual(await page.locator(".profile-title h1").innerText(), "Unsaved rename");
        await unchanged();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();

        await goToView(page, "Places");
        await page.getByRole("button", { name: "Add place", exact: true }).click();
        await page.locator(".modal input[maxlength='50']").fill("Unsaved place");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.locator(".modal input[maxlength='50']").inputValue(), "Unsaved place");
        await unchanged();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        const place = page.locator(".place-entry").filter({ hasText: "Mos Eisley South" });
        await place.getByRole("button", { name: "Edit place", exact: true }).click();
        await page.locator(".modal input[maxlength='50']").fill("Unsaved window");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("alert").waitFor();
        await place.waitFor();
        await unchanged();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        const emptyPlace = page.locator(".place-entry").filter({ hasText: "Garden" });
        await emptyPlace.getByRole("button", { name: "Delete place", exact: true }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Delete place", exact: true }).click();
        await page.getByRole("alert").waitFor();
        await emptyPlace.waitFor();
        await unchanged();
        await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();

        await page.getByRole("button", { name: "Log care", exact: true }).click();
        await page.locator(".modal select").first().selectOption("Photo");
        await page.locator("input[type='file']").setInputFiles({
            name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image")
        });
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").innerText(), /could not be processed/);
        await page.locator(".modal button[type='submit']").click();
        await unchanged();
        const validImage = await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 10;
            return canvas.toDataURL("image/png");
        });
        await page.locator("input[type='file']").setInputFiles({
            name: "photo.png", mimeType: "image/png", buffer: Buffer.from(validImage.split(",")[1], "base64")
        });
        await page.locator(".photo-preview").waitFor();
        await page.locator(".modal textarea").fill("Unsaved care");
        await page.locator(".modal button[type='submit']").click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.locator(".modal textarea").inputValue(), "Unsaved care");
        assert.match(await page.locator(".photo-preview").getAttribute("src"), /^data:image\/jpeg;base64,/);
        await unchanged();
        await page.evaluate(() => window.rejectGardenWrites = false);
        await submitForm(page);
        assert.equal((await storedGarden(page)).entries[0].userNote, "Unsaved care");
    } finally {
        await context.close();
    }
});

test("pending writes do not update the garden and disable concurrent mutations", { timeout: 60000 }, async () => {
    const context = await browser.newContext({ locale: "en-US" });
    try {
        const page = await context.newPage();
        await page.goto(origin);
        await page.locator(".today-view").waitFor();
        await page.evaluate(() => {
            const write = evergreenGarden.write;
            evergreenGarden.write = value => new Promise(resolve => {
                window.finishGardenWrite = () => { write(value); resolve(); };
            });
        });
        await page.getByRole("button", { name: "Water everything", exact: true }).click();
        await page.waitForFunction(() => typeof window.finishGardenWrite === "function");
        assert.equal(await page.locator(".water-button.done").count(), 0);
        assert.equal(await storedGarden(page), null);
        assert.equal(await page.locator(".water-button").first().isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Log care", exact: true }).isDisabled(), true);
        await page.evaluate(() => window.finishGardenWrite());
        await page.locator(".water-button.done").first().waitFor();
        assert.equal(await page.locator(".water-button.done").count(), 23);
        assert.equal((await storedGarden(page)).entries.length, 23);
    } finally {
        await context.close();
    }
});

test("daily watering resets at local midnight and on reload without relabeling historical entries", { timeout: 120000 }, async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "en-US" });
    try {
        const page = await context.newPage();
        await page.clock.install({ time: new Date("2026-11-06T23:59:00+01:00") });
        await page.goto(origin);
        await page.locator(".water-button").first().click();
        await page.locator(".water-button.done").waitFor();
        const date = (await storedGarden(page)).entries[0].date;
        assert.equal(date, "2026-11-06");
        await page.clock.fastForward(61000);
        await page.waitForFunction(() => document.querySelectorAll(".water-button.done").length === 0);
        await goToView(page, "Journal");
        await page.locator(".journal-entry").waitFor();
        assert.notEqual(await page.locator(".journal-day h2").innerText(), "Today");
        await page.reload();
        await page.locator(".journal-entry").waitFor();
        assert.equal((await storedGarden(page)).entries[0].date, date);
        await goToView(page, "Today");
        assert.equal(await page.locator(".water-button.done").count(), 0);
        await page.locator(".water-button").first().click();
        await page.locator(".water-button.done").waitFor();
        await page.locator(".water-button.done").click();
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).entries.length === 1, gardenKey);
        assert.equal((await storedGarden(page)).entries[0].date, date);
    } finally {
        await context.close();
    }
});

for (const [value, message] of [
    ["{bad", /saved garden is damaged/],
    [JSON.stringify({ version: 99, plants: [], places: [], entries: [] }), /unsupported format/]
]) {
    test(`invalid garden is protected until explicitly reset: ${message}`, { timeout: 60000 }, async () => {
        const context = await browser.newContext({ locale: "en-US" });
        try {
            const page = await context.newPage();
            await page.goto(origin);
            await page.locator(".today-view").waitFor();
            await page.evaluate(({ key, value }) => {
                localStorage.setItem(key, value);
                localStorage.setItem("unrelated", "keep");
                localStorage.setItem("evergreen.culture", "en");
            }, { key: gardenKey, value });
            await page.reload();
            await page.getByRole("alert").waitFor();
            assert.match(await page.getByRole("alert").innerText(), message);
            assert.equal(await page.locator(".primary-nav").count(), 0);
            await page.getByRole("button", { name: "Retry loading", exact: true }).click();
            await page.getByRole("alert").waitFor();
            assert.equal(await page.evaluate(key => localStorage.getItem(key), gardenKey), value);
            await page.getByRole("button", { name: "Reset garden", exact: true }).click();
            await page.getByRole("button", { name: "Cancel", exact: true }).click();
            assert.equal(await page.evaluate(key => localStorage.getItem(key), gardenKey), value);
            await page.getByRole("button", { name: "Reset garden", exact: true }).click();
            await page.getByText(/permanently removes/).waitFor();
            await page.getByRole("button", { name: "Reset garden", exact: true }).click();
            await page.locator(".today-view").waitFor();
            assert.equal(await page.locator(".water-button").count(), 23);
            assert.deepEqual(await page.evaluate(key => [localStorage.getItem(key), localStorage.getItem("evergreen.culture"), localStorage.getItem("unrelated")], gardenKey), [null, "en", "keep"]);
        } finally {
            await context.close();
        }
    });
}

test("unreadable storage blocks edits until retry succeeds; empty saved gardens stay empty", { timeout: 60000 }, async () => {
    const context = await browser.newContext({ locale: "en-US" });
    try {
        const page = await context.newPage();
        await page.addInitScript(() => {
            const getItem = Storage.prototype.getItem;
            Storage.prototype.getItem = function (key) {
                if (key === "evergreen.garden" && !window.allowGardenRead) throw new DOMException("Blocked", "SecurityError");
                return getItem.call(this, key);
            };
        });
        await page.goto(origin);
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").innerText(), /could not be read/);
        assert.equal(await page.getByRole("button", { name: "Reset garden" }).count(), 0);
        await page.evaluate(key => {
            window.allowGardenRead = true;
            localStorage.setItem(key, JSON.stringify({ version: 1, plants: [], places: [], entries: [] }));
        }, gardenKey);
        await page.getByRole("button", { name: "Retry loading", exact: true }).click();
        await page.locator(".today-view").waitFor();
        assert.equal(await page.locator(".water-button").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Log care", exact: true }).isDisabled(), true);
        await goToView(page, "Plants");
        assert.equal(await page.getByRole("button", { name: "Add plant", exact: true }).isDisabled(), true);
        await goToView(page, "Places");
        await page.getByRole("button", { name: "Add place", exact: true }).click();
        await page.locator(".modal input[maxlength='50']").fill("First outdoor place");
        await page.locator(".modal input[type='checkbox']").check();
        await submitForm(page);
        await goToView(page, "Plants");
        await page.getByRole("button", { name: "Add plant", exact: true }).click();
        await page.locator(".modal input[maxlength='60']").fill("First plant");
        await submitForm(page);
        assert.equal((await storedGarden(page)).plants.length, 1);
    } finally {
        await context.close();
    }
});

for (const basePath of ["/", "/evergreen/"]) {
    for (const [month, season] of [[3, "spring"], [6, "summer"], [9, "autumn"], [12, "winter"]]) {
        test(`subtle ${season} background, reduced motion and SVG loading at ${basePath}`, { timeout: 120000 }, async () => {
            const context = await browser.newContext({ timezoneId: "Pacific/Tongatapu", reducedMotion: "no-preference" });
            try {
                const page = await context.newPage();
                // Locally this is the first day of the season, but UTC is still the previous month.
                await page.clock.install({ time: new Date(`2026-${String(month).padStart(2, "0")}-01T00:30:00+13:00`) });
                const errors = [];
                page.on("pageerror", error => errors.push(error.message));
                const asset = page.waitForResponse(response => response.url().endsWith(`/images/seasons/${season}.svg`));
                await page.goto(origin + basePath);
                assert.equal((await asset).status(), 200);
                await page.locator(".today-view").waitFor();
                assert.equal(await page.locator("html").getAttribute("data-season"), season);
                const background = page.locator(".seasonal-background");
                assert.equal(await background.getAttribute("aria-hidden"), "true");
                assert.equal(await background.evaluate(element => element.inert), true);
                assert.equal(await background.evaluate(element => getComputedStyle(element).pointerEvents), "none");
                assert.equal(await background.evaluate(element => getComputedStyle(element).zIndex), "-1");
                const layer = page.locator(".seasonal-background__layer").first();
                const styles = await layer.evaluate(element => {
                    const css = getComputedStyle(element);
                    return { duration: parseFloat(css.animationDuration), opacity: Number(css.opacity), image: css.backgroundImage };
                });
                assert.ok(styles.duration >= 90);
                assert.ok(styles.opacity >= .08 && styles.opacity <= .18);
                assert.ok(styles.image.endsWith(`/images/seasons/${season}.svg")`));
                const before = await layer.evaluate(element => getComputedStyle(element).transform);
                await page.waitForTimeout(300);
                assert.notEqual(await layer.evaluate(element => getComputedStyle(element).transform), before);

                await page.locator(".water-button").first().click();
                const watered = await page.locator(".water-button.done").count();
                await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
                await page.locator(".plant-list-row").first().waitFor();
                await page.locator(".topbar .language-selector select").selectOption("de");
                await page.locator(".topbar .language-selector select").selectOption("en");
                await page.goBack();
                await page.locator(".today-view").waitFor();
                assert.equal(await page.locator(".water-button.done").count(), watered);
                assert.equal(await background.count(), 1);
                assert.equal(await page.locator("html").getAttribute("data-season"), season);

                await page.emulateMedia({ reducedMotion: "reduce" });
                assert.equal(await layer.evaluate(element => getComputedStyle(element).animationName), "none");
                assert.equal(await background.evaluate(element => element.getAnimations({ subtree: true }).length), 0);
                const staticTransform = await layer.evaluate(element => getComputedStyle(element).transform);
                await page.waitForTimeout(100);
                assert.equal(await layer.evaluate(element => getComputedStyle(element).transform), staticTransform);
                await page.emulateMedia({ reducedMotion: "no-preference" });
                assert.notEqual(await layer.evaluate(element => getComputedStyle(element).animationName), "none");
                await page.setViewportSize({ width: 390, height: 844 });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await page.locator(".topbar").getByRole("button", { name: "Log care", exact: true }).click();
                await page.locator(".modal").waitFor();
                assert.equal(await page.locator(".modal").evaluate(element => {
                    const rect = element.getBoundingClientRect();
                    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
                }), true);
                assert.deepEqual(errors, []);
            } finally {
                await context.close();
            }
        });
    }
}

test("season changes at local midnight without reloading or losing edits", { timeout: 120000 }, async () => {
    const context = await browser.newContext({ timezoneId: "Europe/Berlin" });
    try {
        const page = await context.newPage();
        await page.clock.install({ time: new Date("2026-05-31T23:59:00+02:00") });
        await page.goto(origin);
        await page.locator(".today-view").waitFor();
        assert.equal(await page.locator("html").getAttribute("data-season"), "spring");
        await page.locator(".water-button").first().click();
        await page.locator(".water-button.done").waitFor();
        const gardenBeforeMidnight = await storedGarden(page);
        const token = await page.evaluate(() => window.seasonTestToken = crypto.randomUUID());
        await page.clock.fastForward(61000);
        assert.equal(await page.locator("html").getAttribute("data-season"), "summer");
        assert.equal(await page.evaluate(() => window.seasonTestToken), token);
        assert.equal(await page.locator(".water-button.done").count(), 0);
        assert.deepEqual(await storedGarden(page), gardenBeforeMidnight);
    } finally {
        await context.close();
    }
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
        assert.equal(await page.locator(".language-selector").count(), 1);
        assert.equal(await page.locator(".topbar .language-selector").count(), 1);
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
        await page.getByRole("heading", { name: "Renamed history fern", exact: true }).waitFor();
        await page.reload();
        await page.getByRole("heading", { name: "Renamed history fern", exact: true }).waitFor();
        await page.goto(site + "?view=profile&plant=missing");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("de");
        await page.getByRole("heading", { name: "Pflanze nicht verfügbar", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("es");
        await page.getByRole("heading", { name: "Planta no disponible", exact: true }).waitFor();
        await page.locator(".topbar .language-selector select").selectOption("en");
        await page.getByRole("button", { name: "Back to plants", exact: true }).click();
        await destination("plants", ".plant-list-row");
        assert.equal(await page.locator(".plant-list-row").count(), 24);
        await page.goto(site + "?view=invalid&plant=missing");
        await destination(null, ".today-view");
        assert.equal(new URL(page.url()).search, "");
        await page.goBack();
        await destination("plants", ".plant-list-row");
        await page.goto(site + "?view=plants&place=missing");
        await page.locator(".plant-list-row").first().waitFor();
        assert.equal(await page.locator(".filter-chip.selected").innerText(), "All");
        assert.equal(await page.locator(".plant-list-row").count(), 24);
        await page.goto(site + "?view=profile");
        await page.getByRole("heading", { name: "Plant unavailable", exact: true }).waitFor();
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});
}

test("Log Care entries can be saved on a past date", { timeout: 60000 }, async () => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/");
        await page.locator(".today-view").waitFor();

        const backdatedDate = await page.evaluate(() => {
            const formatInput = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            return {
                input: formatInput(yesterday),
                label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(yesterday)
            };
        });
        await page.getByRole("button", { name: "Log care", exact: true }).click();
        const careDateInput = page.locator(".modal input[type='date']");
        const todayInput = await page.evaluate(() => {
            const today = new Date();
            return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        });
        assert.equal(await careDateInput.getAttribute("max"), todayInput);
        assert.equal(await careDateInput.inputValue(), todayInput);
        await careDateInput.fill(backdatedDate.input);
        await page.locator(".modal textarea").fill("Backdated care note");
        await page.locator(".modal button[type='submit']").click();
        await page.locator(".modal").waitFor({ state: "hidden" });

        await page.locator(".primary-nav").getByRole("button", { name: "Journal", exact: true }).click();
        const backdatedEntry = page.locator(".journal-entry").filter({ hasText: "Backdated care note" });
        await backdatedEntry.waitFor();
        assert.equal(
            await backdatedEntry.locator("xpath=ancestor::section[contains(@class,'journal-day')]/h2").innerText(),
            backdatedDate.label
        );
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});

test("place edits update every field and keep assigned plants linked after a rename", { timeout: 120000 }, async () => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/?view=places");
        await page.getByRole("heading", { name: "Places", exact: true }).waitFor();

        const place = page.locator(".place-entry").filter({ hasText: "Mos Eisley South" }).first();
        const originalUrl = page.url();
        await place.getByRole("button", { name: "Edit place", exact: true }).click();
        const modal = page.locator(".modal");
        await modal.waitFor();
        assert.equal(page.url(), originalUrl);
        assert.equal(await modal.locator("input[maxlength='50']").inputValue(), "Mos Eisley South");
        assert.equal(await modal.locator("select").inputValue(), "Bright, filtered");
        assert.equal(await modal.locator("input[maxlength='30']").inputValue(), "20–23 °C");
        assert.equal(await modal.locator("input[type='checkbox']").isChecked(), false);
        assert.equal(await modal.locator("textarea").inputValue(), "");

        await modal.locator("input[maxlength='50']").fill("Mos Eisley West");
        await modal.getByRole("button", { name: "Save changes", exact: true }).click();
        await modal.getByRole("alert").waitFor();
        assert.equal(await modal.getByRole("alert").innerText(), "A place with this name already exists.");
        await modal.locator("input[maxlength='50']").fill("Sunroom");
        await modal.locator("select").selectOption("Full sun");
        await modal.locator("input[maxlength='30']").fill("22–25 °C");
        await modal.locator("input[type='checkbox']").check();
        await modal.locator("textarea").fill("Keep plants shaded.");
        await modal.getByRole("button", { name: "Save changes", exact: true }).click();

        const renamedPlace = page.locator(".outdoor-row .place-entry").filter({ hasText: "Sunroom" });
        await renamedPlace.waitFor();
        assert.equal(await renamedPlace.locator("h3").innerText(), "Sunroom");
        const facts = await renamedPlace.locator(".place-facts").innerText();
        assert.match(facts, /Full sun/);
        assert.match(facts, /22–25 °C/);
        assert.equal(await renamedPlace.locator(".place-note").innerText(), "Keep plants shaded.");
        assert.equal(page.url(), originalUrl);

        await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
        await page.waitForURL(url => url.searchParams.get("view") === "plants");
        await page.locator(".filter-chip").getByText("Sunroom", { exact: true }).click();
        await page.locator(".plant-list-row").first().waitFor();
        assert.equal(await page.locator(".plant-list-row").count(), 8);
        assert.equal(await page.locator(".plant-list-row small").first().innerText(), "Sunroom");

        await page.locator(".primary-nav").getByRole("button", { name: "Places", exact: true }).click();
        await page.waitForURL(url => url.searchParams.get("view") === "places");
        const samplePlace = page.locator(".place-entry").filter({ hasText: "Panopticon" }).first();
        await samplePlace.getByRole("button", { name: "Edit place", exact: true }).click();
        const samplePlaceModal = page.locator(".modal");
        await samplePlaceModal.waitFor();
        assert.equal(await samplePlaceModal.locator("textarea").inputValue(),
            "Oct–Mar: only Mediterranean plants and succulents. Move tropicals inside.");
        await samplePlaceModal.getByRole("button", { name: "Save changes", exact: true }).click();
        await page.locator(".topbar .language-selector select").selectOption("de");
        assert.equal(await samplePlace.locator(".place-note").innerText(),
            "Okt–Mär: nur mediterrane Pflanzen und Sukkulenten. Tropische Pflanzen nach drinnen stellen.");
        await page.locator(".topbar .language-selector select").selectOption("en");
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});

test("places can only be deleted when no plants are assigned", { timeout: 120000 }, async () => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(origin + "/?view=places");
        await page.getByRole("heading", { name: "Places", exact: true }).waitFor();

        const assignedPlace = page.locator(".place-entry").filter({ hasText: "Mos Eisley South" }).first();
        const assignedDeleteButton = assignedPlace.getByRole("button", { name: "Delete place", exact: true });
        assert.equal(await assignedDeleteButton.isDisabled(), true);
        assert.equal(await assignedPlace.getByText("Move its plants before deleting this place.", { exact: true }).count(), 1);

        const emptyPlace = page.locator(".place-entry").filter({ hasText: "Garden" }).first();
        const emptyDeleteButton = emptyPlace.getByRole("button", { name: "Delete place", exact: true });
        assert.equal(await emptyDeleteButton.isEnabled(), true);
        await emptyDeleteButton.click();
        const confirmation = page.getByRole("alertdialog");
        await confirmation.waitFor();
        assert.match(await confirmation.innerText(), /Are you sure you want to delete “Garden”\?/);
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
        await confirmation.waitFor({ state: "hidden" });
        await emptyPlace.waitFor();

        await page.getByRole("button", { name: "Add place", exact: true }).click();
        const form = page.locator(".modal");
        await form.locator("input[maxlength='50']").fill("Empty shelf");
        await form.getByRole("button", { name: "Add place", exact: true }).click();
        const newPlace = page.locator(".place-entry").filter({ hasText: "Empty shelf" }).first();
        await newPlace.waitFor();
        await newPlace.getByRole("button", { name: "Delete place", exact: true }).click();
        const deleteConfirmation = page.getByRole("alertdialog");
        await deleteConfirmation.getByRole("button", { name: "Delete place", exact: true }).click();
        await newPlace.waitFor({ state: "detached" });
        assert.deepEqual(errors, []);
    } finally {
        await context.close();
    }
});

for (const basePath of ["/", "/evergreen/"]) {
    test(`plant catalog translations and care profiles load at ${basePath}`, { timeout: 120000 }, async () => {
        const context = await browser.newContext({ locale: "en-US" });
        try {
            const page = await context.newPage();
            const errors = [];
            page.on("pageerror", error => errors.push(error.message));
            const imageResponse = page.waitForResponse(response => response.url().endsWith("/plants/dragon-tree/image.avif"));
            await page.goto(origin + basePath);
            await page.locator(".today-view").waitFor();
            await page.locator(".primary-nav").getByRole("button", { name: "Plants", exact: true }).click();
            assert.equal((await imageResponse).status(), 200);

            await page.locator(".topbar .language-selector select").selectOption("de");
            const dragonTree = page.locator(".plant-list-row").filter({ hasText: "Drachenbaum" });
            await dragonTree.waitFor();
            await dragonTree.click();
            await page.locator(".profile-view h1").getByText("Drachenbaum", { exact: true }).waitFor();
            assert.equal(await page.locator(".month-column").count(), 12);
            assert.equal(await page.locator(".care-card").count(), 7);
            assert.equal(await page.locator(".watchout-panel li").count(), 4);
            assert.match(await page.locator(".profile-photo img").evaluate(image => image.currentSrc), /\/plants\/dragon-tree\/image\.avif$/);

            await page.locator(".topbar .language-selector select").selectOption("es");
            await page.locator(".profile-view h1").getByText("Drácena", { exact: true }).waitFor();
            await page.locator(".topbar .language-selector select").selectOption("en");
            await page.locator(".profile-view h1").getByText("Dragon tree", { exact: true }).waitFor();
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    });
}
