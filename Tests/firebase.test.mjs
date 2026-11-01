import { test } from "node:test";
import assert from "node:assert/strict";
import { compressFile, validatePhoto, validateWrites, project, photoLimit } from "../Client/garden-core.mjs";

function jpeg(bytes) {
    const buffer = Buffer.alloc(bytes, 7);
    buffer[0] = 255;
    buffer[1] = 216;
    return buffer.toString("base64");
}
test("photo maximum measures decoded and serialized bytes and dimensions", () => {
    const photo = { payload: jpeg(photoLimit), bytes: photoLimit, width: 1600, height: 900 };
    assert.equal(validatePhoto(photo), photo);
    assert.ok(Buffer.byteLength(JSON.stringify(photo)) < 1024 * 1024 - 4096);
    assert.throws(() => validatePhoto({ ...photo, bytes: photoLimit - 1 }));
    assert.throws(() => validatePhoto({ ...photo, width: 1601 }));
    assert.throws(() => validatePhoto({ ...photo, payload: jpeg(photoLimit + 1), bytes: photoLimit + 1 }));
    assert.throws(() => validatePhoto({ ...photo, payload: btoa("not a jpeg"), bytes: 10 }));
});
test("queued field patches merge independent edits and preserve original snapshots", () => {
    const original = { plants: { p: { name: "Fern", species: "Fern" } }, journalEntries: {}, preferences: {} };
    const writes = [
        { writes: [{ collection: "plants", id: "p", data: { name: "New name" } }] },
        { writes: [{ collection: "plants", id: "p", data: { species: "New species" } }] }
    ];
    const state = project(original, writes);
    assert.equal(state.plants.p.name, "New name");
    assert.equal(state.plants.p.species, "New species");
    assert.equal(original.plants.p.name, "Fern");
    assert.equal(project(state, [{ writes: [{ collection: "plants", id: "p", delete: true }] }]).plants.p, undefined);
});
test("write envelope rejects unsafe paths and unknown collections", () => {
    assert.throws(() => validateWrites([{ collection: "plants", id: "../other", data: {} }]));
    assert.throws(() => validateWrites([{ collection: "users", id: "p", data: {} }]));
    assert.throws(() => validateWrites([]));
    validateWrites([{ collection: "journalEntries", id: "water-p-2026-10-31", delete: true }]);
});
test("compression reduces quality and size and always releases image resources", async () => {
    let closed = false, attempts = 0;
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toDataURL: () => `data:image/jpeg;base64,${jpeg(++attempts < 6 ? photoLimit + 1 : 1000)}`
    };
    const environment = {
        createImageBitmap: async () => ({ width: 4000, height: 2000, close() { closed = true; } }),
        document: { createElement: () => canvas }
    };
    const output = await compressFile({ size: 1000000, type: "image/png" }, environment);
    assert.equal(output.bytes, 1000);
    assert.ok(output.width <= 1600 && output.height <= 1600);
    assert.equal(attempts, 6);
    assert.ok(closed);
});
test("compression rejects unsupported and oversized input and impossible output", async () => {
    await assert.rejects(() => compressFile({ size: 1, type: "image/svg+xml" }));
    await assert.rejects(() => compressFile({ size: 5 * 1024 * 1024 + 1, type: "image/png" }));
    let attempts = 0;
    await assert.rejects(() => compressFile({ size: 1, type: "image/png" }, {
        createImageBitmap: async () => ({ width: 1600, height: 1600, close() {} }),
        document: { createElement: () => ({
            getContext: () => ({ fillRect() {}, drawImage() {} }),
            toDataURL: () => { attempts++; return `data:image/jpeg;base64,${jpeg(photoLimit + 1)}`; }
        }) }
    }), /PhotoCompressionFailed/);
    assert.equal(attempts, 28);
});
