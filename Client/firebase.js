import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, connectAuthEmulator } from "firebase/auth";
import { getFirestore, enableMultiTabIndexedDbPersistence, collection, doc, onSnapshot,
    runTransaction, getDoc, getDocFromServer, waitForPendingWrites, terminate, clearIndexedDbPersistence, connectFirestoreEmulator } from "firebase/firestore";
import { compressFile, project, validateWrites, validatePhoto } from "./garden-core.mjs";

let callback, app, auth, db, local, seed, startupLanguage;
let uid = "", displayName = "", generation = 0, unsubscribers = [], outbox = [];
let ready = false, fromCache = true, persistenceUnavailable = false, error = "";
let records = emptyRecords(), initializing = false, syncRunning = false;
let channel;
let notifications = Promise.resolve();
const tabId = crypto.randomUUID();
const peers = new Set();
const releases = new Map();
function emptyRecords() { return { plants: {}, places: {}, journalEntries: {}, preferences: {} }; }
function logFailure(exception) { console.error("Evergreen Firebase:", exception); }
async function notify() {
    if (!callback) return;
    const projected = project(records, outbox);
    const state = {
        uid, displayName, ready, fromCache, offline: !navigator.onLine, persistenceUnavailable,
        appCacheUnavailable: window.evergreenOffline?.failed ?? false,
        pending: outbox.filter(item => !item.failed).length, failed: outbox.filter(item => item.failed).length,
        error, language: projected.preferences.language?.language ?? "",
        plants: Object.values(projected.plants), places: Object.values(projected.places),
        journalEntries: Object.values(projected.journalEntries)
    };
    const delivery = notifications.then(async () => {
        if (callback && state.uid === uid) await callback.invokeMethodAsync("ReceiveAsync", state);
    });
    notifications = delivery.catch(logFailure);
    await delivery;
}
async function fail(exception, key = "SaveFailed") {
    logFailure(exception);
    error = key;
    await notify();
}
function request(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function openLocal() {
    const opening = indexedDB.open("evergreen-outbox", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("operations", { keyPath: "id" });
    return request(opening);
}
async function localWrite(action) {
    const transaction = local.transaction("operations", "readwrite");
    action(transaction.objectStore("operations"));
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}
async function readOutbox(account = uid) {
    const all = await request(local.transaction("operations").objectStore("operations").getAll());
    return all.filter(item => item.uid === account).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
async function reloadOutbox() {
    const account = uid;
    const items = await readOutbox(account);
    if (uid !== account) return;
    outbox = items;
    await notify();
}
function accountDoc(collectionName, id, account = uid) {
    return doc(db, "users", account, collectionName, id);
}
async function configureDatabase() {
    db = getFirestore(app);
    try {
        await enableMultiTabIndexedDbPersistence(db);
    } catch (exception) {
        if (!["failed-precondition", "unimplemented"].includes(exception.code)) throw exception;
        persistenceUnavailable = true;
        logFailure(exception);
    }
}
export async function initialize(dotnet, initialSeed, language) {
    callback = dotnet;
    seed = initialSeed;
    startupLanguage = language;
    try {
        const response = await fetch(new URL("firebase-config.json", document.baseURI), { cache: "no-store" });
        if (!response.ok) throw new Error("Missing Firebase web configuration.");
        const config = await response.json();
        for (const key of ["apiKey", "authDomain", "projectId", "appId"]) {
            if (typeof config[key] !== "string" || !config[key].trim() || config[key].includes("YOUR_"))
                throw new Error(`Invalid Firebase configuration: ${key}`);
        }
        app = initializeApp(config);
        auth = getAuth(app);
        if (config.emulators) {
            if (!["localhost", "127.0.0.1"].includes(location.hostname) || !config.projectId.startsWith("demo-"))
                throw new Error("Emulators are allowed only for local demo projects.");
            connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
            connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);
        }
        local = await openLocal();
        await configureDatabase();
        channel = new BroadcastChannel("evergreen-accounts");
        channel.onmessage = event => {
            const message = event.data;
            if (message.type === "hello") {
                peers.add(message.id);
                channel.postMessage({ type: "present", id: tabId });
            }
            if (message.type === "present") peers.add(message.id);
            if (message.type === "bye") peers.delete(message.id);
            if (message.type === "released") releases.get(message.id)?.();
            if (message.type === "release") releaseDatabase().then(() =>
                channel.postMessage({ type: "released", id: tabId })).catch(fail);
            if (message.type === "queue") reloadOutbox().then(sync).catch(fail);
            if (message.type === "signed-out") location.reload();
        };
        channel.postMessage({ type: "hello", id: tabId });
        unsubscribers.push(onAuthStateChanged(auth, user => changeAccount(user).catch(fail)));
        window.addEventListener("online", connectivity);
        window.addEventListener("offline", connectivity);
        window.addEventListener("pagehide", leave);
        window.addEventListener("evergreen-offline-unavailable", connectivity);
        await notify();
    } catch (exception) {
        await fail(exception, "FirebaseSetupRequired");
    }
}
function detach() {
    // Keep the auth observer until disposal; garden listeners occupy the remaining slots.
    for (const unsubscribe of unsubscribers.splice(1)) unsubscribe();
    generation++;
}
async function changeAccount(user) {
    detach();
    uid = user?.uid ?? "";
    displayName = user?.displayName ?? "";
    error = "";
    ready = false;
    records = emptyRecords();
    outbox = [];
    fromCache = true;
    await notify();
    if (!uid) return;
    const current = generation;
    await reloadOutbox();
    const loaded = new Set();
    const cached = new Map();
    let initialized = false;
    for (const name of Object.keys(records)) {
        unsubscribers.push(onSnapshot(collection(db, "users", uid, name), { includeMetadataChanges: true }, snapshot => {
            if (current !== generation) return;
            records[name] = Object.fromEntries(snapshot.docs.map(item => [item.id, { ...item.data(), id: item.id }]));
            loaded.add(name);
            cached.set(name, snapshot.metadata.fromCache);
            fromCache = [...cached.values()].some(Boolean);
            ready = loaded.size === 4 && initialized;
            notify().catch(logFailure);
            if (ready) sync().catch(fail);
        }, exception => fail(exception, "GardenLoadFailed")));
    }
    const marker = doc(db, "users", uid);
    unsubscribers.push(onSnapshot(marker, { includeMetadataChanges: true }, snapshot => {
        if (current !== generation) return;
        initialized = snapshot.exists() && snapshot.data().schemaVersion === 1;
        ready = loaded.size === 4 && initialized;
        if (!snapshot.exists() && !snapshot.metadata.fromCache && !initializing) {
            initializeGarden(current).catch(exception => fail(exception, "GardenLoadFailed"));
        } else if (!initialized && snapshot.metadata.fromCache && !navigator.onLine) error = "FirstLoadOnline";
        else if (initialized && error === "FirstLoadOnline") error = "";
        else if (snapshot.exists() && !initialized) error = "GardenLoadFailed";
        notify().catch(logFailure);
        if (ready) sync().catch(fail);
    }, exception => fail(exception, "GardenLoadFailed")));
    await sync();
}
async function initializeGarden(current) {
    initializing = true;
    const account = uid;
    try {
        await runTransaction(db, async transaction => {
            const marker = doc(db, "users", account);
            const existing = await transaction.get(marker);
            if (current !== generation || auth.currentUser?.uid !== account) throw new Error("AccountChanged");
            if (existing.exists()) return;
            for (const [name, items] of Object.entries(seed)) {
                for (const item of items) transaction.set(accountDoc(name, item.id, account), item);
            }
            transaction.set(accountDoc("preferences", "language", account), { language: startupLanguage });
            transaction.set(marker, { schemaVersion: 1 });
        });
    } finally {
        initializing = false;
    }
}
export async function signIn(language) {
    if (!auth) throw new Error("FirebaseSetupRequired");
    auth.languageCode = language;
    startupLanguage = language;
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (exception) {
        await fail(exception, "SignInFailed");
        throw exception;
    }
}
export async function enqueue(account, writes) {
    try {
        if (!uid || account !== uid || auth.currentUser?.uid !== account || !ready) throw new Error("AccountChanged");
        if (!navigator.locks) throw new Error("OfflineUnsupported");
        validateWrites(writes);
        const operation = { id: crypto.randomUUID(), uid, order: Date.now(), writes, failed: false };
        // Persist before reporting a queued edit or changing the rendered projection.
        await localWrite(store => {
            const pending = store.getAll();
            pending.onsuccess = () => {
                operation.order = Math.max(Date.now(), ...pending.result.filter(item => item.uid === uid).map(item => item.order + 1));
                store.put(operation);
            };
        });
        await reloadOutbox();
        channel.postMessage({ type: "queue" });
        sync().catch(fail);
    } catch (exception) {
        await fail(exception);
        throw exception;
    }
}
async function sync() {
    if (syncRunning || !uid || !navigator.onLine || !ready) return;
    if (!navigator.locks) {
        error = "OfflineUnsupported";
        await notify();
        return;
    }
    syncRunning = true;
    const account = uid, current = generation;
    try {
        await navigator.locks.request("evergreen-sync", async () => {
            if (current !== generation || uid !== account || !ready) return;
            await waitForPendingWrites(db);
            while (current === generation && navigator.onLine && auth.currentUser?.uid === account) {
                const items = await readOutbox(account);
                const operation = items.find(item => !item.failed);
                if (!operation) break;
                try {
                    // The durable client queue supplies offline edits; the server transaction's
                    // receipt makes replays after reload/network interruption idempotent.
                    await runTransaction(db, async transaction => {
                        const receipt = accountDoc("operations", operation.id, account);
                        const applied = await transaction.get(receipt);
                        if (current !== generation || auth.currentUser?.uid !== account) throw new Error("AccountChanged");
                        if (applied.exists()) return;
                        for (const write of operation.writes) {
                            const target = accountDoc(write.collection, write.id, account);
                            if (write.delete) transaction.delete(target);
                            else transaction.set(target, write.data, { merge: true });
                        }
                        transaction.set(receipt, { applied: true });
                    });
                    // Transactions commit remotely; keep the optimistic projection until
                    // the accepted documents have also reached this device's cache.
                    for (const write of operation.writes) {
                        const snapshot = await getDocFromServer(accountDoc(write.collection, write.id, account));
                        if (current !== generation || uid !== account) break;
                        if (records[write.collection]) {
                            if (snapshot.exists()) records[write.collection][write.id] = { ...snapshot.data(), id: write.id };
                            else delete records[write.collection][write.id];
                        }
                    }
                    if (current !== generation || uid !== account) break;
                    await localWrite(store => store.delete(operation.id));
                } catch (exception) {
                    if (current !== generation || auth.currentUser?.uid !== account) break;
                    if (["unavailable", "deadline-exceeded", "aborted"].includes(exception.code) || !navigator.onLine) break;
                    logFailure(exception);
                    operation.failed = true;
                    operation.error = exception.code ?? exception.message;
                    await localWrite(store => store.put(operation));
                    error = "SaveFailed";
                }
                await reloadOutbox();
                channel.postMessage({ type: "queue" });
            }
        });
    } finally {
        syncRunning = false;
        await reloadOutbox();
    }
}
function connectivity() { notify().then(sync).catch(fail); }
function leave() { channel?.postMessage({ type: "bye", id: tabId }); }
export async function retry() {
    error = "";
    if (!local || !auth || !db) { location.reload(); return; }
    const items = await readOutbox();
    await localWrite(store => {
        for (const item of items) store.put({ ...item, failed: false });
    });
    await reloadOutbox();
    channel.postMessage({ type: "queue" });
    await sync();
}
export async function refresh() {
    if (auth) await changeAccount(auth.currentUser);
    else location.reload();
}
export async function signOut() {
    if (!auth || !uid) return;
    await sync();
    await navigator.locks.request("evergreen-sync", async () => {
        if ((await readOutbox()).length > 0) {
            error = "SignOutPending";
            await notify();
            return;
        }
        await waitForPendingWrites(db);
        try {
            const acknowledgments = [...peers].map(id => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    releases.delete(id);
                    reject(new Error("Another app tab did not release its cache."));
                }, 5000);
                releases.set(id, () => { clearTimeout(timeout); releases.delete(id); resolve(); });
            }));
            channel.postMessage({ type: "release" });
            await Promise.all(acknowledgments);
            await releaseDatabase();
            await clearIndexedDbPersistence(db);
        } catch (exception) {
            await fail(exception, "CacheClearFailed");
            return;
        }
        await firebaseSignOut(auth);
        channel.postMessage({ type: "signed-out" });
        location.reload();
    });
}
async function releaseDatabase() {
    detach();
    records = emptyRecords();
    ready = false;
    outbox = [];
    await notify();
    await terminate(db);
}
export async function compressSelectedPhoto(input) {
    return compressFile(input.files[0]);
}
export async function loadPhoto(account, id) {
    if (account !== uid || auth.currentUser?.uid !== account) throw new Error("AccountChanged");
    const current = generation;
    const pending = outbox.flatMap(item => item.writes).find(write => write.collection === "photos" && write.id === id && !write.delete);
    const data = pending?.data ?? (await getDoc(accountDoc("photos", id))).data();
    if (current !== generation || account !== uid) throw new Error("AccountChanged");
    if (!data) throw new Error("PhotoLoadFailed");
    validatePhoto(data);
    return `data:image/jpeg;base64,${data.payload}`;
}
export async function dispose() {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
    channel?.postMessage({ type: "bye", id: tabId });
    channel?.close();
    window.removeEventListener("online", connectivity);
    window.removeEventListener("offline", connectivity);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("evergreen-offline-unavailable", connectivity);
    callback = null;
    local?.close();
}
