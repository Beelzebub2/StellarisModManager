const test = require("node:test");
const assert = require("node:assert/strict");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

test("shared profile actions expose update and sync controls, with copy remaining copy-only", () => {
    const html = readRendererShellSource();
    const renderer = readRendererRuntimeSource();

    assert.match(html, /<button id="libraryUpdateSharedProfile"[\s\S]*?>[\s\S]*?Update/i);
    assert.match(html, /<button id="librarySyncSharedProfile"[\s\S]*?>[\s\S]*?Sync/i);
    assert.ok(
        html.indexOf('id="libraryUpdateSharedProfile"') < html.indexOf('id="librarySyncSharedProfile"'),
        "update action should appear before sync in the shared ID menu"
    );

    assert.match(renderer, /libraryUpdateSharedProfile/);
    assert.match(renderer, /libraryUpdateSharedProfile[\s\S]*publishLibrarySharedProfile\(/);
    assert.match(renderer, /librarySyncSharedProfile/);
    assert.match(renderer, /syncButton\.disabled\s*=\s*!currentSharedId/);
    assert.match(renderer, /shareButton\.disabled\s*=\s*!currentSharedId/);
    assert.match(renderer, /runSharedProfileSync\(/);
    assert.match(renderer, /libraryUseSharedId[\s\S]*runSharedProfileSync\(/);
    assert.match(renderer, /librarySyncSharedProfile[\s\S]*runSharedProfileSync\(/);
    assert.match(renderer, /libraryShareProfile[\s\S]*copyText\(sharedProfileId\)/);
});
