const test = require("node:test");
const assert = require("node:assert/strict");

const mergerProgressState = require("../dist/main/services/modMergerProgressState.js");

test("mod merger progress status tracks operation phases and completion state", () => {
    assert.equal(typeof mergerProgressState.startModMergerProgress, "function");
    assert.equal(typeof mergerProgressState.updateModMergerProgress, "function");
    assert.equal(typeof mergerProgressState.finishModMergerProgress, "function");
    assert.equal(typeof mergerProgressState.getModMergerProgressStatus, "function");
    assert.equal(typeof mergerProgressState.resetModMergerProgressStateForTest, "function");

    mergerProgressState.resetModMergerProgressStateForTest();
    mergerProgressState.startModMergerProgress({
        operation: "analyze",
        startedAtUtc: new Date().toISOString(),
        totalItemCount: 4,
        message: "Analyzing enabled mods..."
    });

    mergerProgressState.updateModMergerProgress({
        phase: "Scanning files",
        currentItemLabel: "Real Space",
        processedItemCount: 2,
        totalItemCount: 4,
        progressPercent: 50,
        message: "Scanning mod files for overlaps."
    });

    let status = mergerProgressState.getModMergerProgressStatus();
    assert.equal(status.active, true);
    assert.equal(status.operation, "analyze");
    assert.equal(status.phase, "Scanning files");
    assert.equal(status.currentItemLabel, "Real Space");
    assert.equal(status.processedItemCount, 2);
    assert.equal(status.totalItemCount, 4);
    assert.equal(status.progressPercent, 50);
    assert.equal(status.message, "Scanning mod files for overlaps.");

    mergerProgressState.finishModMergerProgress({
        ok: true,
        completedAtUtc: new Date().toISOString(),
        message: "Analyzed 4 mod(s); found 12 conflicting file(s)."
    });

    status = mergerProgressState.getModMergerProgressStatus();
    assert.equal(status.active, false);
    assert.equal(status.operation, "analyze");
    assert.equal(status.progressPercent, 100);
    assert.equal(status.completedAtUtc === null, false);
    assert.equal(status.lastResultOk, true);
    assert.equal(status.message, "Analyzed 4 mod(s); found 12 conflicting file(s).");

    mergerProgressState.resetModMergerProgressStateForTest();
});
