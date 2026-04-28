const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

const root = path.join(__dirname, "..");
const rendererPath = path.join(root, "src", "renderer", "renderer.js");
const preloadPath = path.join(root, "src", "preload.ts");
const ipcPath = path.join(root, "src", "main", "ipc.ts");
const typesPath = path.join(root, "src", "shared", "types.ts");

test("library exposes shared load-order suggestions behind an explicit preview/apply flow", () => {
    const html = readRendererShellSource();
    const renderer = fs.readFileSync(rendererPath, "utf8");
    const preload = fs.readFileSync(preloadPath, "utf8");
    const ipc = fs.readFileSync(ipcPath, "utf8");
    const types = fs.readFileSync(typesPath, "utf8");

    assert.match(html, /id="librarySuggestLoadOrder"/);
    assert.doesNotMatch(html, /library-intelligence-card/);
    assert.doesNotMatch(html, /librarySuggestLoadOrderCard/);
    assert.match(renderer, /runSharedLoadOrderSuggestion/);
    assert.match(renderer, /showLoadOrderPreviewModal/);
    assert.match(renderer, /load-order-preview-empty/);
    assert.match(renderer, /shared-sync-preview-card/);
    assert.match(renderer, /window\.spikeApi\.getLibraryLoadOrderSuggestion/);
    assert.match(renderer, /window\.spikeApi\.applyLibraryLoadOrderSuggestion/);
    assert.match(preload, /getLibraryLoadOrderSuggestion/);
    assert.match(preload, /applyLibraryLoadOrderSuggestion/);
    assert.match(preload, /previewLibraryProfileActivation/);
    assert.match(ipc, /libraryLoadOrderSuggestion/);
    assert.match(ipc, /libraryApplyLoadOrderSuggestion/);
    assert.match(ipc, /libraryPreviewProfileActivation/);
    assert.match(types, /interface LibraryLoadOrderPreviewResult/);
    assert.match(types, /interface LibraryApplyLoadOrderRequest/);
    assert.match(types, /interface LibraryProfileActivationPreviewResult/);
});

test("manual and shared-profile load-order changes require a visible confirmation preview", () => {
    const renderer = fs.readFileSync(rendererPath, "utf8");
    const preload = fs.readFileSync(preloadPath, "utf8");

    assert.match(renderer, /confirmManualLoadOrderChange/);
    assert.match(renderer, /confirmEnableStateChange/);
    assert.match(renderer, /confirmRemoveLibraryMod/);
    assert.match(renderer, /activateLibraryProfileWithPreview/);
    assert.match(renderer, /showSharedProfileSyncPreview/);
    assert.match(renderer, /previewLibrarySharedProfileSync/);
    assert.match(renderer, /previewLibraryProfileActivation/);
    assert.match(renderer, /confirmManualLoadOrderChange[\s\S]*window\.spikeApi\.moveLibraryMod/);
    assert.match(renderer, /confirmManualLoadOrderChange[\s\S]*window\.spikeApi\.reorderLibraryMod/);
    assert.match(renderer, /confirmRemoveLibraryMod[\s\S]*window\.spikeApi\.uninstallLibraryMod/);
    assert.match(preload, /previewLibrarySharedProfileSync/);
    assert.match(preload, /previewLibraryProfileActivation/);
});
