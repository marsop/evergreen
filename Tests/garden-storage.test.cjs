const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "garden-storage.js"), "utf8");

function createMockIndexedDb(initialData = new Map()) {
    const dbData = new Map(initialData);
    let failOpen = false;
    let failWrite = false;
    let failRead = false;
    let failDelete = false;

    return {
        _data: dbData,
        set failOpen(v) { failOpen = v; },
        set failWrite(v) { failWrite = v; },
        set failRead(v) { failRead = v; },
        set failDelete(v) { failDelete = v; },
        open: (name, version) => {
            const req = {
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
                result: null,
                error: null
            };
            queueMicrotask(() => {
                if (failOpen) {
                    req.error = new Error("SecurityError");
                    req.onerror?.({ target: req });
                    return;
                }
                const db = {
                    objectStoreNames: { contains: () => true },
                    createObjectStore: () => {},
                    transaction: (storeNames, mode) => {
                        const tx = {
                            onerror: null,
                            objectStore: () => ({
                                get: key => {
                                    const r = { onsuccess: null, onerror: null, result: undefined };
                                    queueMicrotask(() => {
                                        if (failRead) {
                                            r.error = new Error("SecurityError");
                                            r.onerror?.({ target: r });
                                            tx.onerror?.({ target: tx });
                                        } else {
                                            r.result = dbData.get(key);
                                            r.onsuccess?.({ target: r });
                                        }
                                    });
                                    return r;
                                },
                                put: (val, key) => {
                                    const r = { onsuccess: null, onerror: null };
                                    queueMicrotask(() => {
                                        if (failWrite) {
                                            r.error = new Error("QuotaExceededError");
                                            r.onerror?.({ target: r });
                                            tx.onerror?.({ target: tx });
                                        } else {
                                            dbData.set(key, val);
                                            r.onsuccess?.({ target: r });
                                        }
                                    });
                                    return r;
                                },
                                delete: key => {
                                    const r = { onsuccess: null, onerror: null };
                                    queueMicrotask(() => {
                                        if (failDelete) {
                                            r.error = new Error("SecurityError");
                                            r.onerror?.({ target: r });
                                            tx.onerror?.({ target: tx });
                                        } else {
                                            dbData.delete(key);
                                            r.onsuccess?.({ target: r });
                                        }
                                    });
                                    return r;
                                }
                            })
                        };
                        return tx;
                    }
                };
                req.result = db;
                req.onupgradeneeded?.({ target: req });
                req.onsuccess?.({ target: req });
            });
            return req;
        }
    };
}

function setup(width = 2560, height = 1280) {
    const stored = new Map([["evergreen.culture", "de"]]);
    const calls = [];
    const downloads = [];
    const canvas = {
        getContext: () => ({
            set fillStyle(value) { calls.push(["background", value]); },
            fillRect: (...args) => calls.push(["fill", ...args]),
            drawImage: (...args) => calls.push(["draw", ...args.slice(1)])
        }),
        toDataURL: (...args) => { calls.push(["encode", ...args]); return "data:image/jpeg;base64,photo"; }
    };
    const anchor = {
        _href: "",
        _download: "",
        set href(v) { this._href = v; },
        get href() { return this._href; },
        set download(v) { this._download = v; },
        get download() { return this._download; },
        click: function () { downloads.push({ filename: this._download, href: this._href }); }
    };
    const mockIdb = createMockIndexedDb();
    const window = {
        indexedDB: mockIdb,
        Blob: globalThis.Blob,
        URL: {
            createObjectURL: blob => "blob:test-export",
            revokeObjectURL: url => calls.push(["revoke", url])
        },
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
        document: {
            createElement: tag => tag === "a" ? anchor : canvas,
            body: {
                appendChild: () => {},
                removeChild: () => {}
            }
        }
    };
    vm.runInNewContext(source, { window });
    return { window, stored, calls, canvas, mockIdb, downloads, api: window.evergreenGarden };
}

test("garden storage is isolated from language settings and writes to IndexedDB and localStorage", async () => {
    const { api, stored, mockIdb } = setup();
    assert.equal(await api.read(), null);
    await api.write('{"version":1}');
    assert.equal(await api.read(), '{"version":1}');
    assert.equal(mockIdb._data.get("snapshot"), '{"version":1}');
    assert.equal(stored.get("evergreen.garden"), '{"version":1}');
    await api.reset();
    assert.equal(await api.read(), null);
    assert.equal(mockIdb._data.get("snapshot"), undefined);
    assert.equal(stored.get("evergreen.garden"), undefined);
    assert.equal(stored.get("evergreen.culture"), "de");
});

test("migrates legacy localStorage data into IndexedDB on first read", async () => {
    const { api, stored, mockIdb } = setup();
    stored.set("evergreen.garden", '{"version":1,"migrated":true}');
    assert.equal(mockIdb._data.get("snapshot"), undefined);
    const result = await api.read();
    assert.equal(result, '{"version":1,"migrated":true}');
    // IndexedDB now holds the migrated snapshot
    assert.equal(mockIdb._data.get("snapshot"), '{"version":1,"migrated":true}');
    // Legacy localStorage is preserved as safety backup
    assert.equal(stored.get("evergreen.garden"), '{"version":1,"migrated":true}');
});

test("access denial and quota failures are propagated without losing the previous snapshot", async () => {
    const { api, window, stored, mockIdb } = setup();
    await api.write("previous");
    mockIdb.failWrite = true;
    await assert.rejects(async () => api.write("candidate"), /QuotaExceededError/);
    assert.equal(mockIdb._data.get("snapshot"), "previous");
    mockIdb.failWrite = false;
    mockIdb.failRead = true;
    await assert.rejects(async () => api.read(), /SecurityError/);
    mockIdb.failRead = false;
    mockIdb.failDelete = true;
    await assert.rejects(async () => api.reset(), /SecurityError/);
});

test("exportFile triggers anchor download with blob URL and revokes it", () => {
    const { api, downloads, calls } = setup();
    api.exportFile("my-garden.json", '{"version":1}', "application/json");
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, "my-garden.json");
    assert.equal(downloads[0].href, "blob:test-export");
    assert.deepEqual(calls, [["revoke", "blob:test-export"]]);
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
