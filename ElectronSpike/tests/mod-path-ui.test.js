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

test("renderer defines a three-way modal for mods-path migration", () => {
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(source, /function showChoiceModal/);
    assert.match(source, /Change mod folder/i);
    assert.match(source, /migrateModsPath/);
});
