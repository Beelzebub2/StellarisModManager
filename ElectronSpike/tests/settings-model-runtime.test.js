const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settingsModelModulePath = path.join(__dirname, "..", "src", "renderer", "runtime", "settingsModel.js");

function loadSettingsModelModule() {
    const source = fs.readFileSync(settingsModelModulePath, "utf8")
        .replaceAll("export const ", "const ")
        .replaceAll("export function ", "function ");
    const context = {
        globalThis: {},
        module: { exports: {} }
    };

    vm.runInNewContext(`${source}
module.exports = {
    DEFAULT_STEAMWORKS_CONCURRENCY,
    DEFAULT_STEAMCMD_CONCURRENCY,
    clampSettingsConcurrency,
    getDefaultSettingsModel,
    getWorkshopRuntimeHint,
    normalizeSettingsPathKey
};`, context, {
        filename: settingsModelModulePath
    });

    return context.module.exports;
}

test("settings defaults and concurrency clamps stay stable", () => {
    const {
        DEFAULT_STEAMWORKS_CONCURRENCY,
        DEFAULT_STEAMCMD_CONCURRENCY,
        clampSettingsConcurrency,
        getDefaultSettingsModel
    } = loadSettingsModelModule();

    const defaults = getDefaultSettingsModel();
    assert.equal(defaults.workshopDownloadRuntime, "Auto");
    assert.equal(defaults.steamworksMaxConcurrentDownloads, DEFAULT_STEAMWORKS_CONCURRENCY);
    assert.equal(defaults.steamCmdMaxConcurrentDownloads, DEFAULT_STEAMCMD_CONCURRENCY);
    assert.equal(defaults.warnBeforeRestartGame, true);
    assert.equal(defaults.themePalette, "Obsidian Ember");

    assert.equal(clampSettingsConcurrency("", 3), 3);
    assert.equal(clampSettingsConcurrency("0", 3), 1);
    assert.equal(clampSettingsConcurrency("4", 3), 4);
    assert.equal(clampSettingsConcurrency("12", 3), 5);
});

test("settings path normalization and runtime hints are deterministic", () => {
    const { getWorkshopRuntimeHint, normalizeSettingsPathKey } = loadSettingsModelModule();

    assert.equal(normalizeSettingsPathKey(" C:\\Games\\Stellaris\\ ", "Win32"), "c:/games/stellaris");
    assert.equal(normalizeSettingsPathKey("/Users/me/Stellaris///", "MacIntel"), "/Users/me/Stellaris");

    assert.match(
        getWorkshopRuntimeHint("SteamCMD", "steamcmd.exe", "C:/downloads"),
        /SteamCMD is configured/
    );
    assert.match(
        getWorkshopRuntimeHint("Auto", "", ""),
        /SteamCMD is configured as the fallback/
    );
});
