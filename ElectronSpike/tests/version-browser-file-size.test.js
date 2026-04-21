const test = require("node:test");
const assert = require("node:assert/strict");

const versionBrowser = require("../dist/main/services/versionBrowser.js");

test("extracts and formats workshop file sizes for version browser cards", () => {
    assert.equal(typeof versionBrowser.normalizePublishedFileSizeForTest, "function");
    assert.equal(typeof versionBrowser.formatFileSizeForTest, "function");

    assert.equal(versionBrowser.normalizePublishedFileSizeForTest("13214798218"), 13214798218);
    assert.equal(versionBrowser.normalizePublishedFileSizeForTest("0"), null);
    assert.equal(versionBrowser.normalizePublishedFileSizeForTest(undefined), null);

    assert.equal(versionBrowser.formatFileSizeForTest(768), "768 B");
    assert.equal(versionBrowser.formatFileSizeForTest(1536), "1.5 KB");
    assert.equal(versionBrowser.formatFileSizeForTest(13214798218), "12.3 GB");
    assert.equal(versionBrowser.formatFileSizeForTest(null), null);
});
