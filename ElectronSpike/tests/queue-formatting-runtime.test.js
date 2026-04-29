const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const queueFormattingModulePath = path.join(__dirname, "..", "src", "renderer", "runtime", "queueFormatting.js");

function loadQueueFormattingModule() {
    const source = fs.readFileSync(queueFormattingModulePath, "utf8")
        .replaceAll("export function ", "function ");
    const context = {
        module: { exports: {} }
    };

    vm.runInNewContext(`${source}
module.exports = {
    buildQueueDetailMessage,
    buildQueueMessageForDisplay,
    formatQueueUpdatedAt,
    parseByteProgress,
    partitionQueueItems,
    queueActionLabel,
    queueClampProgress,
    queueProgressMode,
    queueStatusLabel
};`, context, {
        filename: queueFormattingModulePath
    });

    return context.module.exports;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test("queue formatting normalizes labels and progress values", () => {
    const {
        parseByteProgress,
        partitionQueueItems,
        queueActionLabel,
        queueClampProgress,
        queueProgressMode,
        queueStatusLabel
    } = loadQueueFormattingModule();

    assert.equal(queueStatusLabel("completed"), "Done");
    assert.equal(queueStatusLabel("unknown status"), "Unknown");
    assert.equal(queueActionLabel("uninstall"), "Uninstall");
    assert.equal(queueActionLabel("install"), "Install");
    assert.equal(parseByteProgress("Downloading 4.5 / 10 MB"), "4.5 / 10 MB");
    assert.equal(queueProgressMode({ progressMode: "indeterminate" }), "indeterminate");
    assert.equal(queueProgressMode({ progressMode: "percent" }), "determinate");
    assert.equal(queueClampProgress(-20), 0);
    assert.equal(queueClampProgress(140), 100);
    assert.deepEqual(plain(partitionQueueItems([
        { status: "queued", id: 1 },
        { status: "running", id: 2 },
        { status: "completed", id: 3 }
    ])), {
        active: [{ status: "queued", id: 1 }, { status: "running", id: 2 }],
        history: [{ status: "completed", id: 3 }]
    });
});

test("queue formatting hides noisy worker detail unless developer mode is enabled", () => {
    const { buildQueueDetailMessage, buildQueueMessageForDisplay, formatQueueUpdatedAt } = loadQueueFormattingModule();

    assert.equal(
        buildQueueMessageForDisplay({ status: "queued", action: "install", message: "waiting" }, false),
        "Waiting for a download slot..."
    );
    assert.equal(
        buildQueueMessageForDisplay({ status: "running", action: "install", message: "verifying downloaded files" }, false),
        "Verifying downloaded files..."
    );
    assert.equal(
        buildQueueMessageForDisplay({ status: "failed", action: "install", message: "steam not running" }, false),
        "Steam is not running. Start Steam and retry, or switch to SteamCMD in Settings."
    );
    assert.equal(
        buildQueueMessageForDisplay({ status: "failed", action: "install", message: "raw failure" }, true),
        "raw failure"
    );
    assert.equal(buildQueueDetailMessage("steamcmd reported download failure", false), "Steam download failed. Retry later or verify SteamCMD in Settings.");
    assert.equal(buildQueueDetailMessage("steamcmd reported download failure", true), "steamcmd reported download failure");
    assert.equal(formatQueueUpdatedAt(""), "never");
    assert.equal(formatQueueUpdatedAt("not a date"), "not a date");
});
