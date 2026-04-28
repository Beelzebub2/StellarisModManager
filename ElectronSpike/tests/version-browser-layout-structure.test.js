const test = require("node:test");
const assert = require("node:assert/strict");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

test("version browser keeps summary info inside existing bars without a standalone summary strip", () => {
    const html = readRendererShellSource();

    assert.match(html, /<div className="version-header-right">[\s\S]*id="resultCountChip"[\s\S]*id="pageCursorChip"/);
    assert.match(html, /<div className="controls-shell">[\s\S]*id="versionStatus"/);
    assert.doesNotMatch(html, /class(Name)?="version-summary-bar"/);
    assert.doesNotMatch(html, /id="versionSummaryText"/);
});
