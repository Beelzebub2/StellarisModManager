const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");

test("library detail pane no longer renders a description block", () => {
    const html = readRendererShellSource();

    assert.doesNotMatch(html, /id="libraryDetailDescription"/);
});

test("renderer no longer writes a library detail description field", () => {
    const source = fs.readFileSync(rendererJsPath, "utf8");

    assert.doesNotMatch(source, /libraryDetailDescription/);
});
