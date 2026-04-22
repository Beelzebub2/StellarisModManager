const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { app } = require("electron");

async function run() {
    const library = require("../dist/main/services/library.js");

    assert.equal(typeof library.syncLibrarySharedProfile, "function");

    const previousAppData = process.env.APPDATA;
    const previousFetch = global.fetch;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-shared-sync-test-"));

    try {
        process.env.APPDATA = tempRoot;

        const productDir = path.join(tempRoot, "StellarisModManager");
        fs.mkdirSync(productDir, { recursive: true });

        const db = new Database(path.join(productDir, "mods.db"));
        db.exec(`
            CREATE TABLE Mods (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                SteamWorkshopId TEXT NOT NULL DEFAULT '',
                Name TEXT NOT NULL DEFAULT '',
                Version TEXT NOT NULL DEFAULT '',
                InstalledPath TEXT NOT NULL DEFAULT '',
                DescriptorPath TEXT NOT NULL DEFAULT '',
                IsEnabled INTEGER NOT NULL DEFAULT 0,
                LoadOrder INTEGER NOT NULL DEFAULT 0,
                InstalledAt TEXT NULL,
                LastUpdatedAt TEXT NULL
            );
            CREATE TABLE Profiles (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                IsActive INTEGER NOT NULL DEFAULT 0,
                CreatedAt TEXT NULL,
                SharedProfileId TEXT NULL,
                SharedProfileRevision INTEGER NULL,
                SharedProfileUpdatedUtc TEXT NULL
            );
            CREATE TABLE ProfileEntries (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ProfileId INTEGER NOT NULL,
                ModId INTEGER NOT NULL,
                IsEnabled INTEGER NOT NULL DEFAULT 0,
                LoadOrder INTEGER NOT NULL DEFAULT 0
            );
        `);

        db.prepare(`
            INSERT INTO Mods (Id, SteamWorkshopId, Name, Version, InstalledPath, DescriptorPath, IsEnabled, LoadOrder)
            VALUES (1, '123456789', 'Test Mod', '1.0', ?, ?, 1, 0)
        `).run(
            path.join(productDir, "mods", "123456789"),
            path.join(productDir, "mods", "ugc_123456789.mod")
        );
        db.prepare(`
            INSERT INTO Profiles (
                Id, Name, IsActive, CreatedAt, SharedProfileId, SharedProfileRevision, SharedProfileUpdatedUtc
            )
            VALUES (
                1,
                'MP Saturday',
                1,
                '2026-04-21T00:00:00.000Z',
                '1234567890abcdef1234567890abcdef',
                3,
                '2026-04-22T22:00:00.000Z'
            )
        `).run();
        db.prepare(`
            INSERT INTO ProfileEntries (ProfileId, ModId, IsEnabled, LoadOrder)
            VALUES (1, 1, 1, 0)
        `).run();
        db.close();

        const responses = [
            {
                id: "1234567890abcdef1234567890abcdef",
                name: "MP Saturday",
                creator: "TestPilot",
                revision: 3,
                updatedUtc: "2026-04-22T22:00:00.000Z",
                mods: ["123456789"]
            },
            {
                id: "1234567890abcdef1234567890abcdef",
                name: "MP Saturday",
                creator: "TestPilot",
                revision: 4,
                updatedUtc: "2026-04-22T23:00:00.000Z",
                mods: ["123456789"]
            }
        ];

        global.fetch = async () => ({
            ok: true,
            status: 200,
            async json() {
                return responses.shift();
            }
        });

        const unchanged = await library.syncLibrarySharedProfile({
            profileId: 1,
            sharedProfileId: "1234567890abcdef1234567890abcdef"
        });
        assert.equal(unchanged.ok, true);
        assert.match(unchanged.message, /No remote changes found/i);

        const changed = await library.syncLibrarySharedProfile({
            profileId: 1,
            sharedProfileId: "1234567890abcdef1234567890abcdef"
        });
        assert.equal(changed.ok, true);
        assert.match(changed.message, /synced/i);

        const updatedDb = new Database(path.join(productDir, "mods.db"), { readonly: true });
        const profileRow = updatedDb.prepare(`
            SELECT SharedProfileId, SharedProfileRevision, SharedProfileUpdatedUtc
            FROM Profiles
            WHERE Id = 1
        `).get();
        updatedDb.close();

        assert.deepEqual(profileRow, {
            SharedProfileId: "1234567890abcdef1234567890abcdef",
            SharedProfileRevision: 4,
            SharedProfileUpdatedUtc: "2026-04-22T23:00:00.000Z"
        });

        process.exitCode = 0;
    } finally {
        global.fetch = previousFetch;
        if (previousAppData === undefined) {
            delete process.env.APPDATA;
        } else {
            process.env.APPDATA = previousAppData;
        }

        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

app.whenReady()
    .then(run)
    .then(() => app.exit(process.exitCode ?? 0))
    .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(error);
        app.exit(1);
    });
