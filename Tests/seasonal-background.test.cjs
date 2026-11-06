const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "seasonal-background.js"), "utf8");

function browser(initialDate) {
    let now = initialDate;
    let pending;
    let visibilityChange;
    const document = {
        documentElement: { dataset: {} },
        hidden: false,
        addEventListener(name, callback) {
            assert.equal(name, "visibilitychange");
            visibilityChange = callback;
        }
    };
    class LocalDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
        getUTCMonth() { throw new Error("Seasons must use local calendar months"); }
    }
    vm.runInNewContext(source, {
        Date: LocalDate,
        document,
        window: {
            setTimeout(callback, delay) { pending = { callback, delay }; return 1; },
            clearTimeout() { pending = undefined; }
        }
    });
    return {
        root: document.documentElement,
        pending: () => pending,
        setDate(date) { now = date; },
        visibility(hidden) { document.hidden = hidden; visibilityChange(); }
    };
}

test("all twelve local months select Northern Hemisphere calendar seasons", () => {
    const seasons = ["winter", "winter", "spring", "spring", "spring", "summer",
        "summer", "summer", "autumn", "autumn", "autumn", "winter"];
    seasons.forEach((season, month) => {
        assert.equal(browser(new Date(2026, month, 15, 12)).root.dataset.season, season);
    });
});

for (const [year, month, day, expected] of [
    [2026, 1, 28, "spring"], [2028, 1, 29, "spring"],
    [2026, 4, 31, "summer"], [2026, 7, 31, "autumn"],
    [2026, 10, 30, "winter"], [2026, 11, 31, "winter"]
]) {
    test(`local midnight updates across ${year}-${month + 1}-${day}`, () => {
        const app = browser(new Date(year, month, day, 23, 59, 59, 500));
        assert.equal(app.pending().delay, 500);
        const callback = app.pending().callback;
        app.setDate(new Date(year, month, day + 1));
        callback();
        assert.equal(app.root.dataset.season, expected);
        assert.equal(app.pending().delay,
            new Date(year, month, day + 2).getTime() - new Date(year, month, day + 1).getTime());
    });
}

test("next refresh is local midnight, not a fixed 24 hours after startup", () => {
    const now = new Date(2026, 2, 8, 9, 20, 15);
    const app = browser(now);
    assert.equal(app.pending().delay, new Date(2026, 2, 9).getTime() - now.getTime());
});

test("hidden tabs pause motion and timers; returning refreshes after sleep or clock changes", () => {
    const app = browser(new Date(2026, 4, 31, 12));
    app.visibility(true);
    assert.equal(app.root.dataset.seasonPaused, "true");
    assert.equal(app.pending(), undefined);
    app.setDate(new Date(2026, 8, 1, 7));
    app.visibility(false);
    assert.equal(app.root.dataset.season, "autumn");
    assert.equal(app.root.dataset.seasonPaused, "false");
    assert.equal(app.pending().delay, 17 * 60 * 60 * 1000);
    app.setDate(new Date(2026, 0, 1, 8));
    app.visibility(false);
    assert.equal(app.root.dataset.season, "winter");
    assert.equal(app.pending().delay, 16 * 60 * 60 * 1000);
});
