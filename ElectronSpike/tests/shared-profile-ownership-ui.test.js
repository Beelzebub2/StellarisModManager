const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const typesPath = path.join(__dirname, "..", "src", "shared", "types.ts");

test("library shared profile controls expose ownership state and disable non-owner updates", () => {
    const html = fs.readFileSync(htmlPath, "utf8");
    const renderer = fs.readFileSync(rendererPath, "utf8");
    const types = fs.readFileSync(typesPath, "utf8");

    assert.match(html, /id="librarySharedProfileOwnership"/);
    assert.match(html, /id="libraryUpdateSharedProfileLabel"/);
    assert.match(types, /sharedProfileCreator:\s*string\s*\|\s*null/);
    assert.match(types, /sharedProfileCanUpdate:\s*boolean/);
    assert.match(renderer, /const canUpdateSharedProfile = active\?\.sharedProfileCanUpdate === true/);
    assert.match(renderer, /updateButton\.disabled = !active \|\| \(Boolean\(currentSharedId\) && !canUpdateSharedProfile\)/);
    assert.match(renderer, /Only the profile creator can update this shared profile/);
});
