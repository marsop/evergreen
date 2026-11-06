const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "garden-storage.js"), "utf8");

function setup(width = 2560, height = 1280) {
    const stored = new Map([["evergreen.culture", "de"]]);
    const calls = [];
    const canvas = {
        getContext: () => ({
            set fillStyle(value) { calls.push(["background", value]); },
            fillRect: (...args) => calls.push(["fill", ...args]),
            drawImage: (...args) => calls.push(["draw", ...args.slice(1)])
        }),
        toDataURL: (...args) => { calls.push(["encode", ...args]); return "data:image/jpeg;base64,photo"; }
    };
    const window = {
        localStorage: {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key)
        },
        Image: class {
            naturalWidth = width;
            naturalHeight = height;
            async decode() {}
        },
        document: { createElement: () => canvas }
    };
    vm.runInNewContext(source, { window });
    return { window, stored, calls, canvas, api: window.evergreenGarden };
}

test("garden storage is isolated from language settings and writes a complete value", () => {
    const { api, stored } = setup();
    assert.equal(api.read(), null);
    api.write('{"version":1}');
    assert.equal(api.read(), '{"version":1}');
    api.reset();
    assert.equal(api.read(), null);
    assert.equal(stored.get("evergreen.culture"), "de");
});

test("access denial and quota failures are propagated without losing the previous snapshot", () => {
    const { api, window, stored } = setup();
    api.write("previous");
    window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    assert.throws(() => api.write("candidate"), /QuotaExceededError/);
    assert.equal(stored.get("evergreen.garden"), "previous");
    window.localStorage.getItem = () => { throw new Error("SecurityError"); };
    assert.throws(() => api.read(), /SecurityError/);
    window.localStorage.removeItem = () => { throw new Error("SecurityError"); };
    assert.throws(() => api.reset(), /SecurityError/);
});

for (const [width, height, expectedWidth, expectedHeight] of [
    [2560, 1280, 1280, 640], [800, 2400, 427, 1280], [100, 50, 100, 50]
]) {
    test(`photo ${width}x${height} fits without upscaling and uses white JPEG at quality .8`, async () => {
        const { api, canvas, calls } = setup(width, height);
        assert.equal(await api.compressPhoto("data:image/png;base64,source"), "data:image/jpeg;base64,photo");
        assert.equal(canvas.width, expectedWidth);
        assert.equal(canvas.height, expectedHeight);
        assert.deepEqual(calls, [
            ["background", "#fff"], ["fill", 0, 0, expectedWidth, expectedHeight],
            ["draw", 0, 0, expectedWidth, expectedHeight], ["encode", "image/jpeg", .8]
        ]);
    });
}

test("decode, canvas, invalid dimensions and encoding failures are explicit", async () => {
    let fixture = setup();
    fixture.window.Image.prototype.decode = async () => { throw new Error("decode failed"); };
    await assert.rejects(fixture.api.compressPhoto("bad"), /decode failed/);
    fixture = setup();
    fixture.canvas.getContext = () => null;
    await assert.rejects(fixture.api.compressPhoto("image"), /unavailable/);
    fixture = setup(0, 0);
    await assert.rejects(fixture.api.compressPhoto("image"), /dimensions/);
    fixture = setup();
    fixture.canvas.toDataURL = () => "data:,";
    await assert.rejects(fixture.api.compressPhoto("image"), /encoding failed/);
});
