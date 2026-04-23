const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getInstallPrerequisiteState,
    INSTALL_PREREQUISITE_MESSAGES
} = require("../src/renderer/installPrerequisites.js");

test("blocks install when mods path and SteamCMD are both missing for Auto runtime", () => {
    const result = getInstallPrerequisiteState({
        modsPath: "",
        steamCmdPath: "",
        workshopDownloadRuntime: "Auto"
    });

    assert.equal(result.canInstall, false);
    assert.equal(result.missingModsPath, true);
    assert.equal(result.missingSteamCmd, true);
    assert.equal(result.message, INSTALL_PREREQUISITE_MESSAGES.combined);
});

test("blocks install when SteamCmd runtime is selected without a SteamCMD path", () => {
    const result = getInstallPrerequisiteState({
        modsPath: "C:/Users/test/Documents/Paradox Interactive/Stellaris/mod",
        steamCmdPath: "",
        workshopDownloadRuntime: "SteamCMD"
    });

    assert.equal(result.canInstall, false);
    assert.equal(result.missingModsPath, false);
    assert.equal(result.missingSteamCmd, true);
    assert.equal(result.message, INSTALL_PREREQUISITE_MESSAGES.steamCmd);
});

test("allows install when Steamworks is selected and mods path is configured", () => {
    const result = getInstallPrerequisiteState({
        modsPath: "C:/Users/test/Documents/Paradox Interactive/Stellaris/mod",
        steamCmdPath: "",
        workshopDownloadRuntime: "Steamworks"
    });

    assert.equal(result.canInstall, true);
    assert.equal(result.missingModsPath, false);
    assert.equal(result.missingSteamCmd, false);
    assert.equal(result.message, "");
});
