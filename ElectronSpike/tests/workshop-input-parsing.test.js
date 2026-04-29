const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const workshopInputModulePath = path.join(__dirname, "..", "src", "renderer", "runtime", "workshopInput.js");

function loadWorkshopInputModule() {
    const source = fs.readFileSync(workshopInputModulePath, "utf8")
        .replaceAll("export function ", "function ");
    const context = {
        URLSearchParams,
        module: { exports: {} }
    };

    vm.runInNewContext(`${source}
module.exports = { normalizeWorkshopId, isValidWorkshopId, parseSharedProfileSyncInput };`, context, {
        filename: workshopInputModulePath
    });

    return context.module.exports;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test("normalizes Steam Workshop IDs from IDs and URLs", () => {
    const { normalizeWorkshopId, isValidWorkshopId } = loadWorkshopInputModule();

    assert.equal(normalizeWorkshopId(" 123456789 "), "123456789");
    assert.equal(normalizeWorkshopId("https://steamcommunity.com/sharedfiles/filedetails/?id=281990&searchtext=ui"), "281990");
    assert.equal(normalizeWorkshopId("sharedfiles/filedetails/?foo=bar&id=987654321"), "987654321");
    assert.equal(normalizeWorkshopId("mod 123456789 from text"), "123456789");
    assert.equal(normalizeWorkshopId("not a workshop id"), "");

    assert.equal(isValidWorkshopId("123456"), true);
    assert.equal(isValidWorkshopId("12345"), false);
    assert.equal(isValidWorkshopId("abc123456"), false);
});

test("parses shared profile sync inputs from URL params and comma values", () => {
    const { parseSharedProfileSyncInput } = loadWorkshopInputModule();

    assert.deepEqual(plain(parseSharedProfileSyncInput("")), {
        sharedProfileId: "",
        sharedProfileSince: ""
    });
    assert.deepEqual(plain(parseSharedProfileSyncInput("https://example.invalid/sync?id=alpha&since=2026-04-28")), {
        sharedProfileId: "alpha",
        sharedProfileSince: "2026-04-28"
    });
    assert.deepEqual(plain(parseSharedProfileSyncInput("profileId=beta&since=checkpoint")), {
        sharedProfileId: "beta",
        sharedProfileSince: "checkpoint"
    });
    assert.deepEqual(plain(parseSharedProfileSyncInput("gamma, first, second")), {
        sharedProfileId: "gamma",
        sharedProfileSince: "first,second"
    });
    assert.deepEqual(plain(parseSharedProfileSyncInput("delta")), {
        sharedProfileId: "delta",
        sharedProfileSince: ""
    });
});
