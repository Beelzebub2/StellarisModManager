const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("falls back to SteamCmd when Steamworks is unavailable in a standalone Stellaris session", () => {
    assert.equal(typeof downloadManager.getSteamworksFallbackDecision, "function");

    assert.deepEqual(
        downloadManager.getSteamworksFallbackDecision(
            "Steamworks for Stellaris is unavailable in this standalone app session. Use SteamCmd for downloads.",
            true
        ),
        {
            shouldFallback: true,
            message: "Steamworks for Stellaris is unavailable in this standalone app session. Retrying with SteamCmd."
        }
    );
});

test("does not claim a SteamCmd fallback when SteamCmd is unavailable", () => {
    assert.equal(typeof downloadManager.getSteamworksFallbackDecision, "function");

    assert.deepEqual(
        downloadManager.getSteamworksFallbackDecision(
            "Steamworks for Stellaris is unavailable in this standalone app session. Use SteamCmd for downloads.",
            false
        ),
        {
            shouldFallback: false,
            message: "Steamworks for Stellaris is unavailable in this standalone app session. Use SteamCmd for downloads."
        }
    );
});
