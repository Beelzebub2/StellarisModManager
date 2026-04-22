const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");

test("shared profile actions expose a direct sync button and disable it without a saved ID", () => {
    const html = fs.readFileSync(htmlPath, "utf8");
    const renderer = fs.readFileSync(rendererPath, "utf8");

    assert.match(html, /<button id="librarySyncSharedProfile"[\s\S]*?>[\s\S]*?Sync/i);
    assert.match(renderer, /librarySyncSharedProfile/);
    assert.match(renderer, /syncButton\.disabled\s*=\s*!currentSharedId/);
    assert.match(renderer, /runSharedProfileSync\(/);
    assert.match(renderer, /libraryUseSharedId[\s\S]*runSharedProfileSync\(/);
    assert.match(renderer, /librarySyncSharedProfile[\s\S]*runSharedProfileSync\(/);
});
