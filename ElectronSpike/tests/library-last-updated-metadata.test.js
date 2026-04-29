const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const library = require("../dist/main/services/library.js");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

const sharedTypesPath = path.join(__dirname, "..", "src", "shared", "types.ts");
const libraryServicePath = path.join(__dirname, "..", "src", "main", "services", "library.ts");

test("Steam workshop update timestamps are normalized from published file details", () => {
    assert.equal(typeof library.normalizeSteamWorkshopUpdatedAtForTest, "function");
    assert.equal(
        library.normalizeSteamWorkshopUpdatedAtForTest("1714564800"),
        "2024-05-01T12:00:00.000Z"
    );
    assert.equal(library.normalizeSteamWorkshopUpdatedAtForTest(""), null);
    assert.equal(library.normalizeSteamWorkshopUpdatedAtForTest("not a number"), null);
});

test("library detail last updated uses cached Workshop metadata, not local app timestamps", () => {
    const renderer = readRendererRuntimeSource();
    const shell = readRendererShellSource();
    const sharedTypes = fs.readFileSync(sharedTypesPath, "utf8");
    const libraryService = fs.readFileSync(libraryServicePath, "utf8");

    assert.match(sharedTypes, /workshopUpdatedAtUtc:\s*string\s*\|\s*null/);
    assert.match(libraryService, /WorkshopUpdatedAt TEXT NULL/);
    assert.match(libraryService, /WorkshopUpdatedAt = COALESCE\(\?, WorkshopUpdatedAt\)/);
    assert.match(shell, /id="libraryDetailLastUpdated"/);
    assert.match(renderer, /formatHumanDateTime\(mod\.workshopUpdatedAtUtc,\s*"Unknown"\)/);
    assert.doesNotMatch(renderer, /formatUtc\(mod\.lastUpdatedAtUtc\s*\|\|\s*mod\.installedAtUtc\)/);
    assert.doesNotMatch(renderer, /libraryDetailInstalledAt/);
});
