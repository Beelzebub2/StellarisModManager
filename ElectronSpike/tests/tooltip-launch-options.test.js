const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stellaris-tooltip-launch-options-"));
process.env.APPDATA = appDataRoot;

const settings = require("../dist/main/services/settings.js");
const gameLauncher = require("../dist/main/services/gameLauncher.js");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const stylesCssPath = path.join(__dirname, "..", "src", "renderer", "styles.css");
const sharedTypesPath = path.join(__dirname, "..", "src", "shared", "types.ts");

test("settings persist free-form launch options", () => {
    assert.equal(typeof settings.saveSettingsSnapshot, "function");
    assert.equal(typeof settings.loadSettingsSnapshot, "function");

    const saved = settings.saveSettingsSnapshot({
        launchOptions: '--safe-mode "--profile name"',
        autoDetectGame: true,
        warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember",
        autoCheckAppUpdates: true,
        hideDisabledMods: false
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.settings.launchOptions, '--safe-mode "--profile name"');

    const loaded = settings.loadSettingsSnapshot();
    assert.equal(loaded?.launchOptions, '--safe-mode "--profile name"');
});

test("launcher parses quoted launch options into argv", () => {
    assert.equal(typeof gameLauncher.parseLaunchOptionsForTest, "function");

    assert.deepEqual(
        gameLauncher.parseLaunchOptionsForTest('--safe-mode "--profile name" --debug=yes'),
        ["--safe-mode", "--profile name", "--debug=yes"]
    );
});

test("renderer exposes a shared custom tooltip host and upgrades title attributes", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const renderer = fs.readFileSync(rendererJsPath, "utf8");
    const styles = fs.readFileSync(stylesCssPath, "utf8");

    assert.match(html, /id="appTooltip"/);
    assert.match(renderer, /querySelectorAll\("\[title\]"\)/);
    assert.match(renderer, /dataset\.tooltip\s*=\s*title/);
    assert.doesNotMatch(renderer, /if\s*\(![^)]*\.dataset\.tooltip\)\s*{\s*[^}]*\.dataset\.tooltip\s*=\s*title/);
    assert.match(renderer, /removeAttribute\("title"\)/);
    assert.match(renderer, /MutationObserver/);
    assert.match(renderer, /setTimeout\(/);
    assert.match(styles, /\.app-tooltip/);
    assert.match(styles, /\.app-tooltip\.is-visible/);
});

test("settings page exposes launch options and renderer binds the field", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const renderer = fs.readFileSync(rendererJsPath, "utf8");
    const types = fs.readFileSync(sharedTypesPath, "utf8");

    assert.match(html, /id="settingsLaunchOptionsInput"/);
    assert.match(renderer, /getInputValue\("settingsLaunchOptionsInput"\)/);
    assert.match(renderer, /setInputValue\("settingsLaunchOptionsInput",\s*m\.launchOptions\)/);
    assert.match(types, /launchOptions\?: string;/);
});
