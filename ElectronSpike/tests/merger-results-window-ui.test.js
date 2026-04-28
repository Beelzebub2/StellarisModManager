const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("merger results window shell exposes filters, list, detail, and actions", () => {
    const html = readRendererShellSource();

    assert.match(html, /id="mergerResultsDragRegion"/);
    assert.match(html, /id="mergerResultsWorkspace"/);
    assert.match(html, /id="mergerResultsScanBtn"/);
    assert.match(html, /id="mergerResultsAutoBtn"/);
    assert.match(html, /id="mergerResultsBuildBtn"/);
    assert.match(html, /data-merger-results-filter="needs-action"/);
    assert.match(html, /data-merger-results-filter="safe"/);
    assert.match(html, /data-merger-results-filter="manual"/);
    assert.match(html, /data-merger-results-filter="resolved"/);
    assert.match(html, />\s*Needs action\s*</);
    assert.match(html, />\s*Auto ready\s*</);
    assert.match(html, />\s*Needs choice\s*</);
    assert.match(html, />\s*Handled\s*</);
    assert.match(html, /id="mergerResultsList"/);
    assert.match(html, /id="mergerResultsDetail"/);
});

test("renderer has a dedicated merger results window initialization path", () => {
    const js = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(js, /getWindowView\(\)/);
    assert.match(js, /view"\)\s*\|\|\s*"main"/);
    assert.match(js, /windowView === "merger-results"/);
    assert.match(js, /refreshMergerPlan\(\)/);
    assert.match(js, /renderMergerResultsWorkspace\(\)/);
    assert.match(js, /modMergerAnalyze\(\{\s*openResults:\s*true\s*\}\)/);
    assert.match(js, /modMergerApplyAuto\(\{\s*scope:\s*"safe"\s*\}\)/);
    assert.match(js, /modMergerOpenResults\(\)/);
    assert.match(js, /resultsFilter:\s*"needs-action"/);
    assert.match(js, /case "needs-action"/);
    assert.match(js, /class="merger-results-row-reason"/);
});

test("results window css hides the main app chrome and expands the workspace", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /body\[data-window-view="merger-results"\]/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+\.topbar/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+\.workspace/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+#mergerResultsWorkspace/);
    assert.match(css, /\.merger-results-drag-region[\s\S]*-webkit-app-region:\s*drag/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+button[\s\S]*-webkit-app-region:\s*no-drag/);
    assert.match(css, /\.merger-results-layout/);
    assert.match(css, /\.merger-results-row[\s\S]*grid-template-columns/);
    assert.match(css, /\.merger-results-row-reason/);
});
