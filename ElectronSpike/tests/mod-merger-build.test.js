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
        workshopId: String(2100000000 + modId),
        name,
        loadOrder,
        installedPath,
        descriptorPath: path.join(installedPath, "descriptor.mod"),
        isEnabled: true
    };
}

test("build writes merged winners, descriptors, manifest, and report", async () => {
    assert.equal(typeof modMerger.analyzeModMergerSourcesForTest, "function");
    assert.equal(typeof modMerger.buildMergedModForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-merger-build-"));
    const descriptorRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mod");
    const outputRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mods-merged");
    const modAPath = path.join(tempRoot, "mods", "mod-a");
    const modBPath = path.join(tempRoot, "mods", "mod-b");

    writeFile(modAPath, "common/defines/test.txt", "from_a = yes\n");
    writeFile(modBPath, "common/defines/test.txt", "from_b = yes\n");
    writeFile(modAPath, "events/unique.txt", "country_event = { id = unique.1 }\n");

    try {
        const analysis = await modMerger.analyzeModMergerSourcesForTest({
            profileId: 9,
            profileName: "Build Test",
            sourceMods: [
                buildSourceMod(21, "Mod A", 0, modAPath),
                buildSourceMod(22, "Mod B", 1, modBPath)
            ],
            descriptorRoot,
            outputRoot,
            outputModName: "SMM Merged Mod",
            gameVersion: "4.3.2"
        });

        const build = await modMerger.buildMergedModForTest({
            plan: analysis.plan,
            descriptorRoot,
            outputRoot,
            appVersion: "0.1.0-test",
            gameVersion: "4.3.2",
            cleanOutputFolder: true
        });

        assert.equal(build.ok, true);
        assert.equal(build.outputModPath, path.join(outputRoot, "smm_merged"));
        assert.equal(fs.existsSync(path.join(build.outputModPath, "descriptor.mod")), true);
        assert.equal(fs.existsSync(path.join(descriptorRoot, "smm_merged.mod")), true);
        assert.equal(fs.existsSync(path.join(build.outputModPath, ".smm-merge-manifest.json")), true);
        assert.equal(fs.existsSync(path.join(build.outputModPath, "merge-report.txt")), true);

        const mergedConflictContent = fs.readFileSync(path.join(build.outputModPath, "common", "defines", "test.txt"), "utf8");
        assert.equal(mergedConflictContent, "from_b = yes\n");

        const descriptorContent = fs.readFileSync(path.join(descriptorRoot, "smm_merged.mod"), "utf8");
        assert.match(descriptorContent, /name="SMM Merged Mod"/);
        assert.match(descriptorContent, /path="mods-merged\/smm_merged"/);

        const manifestContent = fs.readFileSync(path.join(build.outputModPath, ".smm-merge-manifest.json"), "utf8");
        assert.match(manifestContent, /"appVersion": "0\.1\.0-test"/);
        assert.match(manifestContent, /"virtualPath": "common\/defines\/test\.txt"/);

        const reportContent = fs.readFileSync(path.join(build.outputModPath, "merge-report.txt"), "utf8");
        assert.match(reportContent, /Source Mods/);
        assert.match(reportContent, /common\/defines\/test\.txt/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("build rejects output folders that live inside a source mod", async () => {
    assert.equal(typeof modMerger.analyzeModMergerSourcesForTest, "function");
    assert.equal(typeof modMerger.buildMergedModForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-merger-build-unsafe-"));
    const descriptorRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mod");
    const modAPath = path.join(tempRoot, "mods", "mod-a");

    writeFile(modAPath, "common/defines/test.txt", "unsafe = yes\n");

    try {
        const analysis = await modMerger.analyzeModMergerSourcesForTest({
            profileId: 3,
            profileName: "Unsafe",
            sourceMods: [buildSourceMod(31, "Unsafe Mod", 0, modAPath)],
            descriptorRoot,
            outputRoot: path.join(tempRoot, "safe-output"),
            outputModName: "SMM Merged Mod",
            gameVersion: "4.3.2"
        });

        const build = await modMerger.buildMergedModForTest({
            plan: {
                ...analysis.plan,
                outputModPath: path.join(modAPath, "smm_merged")
            },
            descriptorRoot,
            outputRoot: path.join(tempRoot, "safe-output"),
            appVersion: "0.1.0-test",
            gameVersion: "4.3.2",
            cleanOutputFolder: true
        });

        assert.equal(build.ok, false);
        assert.match(build.message, /source mod folder/i);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
