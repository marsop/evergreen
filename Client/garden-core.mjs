export const photoLimit = 512 * 1024;
export const photoEdge = 1600;
export const inputLimit = 5 * 1024 * 1024;

export function validatePhoto(photo) {
    const bytes = Uint8Array.from(atob(photo.payload), c => c.charCodeAt(0));
    if (bytes.length !== photo.bytes || bytes.length > photoLimit || bytes.length < 4 ||
        bytes[0] !== 255 || bytes[1] !== 216 ||
        !Number.isInteger(photo.width) || !Number.isInteger(photo.height) ||
        Math.min(photo.width, photo.height) < 1 || Math.max(photo.width, photo.height) > photoEdge ||
        new TextEncoder().encode(JSON.stringify(photo)).length >= 1024 * 1024 - 4096) {
        throw new Error("PhotoCompressionFailed");
    }
    return photo;
}

export function project(records, operations) {
    const result = structuredClone(records);
    for (const operation of operations) {
        for (const write of operation.writes) {
            const collection = result[write.collection];
            if (!collection) continue;
            if (write.delete) delete collection[write.id];
            else collection[write.id] = { ...collection[write.id], ...write.data, id: write.id };
        }
    }
    return result;
}

export function validateWrites(writes) {
    const allowed = new Set(["plants", "places", "journalEntries", "photos", "preferences"]);
    if (!Array.isArray(writes) || writes.length < 1 || writes.length > 3) throw new Error("SaveFailed");
    for (const write of writes) {
        if (!allowed.has(write.collection) || !/^[a-zA-Z0-9_-]{1,100}$/.test(write.id) ||
            (!write.delete && (!write.data || typeof write.data !== "object"))) throw new Error("SaveFailed");
        if (write.collection === "photos" && !write.delete) validatePhoto(write.data);
    }
}

export async function compressFile(file, environment = globalThis) {
    if (!file || file.size > inputLimit) throw new Error("ChooseSmallImage");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("ChooseImage");
    const image = await environment.createImageBitmap(file);
    try {
        const canvas = environment.document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context || image.width < 1 || image.height < 1) throw new Error("PhotoCompressionFailed");
        let edge = photoEdge;
        for (let scale = 0; scale < 7; scale++, edge = Math.floor(edge * 0.75)) {
            const ratio = Math.min(1, edge / Math.max(image.width, image.height));
            canvas.width = Math.max(1, Math.round(image.width * ratio));
            canvas.height = Math.max(1, Math.round(image.height * ratio));
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            for (const quality of [0.85, 0.7, 0.55, 0.4]) {
                const url = canvas.toDataURL("image/jpeg", quality);
                if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("PhotoCompressionFailed");
                const payload = url.split(",")[1];
                const bytes = atob(payload).length;
                if (bytes <= photoLimit)
                    return validatePhoto({ payload, bytes, width: canvas.width, height: canvas.height });
            }
        }
        throw new Error("PhotoCompressionFailed");
    } finally {
        image.close();
    }
}
