const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stellaris-download-concurrency-"));
process.env.APPDATA = appDataRoot;

const settings = require("../dist/main/services/settings.js");
const downloadManager = require("../dist/main/services/downloadManager.js");

test("settings save clamps runtime-specific download concurrency to the supported range", () => {
    assert.equal(typeof settings.saveSettingsSnapshot, "function");
    assert.equal(typeof settings.loadSettingsSnapshot, "function");

    const saved = settings.saveSettingsSnapshot({
        workshopDownloadRuntime: "Auto",
        steamworksMaxConcurrentDownloads: 99,
        steamCmdMaxConcurrentDownloads: -2,
        autoDetectGame: true,
        warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember",
        autoCheckAppUpdates: true,
        hideDisabledMods: false
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.settings.steamworksMaxConcurrentDownloads, 5);
    assert.equal(saved.settings.steamCmdMaxConcurrentDownloads, 1);

    const loaded = settings.loadSettingsSnapshot();
    assert.equal(loaded?.steamworksMaxConcurrentDownloads, 5);
    assert.equal(loaded?.steamCmdMaxConcurrentDownloads, 1);
});

test("queue mode uses the configured per-runtime concurrency limits", () => {
    assert.equal(typeof downloadManager.resolveInstallQueueModeForTest, "function");

    assert.deepEqual(
        downloadManager.resolveInstallQueueModeForTest({
            runtime: "SteamKit2",
            steamworksMaxConcurrentDownloads: 5,
            steamCmdMaxConcurrentDownloads: 2
        }),
        {
            mode: "default",
            concurrency: 5
        }
    );

    assert.deepEqual(
        downloadManager.resolveInstallQueueModeForTest({
            runtime: "SteamCMD",
            steamworksMaxConcurrentDownloads: 5,
            steamCmdMaxConcurrentDownloads: 4
        }),
        {
            mode: "isolated-workers",
            concurrency: 4
        }
    );
});
