const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtmlPath = path.join(__dirname, "..", "src", "renderer", "index.html");

test("version browser keeps summary info inside existing bars without a standalone summary strip", () => {
    const html = fs.readFileSync(indexHtmlPath, "utf8");

    assert.match(html, /<div class="version-header-right">[\s\S]*id="resultCountChip"[\s\S]*id="pageCursorChip"/);
    assert.match(html, /<div class="controls-shell">[\s\S]*id="versionStatus"/);
    assert.doesNotMatch(html, /class="version-summary-bar"/);
    assert.doesNotMatch(html, /id="versionSummaryText"/);
});
