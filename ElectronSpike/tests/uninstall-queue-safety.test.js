const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("allows install work to run concurrently only with other installs", () => {
    assert.equal(typeof downloadManager.canStartQueuedAction, "function");

    assert.equal(downloadManager.canStartQueuedAction("install", []), true);
    assert.equal(downloadManager.canStartQueuedAction("uninstall", []), true);
    assert.equal(downloadManager.canStartQueuedAction("install", ["install"]), true);
});

test("forces uninstall work to run exclusively", () => {
    assert.equal(typeof downloadManager.canStartQueuedAction, "function");

    assert.equal(downloadManager.canStartQueuedAction("uninstall", ["install"]), false);
    assert.equal(downloadManager.canStartQueuedAction("install", ["uninstall"]), false);
    assert.equal(downloadManager.canStartQueuedAction("uninstall", ["uninstall"]), false);
});
