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

test("uses moderate SteamCMD concurrency on typical machines", () => {
    assert.equal(typeof downloadManager.getRecommendedSteamCmdConcurrencyForTest, "function");

    assert.equal(
        downloadManager.getRecommendedSteamCmdConcurrencyForTest({
            cpuCount: 8,
            totalMemoryGb: 16
        }),
        2
    );
});

test("caps SteamCMD concurrency at three isolated workers on stronger machines", () => {
    assert.equal(typeof downloadManager.getRecommendedSteamCmdConcurrencyForTest, "function");

    assert.equal(
        downloadManager.getRecommendedSteamCmdConcurrencyForTest({
            cpuCount: 16,
            totalMemoryGb: 32
        }),
        3
    );
});

test("SteamCMD installs now use isolated workers instead of shared batches", () => {
    assert.equal(typeof downloadManager.resolveInstallQueueModeForTest, "function");

    assert.deepEqual(
        downloadManager.resolveInstallQueueModeForTest({
            runtime: "SteamCmd",
            cpuCount: 12,
            totalMemoryGb: 24
        }),
        {
            mode: "isolated-workers",
            concurrency: 3
        }
    );
});
