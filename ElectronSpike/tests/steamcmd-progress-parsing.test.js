const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("parses SteamCMD progress lines that use progress-colon output", () => {
    assert.equal(typeof downloadManager.parseSteamCmdProgressForTest, "function");

    const parsed = downloadManager.parseSteamCmdProgressForTest(
        "Update state (0x61) downloading, progress: 6.61 (69328008 / 1048576000)"
    );

    assert.equal(parsed.progress, 7);
    assert.equal(typeof parsed.byteProgress, "string");
    assert.match(parsed.byteProgress, /\//);
});

test("parses plain percentage SteamCMD output", () => {
    assert.equal(typeof downloadManager.parseSteamCmdProgressForTest, "function");

    const parsed = downloadManager.parseSteamCmdProgressForTest(
        "Downloading update (42.00%)"
    );

    assert.equal(parsed.progress, 42);
    assert.equal(parsed.byteProgress, null);
});

test("ignores SteamCMD self-update percentages that are not workshop download progress", () => {
    assert.equal(typeof downloadManager.parseSteamCmdProgressForTest, "function");

    const parsed = downloadManager.parseSteamCmdProgressForTest(
        "[  1%] Checking for available updates..."
    );

    assert.equal(parsed.progress, null);
    assert.equal(parsed.byteProgress, null);
});
