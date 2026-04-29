const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modMerger = require("../dist/main/services/modMerger.js");

function writeFile(root, relativePath, content) {
    const filePath = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function buildSourceMod(modId, name, loadOrder, installedPath) {
    return {
        modId,
        workshopId: String(2000000000 + modId),
        name,
        loadOrder,
        installedPath,
        descriptorPath: path.join(installedPath, "descriptor.mod"),
        isEnabled: true
    };
}

test("analysis detects file conflicts, safe duplicates, and deterministic winners", async () => {
    assert.equal(typeof modMerger.analyzeModMergerSourcesForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-merger-analysis-"));
    const descriptorRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mod");
    const outputRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mods-merged");
    const modAPath = path.join(tempRoot, "mods", "mod-a");
    const modBPath = path.join(tempRoot, "mods", "mod-b");

    writeFile(modAPath, "common/script_values/alpha.txt", "value_a = 1\n");
    writeFile(modBPath, "common/script_values/alpha.txt", "value_b = 2\n");
    writeFile(modAPath, "gfx/interface/icons/shared.dds", "same-bytes");
    writeFile(modBPath, "gfx/interface/icons/shared.dds", "same-bytes");
    writeFile(modAPath, "events/story.txt", "country_event = { id = mod_a.1 }\n");

    try {
        const result = await modMerger.analyzeModMergerSourcesForTest({
            profileId: 7,
            profileName: "Multiplayer",
            sourceMods: [
                buildSourceMod(11, "Mod A", 0, modAPath),
                buildSourceMod(12, "Mod B", 1, modBPath)
            ],
            descriptorRoot,
            outputRoot,
            outputModName: "SMM Merged Mod",
            gameVersion: "4.3.2"
        });

        assert.equal(result.ok, true);
        assert.equal(result.plan.profileId, 7);
        assert.equal(result.summary.enabledModCount, 2);
        assert.equal(result.summary.scannedFileCount, 5);
        assert.equal(result.summary.conflictingFileCount, 1);
        assert.equal(result.summary.assetConflictCount, 0);
        assert.equal(result.summary.autoResolvedCount, 1);
        assert.equal(result.summary.unresolvedCount, 1);

        const conflictingPlan = result.plan.filePlans.find((plan) => plan.virtualPath === "common/script_values/alpha.txt");
        assert.ok(conflictingPlan, "expected common/script_values/alpha.txt to be present");
        assert.equal(conflictingPlan.fileType, "script");
        assert.equal(conflictingPlan.resolutionState, "unresolved");
        assert.equal(conflictingPlan.winner.modId, 12);
        assert.equal(conflictingPlan.entries.length, 2);

        const duplicatePlan = result.plan.filePlans.find((plan) => plan.virtualPath === "gfx/interface/icons/shared.dds");
        assert.ok(duplicatePlan, "expected gfx/interface/icons/shared.dds to be present");
        assert.equal(duplicatePlan.fileType, "asset");
        assert.equal(duplicatePlan.resolutionState, "auto");
        assert.equal(duplicatePlan.winner.modId, 12);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("file preview reads the selected merger source without exposing arbitrary paths", async () => {
    assert.equal(typeof modMerger.analyzeModMergerSourcesForTest, "function");
    assert.equal(typeof modMerger.readModMergerFilePreviewForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-merger-preview-"));
    const descriptorRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mod");
    const outputRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mods-merged");
    const modAPath = path.join(tempRoot, "mods", "mod-a");
    const modBPath = path.join(tempRoot, "mods", "mod-b");

    writeFile(modAPath, "common/script_values/alpha.txt", "value_a = 1\n");
    writeFile(modBPath, "common/script_values/alpha.txt", "value_b = 2\n");

    try {
        const result = await modMerger.analyzeModMergerSourcesForTest({
            profileId: 9,
            profileName: "Preview",
            sourceMods: [
                buildSourceMod(21, "Mod A", 0, modAPath),
                buildSourceMod(22, "Mod B", 1, modBPath)
            ],
            descriptorRoot,
            outputRoot,
            outputModName: "SMM Merged Mod",
            gameVersion: "4.3.2"
        });

        const preview = await modMerger.readModMergerFilePreviewForTest(result.plan, {
            virtualPath: "common/script_values/alpha.txt",
            modId: 21
        });
        assert.equal(preview.ok, true);
        assert.equal(preview.modName, "Mod A");
        assert.equal(preview.content, "value_a = 1\n");
        assert.equal(preview.truncated, false);
        assert.ok(preview.sourcePath.startsWith(modAPath));

        const winnerPreview = await modMerger.readModMergerFilePreviewForTest(result.plan, {
            virtualPath: "common/script_values/alpha.txt"
        });
        assert.equal(winnerPreview.ok, true);
        assert.equal(winnerPreview.modId, 22);
        assert.equal(winnerPreview.content, "value_b = 2\n");

        const missing = await modMerger.readModMergerFilePreviewForTest(result.plan, {
            virtualPath: path.join(tempRoot, "outside.txt"),
            modId: 21
        });
        assert.equal(missing.ok, false);
        assert.equal(missing.sourcePath, null);
        assert.match(missing.message, /Could not find merge entry/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
