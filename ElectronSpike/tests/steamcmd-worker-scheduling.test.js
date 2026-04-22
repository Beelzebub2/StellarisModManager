const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("chooses conservative SteamCMD concurrency on weaker machines", () => {
    assert.equal(typeof downloadManager.getRecommendedSteamCmdConcurrencyForTest, "function");

    assert.equal(
        downloadManager.getRecommendedSteamCmdConcurrencyForTest({
            cpuCount: 4,
            totalMemoryGb: 8
        }),
        1
    );
});

test("keeps SteamCMD downloads on a single worker on typical machines so progress stays attributable", () => {
    assert.equal(typeof downloadManager.getRecommendedSteamCmdConcurrencyForTest, "function");

    assert.equal(
        downloadManager.getRecommendedSteamCmdConcurrencyForTest({
            cpuCount: 8,
            totalMemoryGb: 16
        }),
        1
    );
});

test("keeps SteamCMD downloads on a single worker even on stronger machines", () => {
    assert.equal(typeof downloadManager.getRecommendedSteamCmdConcurrencyForTest, "function");

    assert.equal(
        downloadManager.getRecommendedSteamCmdConcurrencyForTest({
            cpuCount: 16,
            totalMemoryGb: 32
        }),
        1
    );
});

test("SteamCMD installs still use isolated workers, but only one at a time", () => {
    assert.equal(typeof downloadManager.resolveInstallQueueModeForTest, "function");

    assert.deepEqual(
        downloadManager.resolveInstallQueueModeForTest({
            runtime: "SteamCmd",
            cpuCount: 12,
            totalMemoryGb: 24
        }),
        {
            mode: "isolated-workers",
            concurrency: 1
        }
    );
});
