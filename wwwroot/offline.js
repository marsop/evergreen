window.evergreenOffline = { failed: !("serviceWorker" in navigator) };
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(new URL("service-worker.js", document.baseURI), {
            scope: new URL("./", document.baseURI).href,
            updateViaCache: "none"
        }).then(registration => {
            function watchInstallation() {
                const worker = registration.installing;
                if (!worker) return;
                worker.addEventListener("statechange", () => {
                    if (worker.state === "redundant") {
                        unavailable(new Error("Service worker installation did not complete."));
                    }
                });
            }
            watchInstallation();
            registration.addEventListener("updatefound", watchInstallation);
        }).catch(unavailable);
    });
}

function unavailable(error) {
    console.error("Evergreen: offline app caching failed.", error);
    window.evergreenOffline.failed = true;
    window.dispatchEvent(new Event("evergreen-offline-unavailable"));
}
