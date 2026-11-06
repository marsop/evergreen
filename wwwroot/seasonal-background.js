(() => {
    const root = document.documentElement;
    let timer;

    function refresh() {
        window.clearTimeout(timer);
        const now = new Date();
        const month = now.getMonth();
        root.dataset.season = month >= 2 && month <= 4 ? "spring"
            : month >= 5 && month <= 7 ? "summer"
            : month >= 8 && month <= 10 ? "autumn" : "winter";
        root.dataset.seasonPaused = String(document.hidden);

        if (!document.hidden) {
            const midnight = new Date(now.getFullYear(), month, now.getDate() + 1);
            timer = window.setTimeout(refresh, midnight.getTime() - now.getTime());
        }
    }

    document.addEventListener("visibilitychange", refresh);
    refresh();
})();
