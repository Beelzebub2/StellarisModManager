const test = require("node:test");
const assert = require("node:assert/strict");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

test("unsaved settings prompt offers save, discard, and cancel choices", () => {
    const source = readRendererRuntimeSource();

    assert.match(source, /function resolveUnsavedSettingsBeforeLeave/);
    assert.match(source, /showChoiceModal\(\s*"Unsaved settings changes"/);
    assert.match(source, /confirmLabel:\s*"Save changes"/);
    assert.match(source, /alternateLabel:\s*"Discard changes"/);
    assert.match(source, /cancelLabel:\s*"Cancel"/);
    assert.match(source, /choice === "cancel"/);
});

test("closing the app with unsaved settings opens the same guarded prompt", () => {
    const source = readRendererRuntimeSource();

    assert.match(source, /windowClosePromptActive:\s*false/);
    assert.match(source, /windowCloseAllowed:\s*false/);
    assert.match(source, /function handleWindowCloseWithUnsavedSettings/);
    assert.match(source, /resolveUnsavedSettingsBeforeLeave\(\{\s*reason:\s*"exit"/);
    assert.match(source, /void handleWindowCloseWithUnsavedSettings\(\)/);
    assert.match(source, /window\.close\(\)/);
});

test("settings controller exposes public username prompt to renderer callers", () => {
    const source = readRendererRuntimeSource();

    assert.match(source, /async function ensurePublicUsernameConfigured/);
    assert.match(source, /ensurePublicUsernameConfigured,/);
    assert.match(source, /await ensurePublicUsernameConfigured\(\)/);
    assert.match(source, /ensurePublicUsernameConfigured\(true\)/);
});
