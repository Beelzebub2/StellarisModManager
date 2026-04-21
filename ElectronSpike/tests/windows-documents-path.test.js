const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../dist/main/services/settings.js");

test("default mods path follows redirected Windows Documents folders", () => {
    assert.equal(typeof settings.getDefaultModsPathForTest, "function");

    assert.equal(
        settings.getDefaultModsPathForTest({
            platform: "win32",
            homeDir: "C:\\Users\\ricar",
            env: {
                USERPROFILE: "C:\\Users\\ricar"
            },
            skipRegistryLookup: true,
            shellFoldersPersonal: "C:\\Users\\ricar\\OneDrive\\Documents",
            userShellFoldersPersonal: "%USERPROFILE%\\OneDrive\\Documents"
        }),
        "C:\\Users\\ricar\\OneDrive\\Documents\\Paradox Interactive\\Stellaris\\mod"
    );
});

test("expanded registry values are used when only User Shell Folders is available", () => {
    assert.equal(typeof settings.resolveWindowsDocumentsDirectoryForTest, "function");

    assert.equal(
        settings.resolveWindowsDocumentsDirectoryForTest({
            homeDir: "C:\\Users\\ricar",
            env: {
                USERPROFILE: "C:\\Users\\ricar"
            },
            skipRegistryLookup: true,
            userShellFoldersPersonal: "%USERPROFILE%\\OneDrive\\Documents"
        }),
        "C:\\Users\\ricar\\OneDrive\\Documents"
    );
});

test("Windows documents path falls back to the local Documents folder when no redirect is configured", () => {
    assert.equal(typeof settings.resolveWindowsDocumentsDirectoryForTest, "function");

    assert.equal(
        settings.resolveWindowsDocumentsDirectoryForTest({
            homeDir: "C:\\Users\\ricar",
            env: {
                USERPROFILE: "C:\\Users\\ricar"
            },
            skipRegistryLookup: true
        }),
        "C:\\Users\\ricar\\Documents"
    );
});
