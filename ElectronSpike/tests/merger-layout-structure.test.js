const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");
const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");

test("sidebar order includes the merger workspace between Library and Workshop", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");

    const versionIndex = html.indexOf('id="tabVersion"');
    const downloadsIndex = html.indexOf('id="tabDownloads"');
    const libraryIndex = html.indexOf('id="tabLibrary"');
    const mergerIndex = html.indexOf('id="tabMerger"');
    const workshopIndex = html.indexOf('id="tabWorkshop"');

    assert.notEqual(versionIndex, -1);
    assert.notEqual(downloadsIndex, -1);
    assert.notEqual(libraryIndex, -1);
    assert.notEqual(mergerIndex, -1);
    assert.notEqual(workshopIndex, -1);
    assert(versionIndex < downloadsIndex, "expected By Version before Downloads");
    assert(downloadsIndex < libraryIndex, "expected Downloads before Library");
    assert(libraryIndex < mergerIndex, "expected Library before Merger");
    assert(mergerIndex < workshopIndex, "expected Merger before Workshop");
});

test("merger page exposes the first milestone controls and status regions", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");

    assert.match(html, /id="pageMerger"/);
    assert.match(html, /id="mergerAnalyzeBtn"/);
    assert.match(html, />\s*Scan\s*</);
    assert.match(html, /id="mergerOpenResultsBtn"/);
    assert.match(html, /id="mergerAutoBtn"/);
    assert.match(html, /id="mergerBuildBtn"/);
    assert.match(html, /id="mergerOpenOutputBtn"/);
    assert.match(html, /id="mergerExportReportBtn"/);
    assert.match(html, /id="mergerMetricSafeAuto"/);
    assert.match(html, /id="mergerMetricNeedsReview"/);
    assert.match(html, /id="mergerMetricGenerated"/);
    assert.match(html, /id="mergerConflictTree"/);
    assert.match(html, /id="mergerDetailPanel"/);
});

test("renderer tab wiring includes the merger workspace and status mapping", () => {
    const js = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(js, /selectedTab:\s*"version"/);
    assert.match(js, /merger:\s*"tabMerger"/);
    assert.match(js, /merger:\s*"pageMerger"/);
    assert.match(js, /merger:\s*"Merger ready\."/);
    assert.match(js, /activateTabGuarded\("merger"\)/);
});
