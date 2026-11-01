import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, writeBatch, runTransaction } from "firebase/firestore";

let environment;
const place = { id: "place", name: "Kitchen", light: "Low light", temperature: "20 C", outdoor: false, note: "", temperatureKey: null };
const plant = { id: "plant", name: "Fern", species: "Fern", placeId: "place", category: "Tropical, evenly moist", waterAmount: "Normal", light: "Filtered", image: "" };
const entry = { id: "photo", titleKey: "JournalPhotoTitle", descriptionKey: "JournalPhotoTitle", type: "Photo", date: "2026-10-31", sortOrder: 1, plantName: "", photoData: "", userNote: null, waterAmount: "", plantId: "plant", photoId: "photo" };
const photo = { payload: "/9j/AA==", bytes: 4, width: 10, height: 10 };
function ref(db, path) { return doc(db, `users/alice/${path}`); }
before(async () => {
    environment = await initializeTestEnvironment({
        projectId: "demo-evergreen",
        firestore: { host: "127.0.0.1", port: 8080, rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
    });
});
beforeEach(async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(ref(db, "places/place"), place);
        await setDoc(ref(db, "plants/plant"), plant);
    });
});
after(async () => { await environment?.cleanup(); });
test("only the owning account can read or write garden data", async () => {
    const alice = environment.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(ref(alice, "plants/plant")));
    for (const context of [environment.authenticatedContext("bob"), environment.unauthenticatedContext()]) {
        await assertFails(getDoc(ref(context.firestore(), "plants/plant")));
        await assertFails(setDoc(ref(context.firestore(), "places/place"), place));
    }
});
test("schema validation permits patches but rejects invalid or missing relationships", async () => {
    const db = environment.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(ref(db, "plants/plant"), { name: "Renamed" }, { merge: true }));
    await assertFails(setDoc(ref(db, "plants/plant"), { name: "x".repeat(61) }, { merge: true }));
    await assertFails(setDoc(ref(db, "plants/plant"), { placeId: "missing" }, { merge: true }));
    await assertFails(setDoc(ref(db, "plants/plant"), { secret: "field" }, { merge: true }));
    await assertFails(setDoc(ref(db, "preferences/language"), { language: "fr" }));
    await assertSucceeds(setDoc(ref(db, "preferences/language"), { language: "de" }));
});
test("photo and journal attachment must be atomic, bounded and private", async () => {
    const db = environment.authenticatedContext("alice").firestore();
    await assertFails(setDoc(ref(db, "photos/photo"), photo));
    await assertFails(setDoc(ref(db, "journalEntries/photo"), entry));
    const batch = writeBatch(db);
    batch.set(ref(db, "photos/photo"), photo);
    batch.set(ref(db, "journalEntries/photo"), entry);
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(ref(db, "photos/photo")));
    await assertFails(getDoc(ref(environment.authenticatedContext("bob").firestore(), "photos/photo")));
    await assertFails(setDoc(ref(db, "photos/photo"), { ...photo, width: 1601 }));
    const oversized = writeBatch(db);
    oversized.set(ref(db, "photos/oversized"), { ...photo, payload: "/9j/" + "A".repeat(699053) });
    oversized.set(ref(db, "journalEntries/oversized"), { ...entry, id: "oversized", photoId: "oversized" });
    await assertFails(oversized.commit());
});
test("deterministic daily watering is idempotent and undo preserves manual history", async () => {
    const db = environment.authenticatedContext("alice").firestore();
    const water = { ...entry, id: "water-plant-2026-10-31", photoId: "", type: "Watered", titleKey: "JournalWateredTitle", descriptionKey: "WateringDescription" };
    await assertSucceeds(setDoc(ref(db, `journalEntries/${water.id}`), water));
    await assertSucceeds(setDoc(ref(db, `journalEntries/${water.id}`), water));
    await assertFails(setDoc(ref(db, "journalEntries/water-plant-wrong"), { ...water, id: "water-plant-wrong" }));
    await setDoc(ref(db, "journalEntries/manual"), { ...water, id: "manual" });
    const undo = writeBatch(db);
    undo.delete(ref(db, `journalEntries/${water.id}`));
    await assertSucceeds(undo.commit());
    const repeatedUndo = writeBatch(db);
    repeatedUndo.delete(ref(db, `journalEntries/${water.id}`));
    await assertSucceeds(repeatedUndo.commit());
    assert.ok((await getDoc(ref(db, "journalEntries/manual"))).exists());
    const forbidden = writeBatch(db);
    forbidden.delete(ref(db, "journalEntries/manual"));
    await assertFails(forbidden.commit());
});
test("operation receipt prevents repeated application after reload", async () => {
    const db = environment.authenticatedContext("alice").firestore();
    async function apply(name) {
        return runTransaction(db, async transaction => {
            const receipt = ref(db, "operations/op-1");
            if ((await transaction.get(receipt)).exists()) return;
            transaction.set(ref(db, "plants/plant"), { name }, { merge: true });
            transaction.set(receipt, { applied: true });
        });
    }
    await apply("First");
    await setDoc(ref(db, "plants/plant"), { name: "Later edit" }, { merge: true });
    await apply("First");
    assert.equal((await getDoc(ref(db, "plants/plant"))).data().name, "Later edit");
});
