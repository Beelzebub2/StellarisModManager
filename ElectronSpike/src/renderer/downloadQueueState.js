(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.downloadQueueState = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function clampProgress(value) {
        return Math.max(0, Math.min(100, Number(value || 0)));
    }

    function normalizeStatus(item) {
        return String(item?.status || "").toLowerCase();
    }

    function isIndeterminate(item) {
        return String(item?.progressMode || "").toLowerCase() === "indeterminate";
    }

    function getQueueOverallProgressModel(items) {
        const list = Array.isArray(items) ? items : [];
        const running = list.filter((item) => normalizeStatus(item) === "running");
        if (running.length > 0) {
            const hasIndeterminateRunning = running.some(isIndeterminate);
            const percent = Math.round(running.reduce((sum, item) => sum + clampProgress(item.progress), 0) / running.length);
            if (hasIndeterminateRunning) {
                return {
                    percent,
                    source: "running-indeterminate",
                    count: running.length,
                    indeterminate: true
                };
            }

            return {
                percent,
                source: "running",
                count: running.length
            };
        }

        const queued = list.filter((item) => normalizeStatus(item) === "queued");
        if (queued.length > 0) {
            return {
                percent: 0,
                source: "queued",
                count: queued.length
            };
        }

        if (list.length > 0) {
            return {
                percent: Math.round(list.reduce((sum, item) => sum + clampProgress(item.progress), 0) / list.length),
                source: "history",
                count: list.length
            };
        }

        return {
            percent: 0,
            source: "none",
            count: 0
        };
    }

    return {
        getQueueOverallProgressModel
    };
});
