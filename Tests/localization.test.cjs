const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "localization.js"), "utf8");

function browser({ saved = null, languages = ["en"], unavailable = false } = {}) {
    const warnings = [];
    const elements = ["loading", "error", "reload", "dismiss"].map(key => ({
        dataset: { localization: key },
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; }
    }));
    const window = {
        navigator: { languages },
        document: { documentElement: {}, querySelectorAll: () => elements },
        localStorage: {
            getItem() { if (unavailable) throw new Error("Storage blocked"); return saved; },
            setItem(key, value) { if (unavailable) throw new Error("Storage blocked"); saved = value; }
        }
    };
    vm.runInNewContext(source, { window, console: { warn: (...args) => warnings.push(args) } });
    return { window, elements, warnings, saved: () => saved };
}

test("browser detection uses first supported language and normalizes regional variants", () => {
    const { window, elements } = browser({ languages: ["fr-CA", "es-MX", "de"] });
    assert.equal(window.document.documentElement.lang, "es");
    assert.equal(elements[0].textContent, "Cargando Evergreen...");
    assert.equal(elements[3].attributes["aria-label"], "Cerrar");
});

test("saved preference takes precedence over browser settings", () => {
    const { window } = browser({ saved: "de-AT", languages: ["es"] });
    assert.equal(window.document.documentElement.lang, "de");
});

test("unsupported browser languages fall back to English", () => {
    const { window } = browser({ languages: ["ja", "fr"] });
    assert.equal(window.document.documentElement.lang, "en");
});

test("invalid stored preferences fall back with a warning", () => {
    const { window, warnings } = browser({ saved: "not a language!", languages: ["de"] });
    assert.equal(window.document.documentElement.lang, "de");
    assert.equal(warnings.length, 1);
});

test("live changes update document and bootstrap errors without reloading", () => {
    const { window, elements, saved } = browser();
    window.evergreenLocalization.applyCulture("de");
    assert.equal(window.evergreenLocalization.saveCulture("de"), true);
    assert.equal(window.document.documentElement.lang, "de");
    assert.equal(elements[1].textContent, "Ein unerwarteter Fehler ist aufgetreten.");
    assert.equal(elements[2].textContent, "Neu laden");
    assert.equal(saved(), "de");
});

test("storage failures are explicit but do not prevent culture changes", () => {
    const { window, warnings } = browser({ languages: ["es"], unavailable: true });
    assert.equal(window.document.documentElement.lang, "es");
    assert.equal(window.evergreenLocalization.initialize().storageUnavailable, true);
    window.evergreenLocalization.applyCulture("de");
    assert.equal(window.evergreenLocalization.saveCulture("de"), false);
    assert.equal(window.document.documentElement.lang, "de");
    assert.equal(warnings.length, 3);
});

test("invalid changes throw rather than reporting success", () => {
    const { window } = browser();
    assert.throws(() => window.evergreenLocalization.applyCulture("fr"), /Unsupported language/);
    assert.throws(() => window.evergreenLocalization.saveCulture("fr"), /Unsupported language/);
    assert.throws(() => window.evergreenLocalization.applyCulture("en-@@"), /Unsupported language/);
});

test("Blazor startup loads all satellite resources before live switching", () => {
    const index = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "index.html"), "utf8");
    assert.match(index, /blazor\.webassembly\.js" autostart="false"/);
    const startup = index.match(/<script>([\s\S]*?)<\/script>/)[1];
    let options;
    vm.runInNewContext(startup, {
        document: { documentElement: { lang: "es" } },
        Blazor: { start(config) { options = config; return Promise.resolve(); } }
    });
    assert.equal(options.applicationCulture, "es");
    let runtimeConfig;
    options.configureRuntime({ withConfig(config) { runtimeConfig = config; } });
    assert.equal(runtimeConfig.loadAllSatelliteResources, true);
});

test("startup failure logs the error and displays the fatal-error UI", async () => {
    const index = fs.readFileSync(path.join(__dirname, "..", "wwwroot", "index.html"), "utf8");
    const startup = index.match(/<script>([\s\S]*?)<\/script>/)[1];
    const element = { style: {} };
    const errors = [];
    vm.runInNewContext(startup, {
        document: { documentElement: { lang: "en" }, querySelector: () => element },
        console: { error: (...args) => errors.push(args) },
        Blazor: { start() { return Promise.reject(new Error("Network unavailable")); } }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(element.style.display, "block");
    assert.equal(errors.length, 1);
});
