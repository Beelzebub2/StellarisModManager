const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");

test("settings expose an explicit browse button for the mods path", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");

    assert.match(html, /id="settingsModsPathBrowse"/);
});

test("settings expose a separate managed mods folder input", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(html, /id="settingsManagedModsPathInput"/);
    assert.match(html, /Managed mods folder/i);
    assert.match(source, /managedModsPath/);
    assert.match(source, /settingsManagedModsPathInput/);
});

test("renderer defines a three-way modal for mods-path migration", () => {
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(source, /function showChoiceModal/);
    assert.match(source, /Change managed mods folder/i);
    assert.match(source, /migrateModsPath/);
});

test("renderer exposes a backgroundable progress popup and launch lock for mods-path migration", () => {
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(source, /modsPathMigration:\s*\{/);
    assert.match(source, /Run in background/i);
    assert.match(source, /function syncLaunchGameAvailability/);
    assert.match(source, /Moving managed mods/i);
    assert.match(source, /state\.modsPathMigration\.active/);
});

test("renderer shows the current mod and percent complete during mods-path migration", () => {
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(source, /currentModName/);
    assert.match(source, /progressPercent/);
    assert.match(source, /Currently moving/i);
    assert.match(source, /function renderModsPathMigrationProgress/);
});

test("settings render a top-right mods-path migration notice that reopens the popup", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(html, /id="modsPathMigrationNotice"/);
    assert.match(source, /function renderModsPathMigrationBackgroundNotice/);
    assert.match(source, /Open progress/i);
});
