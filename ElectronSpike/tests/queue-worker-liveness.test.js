const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stellaris-queue-worker-"));
process.env.APPDATA = appDataRoot;

const settings = require("../dist/main/services/settings.js");
const downloadManager = require("../dist/main/services/downloadManager.js");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = await predicate();
        if (value) {
            return value;
        }

        await sleep(100);
    }

    throw new Error(`Timed out waiting for ${label}.`);
}

async function createLargeModInstall(modsRoot, workshopId) {
    const installPath = path.join(modsRoot, workshopId);
    await fsp.mkdir(installPath, { recursive: true });

    for (let dirIndex = 0; dirIndex < 80; dirIndex += 1) {
        const chunkDir = path.join(installPath, `chunk-${String(dirIndex).padStart(2, "0")}`);
        await fsp.mkdir(chunkDir, { recursive: true });

        const writes = [];
        for (let fileIndex = 0; fileIndex < 40; fileIndex += 1) {
            writes.push(
                fsp.writeFile(
                    path.join(chunkDir, `file-${String(fileIndex).padStart(2, "0")}.txt`),
                    `${workshopId}-${dirIndex}-${fileIndex}`.repeat(8),
                    "utf8"
                )
            );
        }

        await Promise.all(writes);
    }

    await fsp.writeFile(
        path.join(modsRoot, `${workshopId}.mod`),
        `name="Test ${workshopId}"\nremote_file_id="${workshopId}"\npath="mod/${workshopId}"\n`,
        "utf8"
    );
}

test("queue worker keeps processing items queued while another job is still running", async () => {
    const modsRoot = path.join(appDataRoot, "mods");
    const firstId = "790000111";
    const secondId = "790000222";

    downloadManager.cancelAllDownloads();
    downloadManager.clearDownloadHistory();

    const saved = settings.saveSettingsSnapshot({
        workshopDownloadRuntime: "SteamCMD",
        modsPath: modsRoot,
        autoDetectGame: true,
        warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember",
        autoCheckAppUpdates: true,
        hideDisabledMods: false
    });
    assert.equal(saved.ok, true);

    await createLargeModInstall(modsRoot, firstId);
    await createLargeModInstall(modsRoot, secondId);

    const firstQueued = await downloadManager.queueDownload({
        workshopId: firstId,
        modName: "First queued uninstall",
        action: "uninstall"
    });
    assert.equal(firstQueued.ok, true);

    await waitFor(() => {
        const snapshot = downloadManager.getDownloadQueueSnapshot();
        return snapshot.runningCount === 1 && snapshot.pendingCount === 0 ? snapshot : null;
    }, 15000, "the first uninstall to become the only active job");

    const secondQueued = await downloadManager.queueDownload({
        workshopId: secondId,
        modName: "Second queued uninstall",
        action: "uninstall"
    });
    assert.equal(secondQueued.ok, true);

    await waitFor(() => {
        const snapshot = downloadManager.getDownloadQueueSnapshot();
        const secondItem = snapshot.items.find((item) => item.workshopId === secondId);
        return secondItem?.status === "queued" ? secondItem : null;
    }, 5000, "the second uninstall to remain queued behind the active one");

    const finalSnapshot = await waitFor(() => {
        const snapshot = downloadManager.getDownloadQueueSnapshot();
        const secondItem = snapshot.items.find((item) => item.workshopId === secondId);
        return secondItem?.status === "completed" && snapshot.runningCount === 0 ? snapshot : null;
    }, 30000, "the queued uninstall to start after the first job finishes");

    const firstItem = finalSnapshot.items.find((item) => item.workshopId === firstId);
    const secondItem = finalSnapshot.items.find((item) => item.workshopId === secondId);

    assert.equal(firstItem?.status, "completed");
    assert.equal(secondItem?.status, "completed");
    await assert.rejects(() => fsp.access(path.join(modsRoot, firstId)));
    await assert.rejects(() => fsp.access(path.join(modsRoot, secondId)));

    downloadManager.clearDownloadHistory([firstId, secondId]);
});
