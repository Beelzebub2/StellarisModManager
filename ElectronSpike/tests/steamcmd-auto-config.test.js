const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../dist/main/services/settings.js");

function makeDiscovery(extra = {}) {
    return {
        platform: "win32",
        steamRootCandidates: [],
        existingSteamRoots: [],
        libraryFoldersFiles: [],
        libraries: [],
        discoveredGamePaths: [],
        discoveredWorkshopPaths: [],
        ...extra
    };
}

test("auto-detect replaces a stale SteamCMD download path with the executable directory", () => {
    assert.equal(typeof settings.resolveSteamCmdAutoConfigForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-auto-config-"));
    const steamCmdDir = path.join(tempRoot, "steamcmd");
    const steamCmdPath = path.join(steamCmdDir, "steamcmd.exe");
    const staleDownloadPath = path.join(tempRoot, "missing-download-root");

    fs.mkdirSync(steamCmdDir, { recursive: true });
    fs.writeFileSync(steamCmdPath, "", "utf8");

    try {
        const result = settings.resolveSteamCmdAutoConfigForTest({
            currentSettings: {
                workshopDownloadRuntime: "Auto",
                steamCmdPath,
                steamCmdDownloadPath: staleDownloadPath
            },
            discovery: makeDiscovery()
        });

        assert.equal(result.steamCmdPath, steamCmdPath);
        assert.equal(result.steamCmdDownloadPath, steamCmdDir);
        assert.equal(result.workshopDownloadRuntime, "SteamCMD");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("auto-detect does not report a SteamCMD download path when no executable was found", () => {
    assert.equal(typeof settings.resolveSteamCmdAutoConfigForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-auto-config-"));
    const steamRoot = path.join(tempRoot, "Steam");
    fs.mkdirSync(steamRoot, { recursive: true });

    try {
        const result = settings.resolveSteamCmdAutoConfigForTest({
            currentSettings: {
                workshopDownloadRuntime: "Auto"
            },
            skipExecutableDiscovery: true,
            discovery: makeDiscovery({
                existingSteamRoots: [steamRoot]
            })
        });

        assert.equal(result.steamCmdPath, undefined);
        assert.equal(result.steamCmdDownloadPath, undefined);
        assert.equal(result.workshopDownloadRuntime, "Steamworks");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("auto-detect can derive the SteamCMD download path from the current unsaved SteamCMD path", () => {
    assert.equal(typeof settings.resolveSteamCmdAutoConfigForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-auto-config-"));
    const customDir = path.join(tempRoot, "custom-steamcmd");
    const steamCmdPath = path.join(customDir, "steamcmd.exe");

    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(steamCmdPath, "", "utf8");

    try {
        const result = settings.resolveSteamCmdAutoConfigForTest({
            currentSettings: {
                workshopDownloadRuntime: "Auto",
                steamCmdPath
            },
            discovery: makeDiscovery()
        });

        assert.equal(result.steamCmdPath, steamCmdPath);
        assert.equal(result.steamCmdDownloadPath, customDir);
        assert.equal(result.workshopDownloadRuntime, "SteamCMD");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
