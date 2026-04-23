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
    const documentsStellarisDir = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris");
    const descriptorModsPath = path.join(documentsStellarisDir, "mod");
    const currentManagedModsPath = descriptorModsPath;
    const nextManagedModsPath = path.join(tempRoot, "D-drive", "games", "stellaris", "mod");
    const installedPath = path.join(currentManagedModsPath, "2104538771");
    const descriptorPath = path.join(descriptorModsPath, "2104538771.mod");

    fs.mkdirSync(installedPath, { recursive: true });
    fs.writeFileSync(path.join(installedPath, "contents.txt"), "installed", "utf8");
    writeDescriptor(descriptorPath, "mod/2104538771");

    try {
        const result = await library.migrateManagedModsForTest({
            descriptorModsPath,
            currentManagedModsPath,
            nextManagedModsPath,
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
        assert.equal(result.mods[0].installedPath, path.join(nextManagedModsPath, "2104538771"));
        assert.equal(result.mods[0].descriptorPath, descriptorPath);
        assert.equal(fs.existsSync(installedPath), false);
        assert.equal(fs.existsSync(descriptorPath), true);
        assert.equal(fs.existsSync(path.join(nextManagedModsPath, "2104538771", "contents.txt")), true);

        const rewrittenDescriptor = fs.readFileSync(descriptorPath, "utf8");
        assert.match(rewrittenDescriptor, /path=".*D-drive\/games\/stellaris\/mod\/2104538771"/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("rewriting descriptors without moving files points them at the new absolute location", async () => {
    assert.equal(typeof library.migrateManagedModsForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-path-migrate-"));
    const documentsStellarisDir = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris");
    const descriptorModsPath = path.join(documentsStellarisDir, "mod");
    const currentManagedModsPath = descriptorModsPath;
    const nextManagedModsPath = path.join(tempRoot, "Managed Mods");
    const installedPath = path.join(currentManagedModsPath, "2104538771");
    const descriptorPath = path.join(descriptorModsPath, "2104538771.mod");

    fs.mkdirSync(installedPath, { recursive: true });
    fs.writeFileSync(path.join(installedPath, "contents.txt"), "installed", "utf8");
    writeDescriptor(descriptorPath, "mod/2104538771");

    try {
        const result = await library.migrateManagedModsForTest({
            descriptorModsPath,
            currentManagedModsPath,
            nextManagedModsPath,
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
        assert.equal(result.mods[0].installedPath, path.join(nextManagedModsPath, "2104538771"));
        assert.equal(result.mods[0].descriptorPath, descriptorPath);
        assert.equal(fs.existsSync(installedPath), true);
        assert.equal(fs.existsSync(descriptorPath), true);

        const rewrittenDescriptor = fs.readFileSync(descriptorPath, "utf8");
        assert.match(
            rewrittenDescriptor,
            new RegExp(`path="${escapeRegExp(path.join(nextManagedModsPath, "2104538771").replace(/\\/g, "/"))}"`)
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
