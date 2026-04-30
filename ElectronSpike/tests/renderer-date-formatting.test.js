const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const domModulePath = path.join(__dirname, "..", "src", "renderer", "runtime", "dom.js");

function loadDomModule() {
    const source = fs.readFileSync(domModulePath, "utf8")
        .replaceAll("export function ", "function ");
    const context = {
        module: { exports: {} }
    };

    vm.runInNewContext(`${source}
module.exports = {
    formatHumanDateTime,
    formatUtc
};`, context, {
        filename: domModulePath
    });

    return context.module.exports;
}

function assertHumanReadableTimestamp(value) {
    assert.notEqual(value, "2026-04-30T15:38:29.675Z");
    assert.doesNotMatch(value, /^2026-04-30[ T]15:38:29\.675Z?$/);
    assert.doesNotMatch(value, /T15:38:29\.675Z/);
    assert.doesNotMatch(value, /\.675Z/);
}

test("renderer date helpers do not expose raw ISO timestamps", () => {
    const { formatHumanDateTime, formatUtc } = loadDomModule();
    const timestamp = "2026-04-30T15:38:29.675Z";

    assertHumanReadableTimestamp(formatUtc(timestamp));
    assertHumanReadableTimestamp(formatHumanDateTime(timestamp));
});

test("renderer date helpers preserve existing fallbacks for missing values", () => {
    const { formatHumanDateTime, formatUtc } = loadDomModule();

    assert.equal(formatUtc(""), "Never");
    assert.equal(formatHumanDateTime("", "Unknown"), "Unknown");
    assert.equal(formatHumanDateTime(null, "Unknown"), "Unknown");
});
