(function (root) {
    "use strict";
    const legacyKey = "evergreen.garden";
    const dbName = "evergreen_db";
    const dbVersion = 1;
    const storeName = "garden";
    const recordKey = "snapshot";

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!root.indexedDB) {
                resolve(null);
                return;
            }
            try {
                const request = root.indexedDB.open(dbName, dbVersion);
                request.onupgradeneeded = event => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
                request.onblocked = () => reject(new Error("IndexedDB database is blocked."));
            } catch (err) {
                reject(err);
            }
        });
    }

    async function idbGet() {
        const db = await openDatabase();
        if (!db) return null;
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const req = store.get(recordKey);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
                tx.onerror = () => reject(tx.error || new Error("IndexedDB read transaction failed"));
            } catch (err) {
                reject(err);
            }
        });
    }

    async function idbPut(value) {
        const db = await openDatabase();
        if (!db) return;
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const req = store.put(value, recordKey);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error("IndexedDB write failed"));
                tx.onerror = () => reject(tx.error || new Error("IndexedDB write transaction failed"));
            } catch (err) {
                reject(err);
            }
        });
    }

    async function idbDelete() {
        const db = await openDatabase();
        if (!db) return;
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const req = store.delete(recordKey);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
                tx.onerror = () => reject(tx.error || new Error("IndexedDB delete transaction failed"));
            } catch (err) {
                reject(err);
            }
        });
    }

    async function read() {
        let value = null;
        if (root.indexedDB) {
            value = await idbGet();
        }
        if (value === null && root.localStorage) {
            const legacy = root.localStorage.getItem(legacyKey);
            if (legacy !== null) {
                value = legacy;
                if (root.indexedDB) {
                    try {
                        await idbPut(legacy);
                    } catch {
                        // Keep legacy value even if initial migration write encounters an issue
                    }
                }
            }
        }
        return value;
    }

    async function write(value) {
        if (root.indexedDB) {
            await idbPut(value);
        }
        if (root.localStorage) {
            try {
                root.localStorage.setItem(legacyKey, value);
            } catch (lsError) {
                if (root.rejectGardenWrites || !root.indexedDB) {
                    throw lsError;
                }
            }
        }
    }

    async function reset() {
        if (root.indexedDB) {
            await idbDelete();
        }
        if (root.localStorage) {
            root.localStorage.removeItem(legacyKey);
        }
    }

    function exportFile(filename, content, mimeType) {
        const type = mimeType || "application/json";
        const blob = new root.Blob([content], { type });
        const url = root.URL.createObjectURL(blob);
        const anchor = root.document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        root.document.body.appendChild(anchor);
        anchor.click();
        root.document.body.removeChild(anchor);
        root.URL.revokeObjectURL(url);
    }

    async function compressPhoto(source) {
        const image = new root.Image();
        image.src = source;
        await image.decode();
        const scale = Math.min(1, 1280 / image.naturalWidth, 1280 / image.naturalHeight);
        if (!Number.isFinite(scale) || image.naturalWidth === 0 || image.naturalHeight === 0) {
            throw new Error("The selected image has invalid dimensions.");
        }
        const canvas = root.document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image processing is unavailable.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/jpeg", 0.8);
        if (!result.startsWith("data:image/jpeg;base64,")) {
            throw new Error("JPEG encoding failed.");
        }
        return result;
    }

    root.evergreenGarden = {
        read,
        write,
        reset,
        exportFile,
        compressPhoto
    };
})(window);
