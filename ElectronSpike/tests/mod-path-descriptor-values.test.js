const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("descriptor path uses the configured mods directory name when it stays under the Stellaris folder", () => {
    assert.equal(typeof downloadManager.buildManagedDescriptorPathForTest, "function");

    const descriptorPath = downloadManager.buildManagedDescriptorPathForTest({
        modsRoot: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mods-alt",
        installedPath: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mods-alt\\2104538771"
    });

    assert.equal(descriptorPath, "mods-alt/2104538771");
});

test("descriptor path falls back to an absolute path when the mods root sits outside the Stellaris folder", () => {
    assert.equal(typeof downloadManager.buildManagedDescriptorPathForTest, "function");

    const descriptorPath = downloadManager.buildManagedDescriptorPathForTest({
        modsRoot: "D:\\Managed Mods",
        installedPath: "D:\\Managed Mods\\2104538771"
    });

    assert.equal(descriptorPath, "D:/Managed Mods/2104538771");
});

test("dlc_load descriptor references track the configured mods directory instead of a hardcoded mod prefix", () => {
    assert.equal(typeof downloadManager.buildManagedDescriptorReferenceForTest, "function");

    const descriptorReference = downloadManager.buildManagedDescriptorReferenceForTest({
        modsRoot: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mods-alt",
        descriptorPath: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mods-alt\\2104538771.mod"
    });

    assert.equal(descriptorReference, "mods-alt/2104538771.mod");
});

test("descriptor path becomes absolute when descriptors stay in Documents but managed mods move elsewhere", () => {
    assert.equal(typeof downloadManager.buildManagedDescriptorPathForTest, "function");

    const descriptorPath = downloadManager.buildManagedDescriptorPathForTest({
        modsRoot: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mod",
        installedPath: "D:\\games\\stellaris\\mod\\2104538771"
    });

    assert.equal(descriptorPath, "D:/games/stellaris/mod/2104538771");
});

test("dlc_load descriptor references still point at the Documents mod folder when managed mods live elsewhere", () => {
    assert.equal(typeof downloadManager.buildManagedDescriptorReferenceForTest, "function");

    const descriptorReference = downloadManager.buildManagedDescriptorReferenceForTest({
        modsRoot: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mod",
        descriptorPath: "C:\\Users\\Test\\Documents\\Paradox Interactive\\Stellaris\\mod\\2104538771.mod"
    });

    assert.equal(descriptorReference, "mod/2104538771.mod");
});
