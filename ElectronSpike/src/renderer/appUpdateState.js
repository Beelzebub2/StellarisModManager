(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.appUpdateState = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function normalizeRelease(release) {
        return release && typeof release.version === "string" && release.version.trim()
            ? release
            : null;
    }

    function normalizeSkippedVersion(skippedVersion) {
        return String(skippedVersion || "").trim();
    }

    function getVisibleAppUpdateState(latestRelease, skippedVersion) {
        const release = normalizeRelease(latestRelease);
        const skipped = normalizeSkippedVersion(skippedVersion);
        const isSkipped = !!(release && skipped && release.version === skipped);

        return {
            bannerRelease: isSkipped ? null : release,
            settingsRelease: release,
            isSkipped
        };
    }

    return {
        getVisibleAppUpdateState
    };
});
