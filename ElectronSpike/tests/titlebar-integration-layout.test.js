const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("topbar reserves and visually docks the native titlebar overlay area", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.window-shell\s*\{[\s\S]*padding:\s*0 12px 12px;/);
    assert.match(css, /\.topbar\s*\{[\s\S]*env\(titlebar-area-width,\s*calc\(var\(--app-vw\)\s*-\s*138px\)\)/);
    assert.match(css, /\.topbar\s*\{[\s\S]*env\(titlebar-area-height,\s*54px\)/);
    assert.match(css, /\.topbar\s*\{[\s\S]*background:\s*var\(--titlebar-surface\)/);
    assert.match(css, /\.topbar\s*\{[\s\S]*border-bottom:\s*1px solid var\(--border\)/);
});

test("topbar branding and workspace content can shrink without wrapping or clipping the app shell", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.workspace\s*\{[^}]*min-width:\s*0;/);
    assert.match(css, /\.content\s*\{[^}]*min-width:\s*0;/);
    assert.match(css, /\.page-section\s*\{[^}]*min-width:\s*0;/);
    assert.match(css, /\.topbar-left\s*\{[^}]*flex:\s*1 1 auto;/);
    assert.match(css, /\.topbar-left\s*\{[^}]*min-width:\s*0;/);
    assert.match(css, /\.brand-block\s*\{[^}]*min-width:\s*0;/);
    assert.match(css, /\.brand-title\s*\{[^}]*white-space:\s*nowrap;/);
    assert.match(css, /\.brand-title\s*\{[^}]*overflow:\s*hidden;/);
    assert.match(css, /\.brand-title\s*\{[^}]*text-overflow:\s*ellipsis;/);
});

test("topbar reserves only the window controls strip so the brand title keeps visible space", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.topbar\s*\{[^}]*--titlebar-overlay-width:\s*env\(titlebar-area-width,\s*calc\(var\(--app-vw\)\s*-\s*138px\)\);/);
    assert.match(css, /\.topbar\s*\{[^}]*--titlebar-controls-width:\s*max\(138px,\s*calc\(var\(--app-vw\)\s*-\s*var\(--titlebar-overlay-width\)\)\);/);
    assert.match(css, /\.topbar\s*\{[^}]*padding:\s*0 20px;/);
    assert.match(css, /\.topbar\s*\{[^}]*padding-right:\s*calc\(var\(--titlebar-controls-width\)\s*\+\s*20px\);/);
});
