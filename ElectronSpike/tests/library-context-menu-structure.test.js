const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const preloadTsPath = path.join(__dirname, "..", "src", "preload.ts");
const ipcTsPath = path.join(__dirname, "..", "src", "main", "ipc.ts");
const sharedTypesPath = path.join(__dirname, "..", "src", "shared", "types.ts");

test("library context menu plumbing exists and duplicated detail actions are removed", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const rendererJs = fs.readFileSync(rendererJsPath, "utf8");
    const preloadTs = fs.readFileSync(preloadTsPath, "utf8");
    const ipcTs = fs.readFileSync(ipcTsPath, "utf8");
    const sharedTypes = fs.readFileSync(sharedTypesPath, "utf8");

    assert.doesNotMatch(html, /id="libraryActionUpdate"/);
    assert.doesNotMatch(html, /id="libraryActionWorkshop"/);
    assert.doesNotMatch(html, /id="libraryActionLocation"/);
    assert.doesNotMatch(html, /id="libraryActionRemove"/);

    assert.match(rendererJs, /addEventListener\("contextmenu"/);
    assert.match(rendererJs, /showLibraryModContextMenu/);
    assert.match(rendererJs, /onLibraryModContextMenuCommand/);

    assert.match(sharedTypes, /export interface ShowLibraryModContextMenuRequest/);
    assert.match(sharedTypes, /showLibraryModContextMenu:\s*\(request: ShowLibraryModContextMenuRequest\)/);
    assert.match(sharedTypes, /onLibraryModContextMenuCommand:\s*\(handler:/);

    assert.match(preloadTs, /showLibraryModContextMenu:\s*\(request: ShowLibraryModContextMenuRequest\)/);
    assert.match(preloadTs, /onLibraryModContextMenuCommand:/);

    assert.match(ipcTs, /showLibraryModContextMenu:/);
    assert.match(ipcTs, /onLibraryModContextMenuCommand/);
});
