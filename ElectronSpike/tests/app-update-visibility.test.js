const test = require("node:test");
const assert = require("node:assert/strict");

const appUpdateState = require("../src/renderer/appUpdateState.js");

test("skipped updates stay installable from settings while hiding the popup banner", () => {
    const release = {
        version: "1.2.3",
        changelog: "Bug fixes",
        critical: false,
        downloadUrl: "https://example.com/download",
        releaseUrl: "https://example.com/release",
        releasedAt: "2026-04-22T00:00:00Z"
    };

    const view = appUpdateState.getVisibleAppUpdateState(release, "1.2.3");

    assert.equal(view.bannerRelease, null);
    assert.deepEqual(view.settingsRelease, release);
});

test("non-skipped updates are visible in both popup and settings", () => {
    const release = {
        version: "1.2.3",
        changelog: "Bug fixes",
        critical: false,
        downloadUrl: "https://example.com/download",
        releaseUrl: "https://example.com/release",
        releasedAt: "2026-04-22T00:00:00Z"
    };

    const view = appUpdateState.getVisibleAppUpdateState(release, "1.2.2");

    assert.deepEqual(view.bannerRelease, release);
    assert.deepEqual(view.settingsRelease, release);
});
