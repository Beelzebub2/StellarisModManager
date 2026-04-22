const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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

test("steamcmd bootstrap installs into the app folder when auto-config cannot detect an existing executable", async () => {
    assert.equal(typeof settings.autoConfigureSteamCmdSnapshotForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-bootstrap-"));
    const steamCmdRoot = path.join(tempRoot, "steamcmd");
    let installCalls = 0;

    try {
        const result = await settings.autoConfigureSteamCmdSnapshotForTest({
            currentSettings: {
                workshopDownloadRuntime: "Auto",
                steamCmdPath: "",
                steamCmdDownloadPath: ""
            },
            discovery: makeDiscovery(),
            skipExecutableDiscovery: true,
            installRoot: steamCmdRoot,
            installSteamCmd: async ({ installRoot, executableName }) => {
                installCalls += 1;
                fs.mkdirSync(installRoot, { recursive: true });
                fs.writeFileSync(path.join(installRoot, executableName), "", "utf8");
            }
        });

        assert.equal(installCalls, 1);
        assert.equal(result.ok, true);
        assert.equal(result.settings.steamCmdPath, path.join(steamCmdRoot, "steamcmd.exe"));
        assert.equal(result.settings.steamCmdDownloadPath, steamCmdRoot);
        assert.equal(result.settings.workshopDownloadRuntime, "SteamCmd");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("steamcmd bootstrap ignores a stale Steam root and falls back to the app-owned steamcmd folder", async () => {
    assert.equal(typeof settings.autoConfigureSteamCmdSnapshotForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-bootstrap-appdata-"));
    const originalAppData = process.env.APPDATA;
    const staleSteamRoot = path.join(tempRoot, "Program Files (x86)", "Steam");
    const expectedInstallRoot = path.join(tempRoot, "StellarisModManager", "steamcmd");
    let seenInstallRoot = "";

    process.env.APPDATA = tempRoot;
    fs.mkdirSync(staleSteamRoot, { recursive: true });

    try {
        const result = await settings.autoConfigureSteamCmdSnapshotForTest({
            currentSettings: {
                workshopDownloadRuntime: "Auto",
                steamCmdPath: "",
                steamCmdDownloadPath: staleSteamRoot
            },
            discovery: makeDiscovery({
                existingSteamRoots: [staleSteamRoot]
            }),
            skipExecutableDiscovery: true,
            installSteamCmd: async ({ installRoot, executableName }) => {
                seenInstallRoot = installRoot;
                fs.mkdirSync(installRoot, { recursive: true });
                fs.writeFileSync(path.join(installRoot, executableName), "", "utf8");
            }
        });

        assert.equal(seenInstallRoot, expectedInstallRoot);
        assert.equal(result.ok, true);
        assert.equal(result.settings.steamCmdPath, path.join(expectedInstallRoot, "steamcmd.exe"));
        assert.equal(result.settings.steamCmdDownloadPath, expectedInstallRoot);
        assert.equal(result.settings.workshopDownloadRuntime, "SteamCmd");
    } finally {
        if (originalAppData === undefined) {
            delete process.env.APPDATA;
        } else {
            process.env.APPDATA = originalAppData;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("steamcmd zip extraction helper expands archives with literal paths on Windows", () => {
    if (process.platform !== "win32") {
        return;
    }

    assert.equal(typeof settings.extractSteamCmdArchiveForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-extract-"));
    const sourceDir = path.join(tempRoot, "source");
    const archivePath = path.join(tempRoot, "sample.zip");
    const destinationPath = path.join(tempRoot, "output");
    const sourceFilePath = path.join(sourceDir, "steamcmd.exe");

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourceFilePath, "stub", "utf8");

    try {
        execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `Compress-Archive -LiteralPath '${sourceFilePath.replace(/'/g, "''")}' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`
            ],
            { stdio: "ignore" }
        );

        settings.extractSteamCmdArchiveForTest({
            archivePath,
            destinationPath,
            archiveKind: "zip"
        });

        assert.equal(fs.readFileSync(path.join(destinationPath, "steamcmd.exe"), "utf8"), "stub");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
