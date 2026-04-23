const test = require("node:test");
const assert = require("node:assert/strict");

const migrationState = require("../dist/main/services/modsPathMigrationState.js");

test("mods-path migration status tracks current mod name and percent complete", () => {
    assert.equal(typeof migrationState.updateModsPathMigrationProgress, "function");
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
        migrationState.updateModsPathMigrationProgress({
            currentModName: "Amazing Space Mod",
            currentPhase: "Moving files",
            processedModCount: 3,
            totalModCount: 10,
            progressPercent: 30,
            lastMessage: "Moving managed mods to the new folder."
        });

        const status = migrationState.getModsPathMigrationStatus();
        assert.equal(status.currentModName, "Amazing Space Mod");
        assert.equal(status.currentPhase, "Moving files");
        assert.equal(status.processedModCount, 3);
        assert.equal(status.totalModCount, 10);
        assert.equal(status.progressPercent, 30);
    } finally {
        migrationState.resetModsPathMigrationStateForTest();
    }
});
