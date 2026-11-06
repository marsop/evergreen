(function (root) {
    "use strict";
    const key = "evergreen.garden";

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
        read: () => root.localStorage.getItem(key),
        write: value => root.localStorage.setItem(key, value),
        reset: () => root.localStorage.removeItem(key),
        compressPhoto
    };
})(window);
