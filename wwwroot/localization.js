(function (root) {
    "use strict";

    const storageKey = "evergreen.culture";
    const messages = {
        en: { loading: "Loading Evergreen...", error: "An unexpected error occurred.", reload: "Reload", dismiss: "Dismiss" },
        es: { loading: "Cargando Evergreen...", error: "Se ha producido un error inesperado.", reload: "Recargar", dismiss: "Cerrar" },
        de: { loading: "Evergreen wird geladen...", error: "Ein unerwarteter Fehler ist aufgetreten.", reload: "Neu laden", dismiss: "Schließen" }
    };

    function normalize(language) {
        if (typeof language !== "string") return null;
        const name = language.trim().replaceAll("_", "-");
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(name)) return null;
        const primary = name.split("-")[0].toLowerCase();
        return Object.hasOwn(messages, primary) ? primary : null;
    }

    function initialize() {
        let savedCulture = null;
        let storageUnavailable = false;
        try {
            const saved = root.localStorage.getItem(storageKey);
            savedCulture = normalize(saved);
            if (saved !== null && savedCulture === null) {
                console.warn("Evergreen: unsupported stored language preference; using browser language.");
            }
        } catch (error) {
            storageUnavailable = true;
            console.warn("Evergreen: language preference storage is unavailable.", error);
        }
        const browserLanguages = Array.from(root.navigator.languages || [root.navigator.language]);
        return { savedCulture, browserLanguages, storageUnavailable };
    }

    function applyCulture(language) {
        const culture = normalize(language);
        if (culture === null) throw new Error("Unsupported language.");
        root.document.documentElement.lang = culture;
        for (const element of root.document.querySelectorAll("[data-localization]")) {
            const key = element.dataset.localization;
            if (key === "dismiss") {
                element.setAttribute("aria-label", messages[culture][key]);
                element.setAttribute("title", messages[culture][key]);
            } else {
                element.textContent = messages[culture][key];
            }
        }
    }

    function saveCulture(language) {
        const culture = normalize(language);
        if (culture === null) throw new Error("Unsupported language.");
        try {
            root.localStorage.setItem(storageKey, culture);
            return true;
        } catch (error) {
            console.warn("Evergreen: could not save the language preference.", error);
            return false;
        }
    }

    root.evergreenLocalization = { initialize, applyCulture, saveCulture };
    const preference = initialize();
    const culture = preference.savedCulture
        || preference.browserLanguages.map(normalize).find(language => language !== null)
        || "en";
    applyCulture(culture);
})(window);
