const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");
const resultsWindowPath = path.join(__dirname, "..", "src", "main", "services", "modMerger", "resultsWindow.ts");
const preloadPath = path.join(__dirname, "..", "src", "preload.ts");
const ipcPath = path.join(__dirname, "..", "src", "main", "ipc.ts");
const typesPath = path.join(__dirname, "..", "src", "shared", "types.ts");

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
    const js = readRendererRuntimeSource();

    assert.match(js, /getWindowView\(\)/);
    assert.match(js, /view"\)\s*\|\|\s*"main"/);
    assert.match(js, /windowView === "merger-results"/);
    assert.match(js, /async function refreshTopbarShell\(\)[\s\S]*getAppVersion\(\)[\s\S]*applyAppIcon\(\)[\s\S]*refreshStellarisyncStatus\(\)/);
    assert.match(js, /windowView === "merger-results"[\s\S]*refreshTopbarShell\(\)/);
    assert.match(js, /refreshMergerPlan\(\)/);
    assert.match(js, /renderMergerResultsWorkspace\(\)/);
    assert.match(js, /modMergerAnalyze\(\{\s*openResults:\s*true\s*\}\)/);
    assert.match(js, /modMergerApplyAuto\(\{\s*scope:\s*"safe"\s*\}\)/);
    assert.match(js, /modMergerOpenResults\(\)/);
    assert.match(js, /resultsFilter:\s*"needs-action"/);
    assert.match(js, /case "needs-action"/);
    assert.match(js, /class="merger-results-row-reason"/);
});

test("merger results window loads the built Vite renderer before source files", () => {
    const source = fs.readFileSync(resultsWindowPath, "utf8");
    const distIndex = source.indexOf('"dist", "renderer", "index.html"');
    const sourceIndex = source.indexOf('"src", "renderer", "index.html"');

    assert.ok(distIndex >= 0, "dist renderer candidate should exist");
    assert.ok(sourceIndex >= 0, "source renderer fallback should exist");
    assert.ok(distIndex < sourceIndex, "dist renderer must be preferred so file:// windows do not load main.tsx directly");
    assert.match(source, /resultsWindow\.webContents\.on\("console-message"/);
});

test("merger results exposes simple review and advanced code-level inspection modes", () => {
    const html = readRendererShellSource();
    const js = readRendererRuntimeSource();
    const css = fs.readFileSync(stylesPath, "utf8");
    const preload = fs.readFileSync(preloadPath, "utf8");
    const ipc = fs.readFileSync(ipcPath, "utf8");
    const types = fs.readFileSync(typesPath, "utf8");

    assert.match(html, /data-merger-results-mode="review"/);
    assert.match(html, /data-merger-results-mode="advanced"/);
    assert.match(html, /id="mergerResultsMetricNeedsAction"/);
    assert.match(html, /id="mergerResultsMetricHandled"/);

    assert.match(js, /resultsMode:\s*"review"/);
    assert.match(js, /function renderMergerResultsAdvancedPanel/);
    assert.match(js, /merger-advanced-code-panel/);
    assert.match(js, /modMergerReadFilePreview/);
    assert.match(js, /data-merger-preview-mod-id/);

    assert.match(preload, /modMergerReadFilePreview/);
    assert.match(ipc, /modMergerReadFilePreview/);
    assert.match(types, /interface ModMergerReadFilePreviewRequest/);
    assert.match(types, /interface ModMergerReadFilePreviewResult/);

    assert.match(css, /\.merger-results-mode-toggle/);
    assert.match(css, /\.merger-advanced-code-panel/);
    assert.match(css, /\.merger-code-viewer/);
});

test("merger results advanced mode renders generated output as a color coded diff", () => {
    const js = readRendererRuntimeSource();
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(js, /renderMergerDiffViewer/);
    assert.match(js, /function getDefaultMergerPreviewModId/);
    assert.match(js, /firstNonWinner/);
    assert.match(js, /merger-diff-legend/);
    assert.match(js, /merger-diff-line merger-diff-line-add/);
    assert.match(js, /merger-diff-line merger-diff-line-remove/);
    assert.match(js, /merger-diff-line merger-diff-line-context/);
    assert.match(css, /\.merger-diff-viewer/);
    assert.match(css, /\.merger-diff-legend/);
    assert.match(css, /\.merger-diff-line-add/);
    assert.match(css, /\.merger-diff-line-remove/);
});

test("results window keeps the app topbar while isolating the merger workspace", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /body\[data-window-view="merger-results"\]/);
    assert.doesNotMatch(css, /body\[data-window-view="merger-results"\]\s+\.topbar[\s\S]*display:\s*none\s*!important/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+\.workspace/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+#mergerResultsWorkspace/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+\.window-shell\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
    assert.match(css, /\.merger-results-drag-region[\s\S]*-webkit-app-region:\s*drag/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+button[\s\S]*-webkit-app-region:\s*no-drag/);
    assert.match(css, /\.merger-results-layout/);
    assert.match(css, /\.merger-results-row[\s\S]*grid-template-columns/);
    assert.match(css, /\.merger-results-row-reason/);
});

test("results window panels constrain long paths and code without overflowing the page", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.merger-results-workspace\s*\{[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.merger-results-detail\s*\{[\s\S]*overflow:\s*auto/);
    assert.match(css, /\.merger-results-list-shell,\s*[\r\n]+\.merger-results-detail\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.merger-advanced-grid\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /\.merger-advanced-grid\s*>\s*section\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /body\[data-window-view="merger-results"\]\s+#mergerResultsWorkspace\s*\{[\s\S]*overflow:\s*auto/);
    assert.match(css, /\.merger-detail-card\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /\.merger-detail-header\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /\.merger-detail-header h3,[\s\S]*\{[\s\S]*overflow-wrap:\s*anywhere/);
    assert.match(css, /\.merger-source-row\s*\{[\s\S]*min-width:\s*0/);
    assert.match(css, /\.merger-code-viewer[\s\S]*max-width:\s*100%/);
    assert.match(css, /\.merger-source-main[\s\S]*overflow-wrap:\s*anywhere/);
});
