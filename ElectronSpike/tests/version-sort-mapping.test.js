const test = require("node:test");
const assert = require("node:assert/strict");

const workshopBrowser = require("../dist/main/services/workshopBrowser.js");
const versionBrowser = require("../dist/main/services/versionBrowser.js");

test("maps version sort modes to the expected workshop and Steam browse sort values", () => {
    assert.equal(typeof versionBrowser.toWorkshopSortModeForTest, "function");
    assert.equal(typeof workshopBrowser.toSteamBrowseSortForTest, "function");

    assert.equal(versionBrowser.toWorkshopSortModeForTest("most-subscribed"), "most-subscribed");
    assert.equal(versionBrowser.toWorkshopSortModeForTest("most-popular"), "most-popular");
    assert.equal(workshopBrowser.toSteamBrowseSortForTest("most-subscribed"), "totaluniquesubscribers");
    assert.equal(workshopBrowser.toSteamBrowseSortForTest("most-popular"), "playtime_trend");
    assert.notEqual(workshopBrowser.toSteamBrowseSortForTest("most-popular"), "trend");
});
