const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("merger page lets conflict lists grow downward up to a max height before scrolling", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");
    const js = fs.readFileSync(rendererJsPath, "utf8");
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(html, /id="pageMerger" class="page-section page-section-merger hidden"/);
    assert.match(js, /document\.body\.dataset\.activeTab\s*=\s*name;/);
    assert.match(css, /body\[data-active-tab="merger"\]\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(css, /body\[data-active-tab="merger"\]\s+\.page-section\.hidden\s*\{[\s\S]*display:\s*none !important;/);
    assert.match(css, /\.page-section-merger\s*\{[\s\S]*overflow:\s*auto;[\s\S]*grid-template-rows:\s*auto auto auto auto;/);
    assert.match(css, /\.merger-main\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.75fr\)\s+minmax\(320px,\s*0\.95fr\);/);
    assert.match(css, /\.merger-main\s*\{[\s\S]*align-items:\s*start;/);
    assert.match(css, /\.merger-conflict-tree\s*\{[\s\S]*max-height:\s*min\([^)]+\);[\s\S]*overflow:\s*auto;/);
    assert.match(css, /\.merger-source-list\s*\{[\s\S]*max-height:\s*min\([^)]+\);[\s\S]*overflow:\s*auto;/);
});
