const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("parses SteamCMD content log download totals", () => {
    assert.equal(typeof downloadManager.parseSteamCmdContentLogLineForTest, "function");

    const parsed = downloadManager.parseSteamCmdContentLogLineForTest(
        "[2026-04-22 14:07:42] AppID 281990 update started : download 0/2879720240, store 0/0, reuse 0/0, delta 0/0, stage 0/7724407934 "
    );

    assert.deepEqual(parsed, {
        phase: "downloading",
        downloadBytesTotal: 2879720240,
        stageBytesTotal: 7724407934
    });
});

test("parses SteamCMD content log committing phase", () => {
    assert.equal(typeof downloadManager.parseSteamCmdContentLogLineForTest, "function");

    const parsed = downloadManager.parseSteamCmdContentLogLineForTest(
        "[2026-04-22 14:09:49] AppID 281990 Workshop update changed : Running Update,Committing,"
    );

    assert.deepEqual(parsed, {
        phase: "committing"
    });
});

test("builds indeterminate SteamCMD progress for opaque large downloads", () => {
    assert.equal(typeof downloadManager.buildSteamCmdPhaseProgressForTest, "function");

    const progress = downloadManager.buildSteamCmdPhaseProgressForTest({
        workshopId: "3575236236",
        previousProgress: 6,
        phase: "downloading",
        downloadBytesTotal: 2879720240,
        stageBytesTotal: 7724407934
    });

    assert.equal(progress.progress, 18);
    assert.equal(progress.progressMode, "indeterminate");
    assert.match(progress.message, /2\.68 GB transfer/i);
    assert.match(progress.message, /7\.19 GB installed data/i);
    assert.doesNotMatch(progress.message, /\d+\.?\d*\s*\/\s*\d+\.?\d*\s*(MB|GB|KB)/i);
});

test("builds indeterminate SteamCMD progress for commit phase", () => {
    assert.equal(typeof downloadManager.buildSteamCmdPhaseProgressForTest, "function");

    const progress = downloadManager.buildSteamCmdPhaseProgressForTest({
        workshopId: "3575236236",
        previousProgress: 18,
        phase: "committing",
        downloadBytesTotal: 2879720240,
        stageBytesTotal: 7724407934
    });

    assert.equal(progress.progress, 90);
    assert.equal(progress.progressMode, "indeterminate");
    assert.match(progress.message, /Committing 7\.19 GB of staged files/i);
});
