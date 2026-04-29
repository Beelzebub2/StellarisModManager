const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

const typesPath = path.join(__dirname, "..", "src", "shared", "types.ts");

test("library shared profile controls expose ownership state and disable non-owner updates", () => {
    const html = readRendererShellSource();
    const renderer = readRendererRuntimeSource();
    const types = fs.readFileSync(typesPath, "utf8");

    assert.match(html, /id="librarySharedProfileOwnership"/);
    assert.match(html, /id="libraryUpdateSharedProfileLabel"/);
    assert.match(types, /sharedProfileCreator:\s*string\s*\|\s*null/);
    assert.match(types, /sharedProfileCanUpdate:\s*boolean/);
    assert.match(renderer, /const canUpdateSharedProfile = active\?\.sharedProfileCanUpdate === true/);
    assert.match(renderer, /updateButton\.disabled = !active \|\| \(Boolean\(currentSharedId\) && !canUpdateSharedProfile\)/);
    assert.match(renderer, /Only the profile creator can update this shared profile/);
});
