const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const library = require("../dist/main/services/library.js");

function writeDescriptor(filePath, descriptorPathValue) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
        filePath,
        `name="Test Mod"\nremote_file_id="2104538771"\npath="${descriptorPathValue}"\n`,
        "utf8"
    );
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("moving the mods folder rewrites descriptors and relocates the installed mod files", async () => {
    assert.equal(typeof library.migrateManagedModsForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-path-migrate-"));
    const stellarisDir = path.join(tempRoot, "Stellaris");
    const currentModsPath = path.join(stellarisDir, "mod");
    const nextModsPath = path.join(stellarisDir, "mods-alt");
    const installedPath = path.join(currentModsPath, "2104538771");
    const descriptorPath = path.join(currentModsPath, "2104538771.mod");

    fs.mkdirSync(installedPath, { recursive: true });
    fs.writeFileSync(path.join(installedPath, "contents.txt"), "installed", "utf8");
    writeDescriptor(descriptorPath, "mod/2104538771");

    try {
        const result = await library.migrateManagedModsForTest({
            currentModsPath,
            nextModsPath,
            moveExistingMods: true,
            mods: [
                {
                    id: 1,
                    workshopId: "2104538771",
                    installedPath,
                    descriptorPath
                }
            ]
        });

        assert.equal(result.movedModCount, 1);
        assert.equal(result.rewrittenDescriptorCount, 1);
        assert.equal(result.mods[0].installedPath, path.join(nextModsPath, "2104538771"));
        assert.equal(result.mods[0].descriptorPath, path.join(nextModsPath, "2104538771.mod"));
        assert.equal(fs.existsSync(installedPath), false);
        assert.equal(fs.existsSync(descriptorPath), false);
        assert.equal(fs.existsSync(path.join(nextModsPath, "2104538771", "contents.txt")), true);

        const rewrittenDescriptor = fs.readFileSync(path.join(nextModsPath, "2104538771.mod"), "utf8");
        assert.match(rewrittenDescriptor, /path="mods-alt\/2104538771"/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("rewriting descriptors without moving files points them at the new absolute location", async () => {
    assert.equal(typeof library.migrateManagedModsForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-path-migrate-"));
    const stellarisDir = path.join(tempRoot, "Stellaris");
    const currentModsPath = path.join(stellarisDir, "mod");
    const nextModsPath = path.join(tempRoot, "Managed Mods");
    const installedPath = path.join(currentModsPath, "2104538771");
    const descriptorPath = path.join(currentModsPath, "2104538771.mod");

    fs.mkdirSync(installedPath, { recursive: true });
    fs.writeFileSync(path.join(installedPath, "contents.txt"), "installed", "utf8");
    writeDescriptor(descriptorPath, "mod/2104538771");

    try {
        const result = await library.migrateManagedModsForTest({
            currentModsPath,
            nextModsPath,
            moveExistingMods: false,
            mods: [
                {
                    id: 1,
                    workshopId: "2104538771",
                    installedPath,
                    descriptorPath
                }
            ]
        });

        assert.equal(result.movedModCount, 0);
        assert.equal(result.rewrittenDescriptorCount, 1);
        assert.equal(result.mods[0].installedPath, path.join(nextModsPath, "2104538771"));
        assert.equal(fs.existsSync(installedPath), true);
        assert.equal(fs.existsSync(descriptorPath), false);

        const rewrittenDescriptor = fs.readFileSync(path.join(nextModsPath, "2104538771.mod"), "utf8");
        assert.match(
            rewrittenDescriptor,
            new RegExp(`path="${escapeRegExp(path.join(nextModsPath, "2104538771").replace(/\\/g, "/"))}"`)
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
