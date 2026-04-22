const test = require("node:test");
const assert = require("node:assert/strict");

const queueState = require("../src/renderer/downloadQueueState.js");

test("overall queue progress only averages live running operations", () => {
    assert.equal(typeof queueState.getQueueOverallProgressModel, "function");

    const summary = queueState.getQueueOverallProgressModel([
        { workshopId: "1", status: "running", progress: 68 },
        { workshopId: "2", status: "queued", progress: 0 },
        { workshopId: "3", status: "queued", progress: 0 }
    ]);

    assert.deepEqual(summary, {
        percent: 68,
        source: "running",
        count: 1
    });
});

test("queued-only operations do not report fake overall progress", () => {
    assert.equal(typeof queueState.getQueueOverallProgressModel, "function");

    const summary = queueState.getQueueOverallProgressModel([
        { workshopId: "2", status: "queued", progress: 0 },
        { workshopId: "3", status: "queued", progress: 0 }
    ]);

    assert.deepEqual(summary, {
        percent: 0,
        source: "queued",
        count: 2
    });
});

test("indeterminate running operations do not report a fake average percentage", () => {
    assert.equal(typeof queueState.getQueueOverallProgressModel, "function");

    const summary = queueState.getQueueOverallProgressModel([
        { workshopId: "1", status: "running", progress: 18, progressMode: "indeterminate" }
    ]);

    assert.deepEqual(summary, {
        percent: 18,
        source: "running-indeterminate",
        count: 1,
        indeterminate: true
    });
});
