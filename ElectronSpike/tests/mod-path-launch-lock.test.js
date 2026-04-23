const test = require("node:test");
const assert = require("node:assert/strict");

const migrationState = require("../dist/main/services/modsPathMigrationState.js");
const gameLauncher = require("../dist/main/services/gameLauncher.js");

test("launchGame rejects while a mods-path migration is active", () => {
    assert.equal(typeof migrationState.startModsPathMigration, "function");
    assert.equal(typeof migrationState.resetModsPathMigrationStateForTest, "function");

    migrationState.resetModsPathMigrationStateForTest();
    const started = migrationState.startModsPathMigration({
        sourceModsPath: "C:/Mods/Current",
        targetModsPath: "D:/Mods/New",
        moveExistingMods: true,
        startedAtUtc: new Date().toISOString()
    });

    assert.equal(started, true);

    try {
        const result = gameLauncher.launchGame();
        assert.equal(result.ok, false);
        assert.equal(result.wasRunning, false);
        assert.match(result.message, /mods folder move is still running/i);
    } finally {
        migrationState.resetModsPathMigrationStateForTest();
    }
});
