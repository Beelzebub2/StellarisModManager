const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const stylesCssPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("library list renders user-facing one-based load-order positions", () => {
    const renderer = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(renderer, /function formatLoadOrderPosition\(index\)/);
    assert.match(renderer, /formatLoadOrderPosition\(mod\.loadOrder\)/);
    assert.doesNotMatch(renderer, /<span class="badge">\$\{mod\.loadOrder\}<\/span>/);
});

test("library drag handling supports wheel scrolling while a drag session is active", () => {
    const renderer = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(renderer, /addEventListener\("wheel"/);
    assert.match(renderer, /state\.library\.dragSourceModId/);
    assert.match(renderer, /list\.scrollTop\s*\+=/);
});

test("renderer exposes a dismissible failed-download notice that opens the Downloads page", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const renderer = fs.readFileSync(rendererJsPath, "utf8");
    const styles = fs.readFileSync(stylesCssPath, "utf8");

    assert.match(html, /id="downloadFailureNotice"/);
    assert.match(html, /id="downloadFailureNoticeOpen"/);
    assert.match(renderer, /function renderDownloadFailureNotice/);
    assert.match(renderer, /dismissDownloadFailureNotice/);
    assert.match(renderer, /activateTabGuarded\("downloads"\)/);
    assert.match(renderer, /failed.*updatedAtUtc/i);
    assert.match(styles, /\.download-failure-notice/);
});
