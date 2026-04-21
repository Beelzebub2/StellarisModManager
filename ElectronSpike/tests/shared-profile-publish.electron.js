const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { app } = require("electron");

async function run() {
    const library = require("../dist/main/services/library.js");

    assert.equal(typeof library.publishLibrarySharedProfile, "function");

    const previousAppData = process.env.APPDATA;
    const previousFetch = global.fetch;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-share-test-"));

    try {
        process.env.APPDATA = tempRoot;

        const productDir = path.join(tempRoot, "StellarisModManager");
        fs.mkdirSync(productDir, { recursive: true });
        fs.writeFileSync(
            path.join(productDir, "settings.json"),
            JSON.stringify({ PublicProfileUsername: "TestPilot" }, null, 2),
            "utf8"
        );

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
                SharedProfileId TEXT NULL
            );
            CREATE TABLE ProfileEntries (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ProfileId INTEGER NOT NULL,
                ModId INTEGER NOT NULL,
                IsEnabled INTEGER NOT NULL DEFAULT 0,
                LoadOrder INTEGER NOT NULL DEFAULT 0
            );
        `);
        db.prepare("INSERT INTO Mods (Id, SteamWorkshopId, Name, IsEnabled, LoadOrder) VALUES (1, ?, 'Test Mod', 1, 0)")
            .run("123456789");
        db.prepare("INSERT INTO Profiles (Id, Name, IsActive, CreatedAt, SharedProfileId) VALUES (1, 'MP Saturday', 1, '2026-04-21T00:00:00.000Z', 'sp-legacy-id')")
            .run();
        db.prepare("INSERT INTO ProfileEntries (ProfileId, ModId, IsEnabled, LoadOrder) VALUES (1, 1, 1, 0)")
            .run();
        db.close();

        const fetchCalls = [];
        global.fetch = async (url, options) => {
            fetchCalls.push({
                url: String(url),
                method: options?.method ?? "GET",
                body: options?.body ? JSON.parse(String(options.body)) : null
            });
            return {
                ok: true,
                status: 201,
                async json() {
                    return {
                        id: "1234567890abcdef1234567890abcdef",
                        name: "MP Saturday",
                        creator: "TestPilot",
                        mods: ["123456789"]
                    };
                }
            };
        };

        const result = await library.publishLibrarySharedProfile({ profileId: 1 });

        assert.equal(result.ok, true);
        assert.equal(result.sharedProfileId, "1234567890abcdef1234567890abcdef");
        assert.equal(result.created, true);
        assert.match(result.message, /published/i);

        assert.deepEqual(fetchCalls, [{
            url: "https://stellarisync.rrmtools.uk/profiles",
            method: "POST",
            body: {
                name: "MP Saturday",
                creator: "TestPilot",
                mods: ["123456789"]
            }
        }]);

        const updatedDb = new Database(path.join(productDir, "mods.db"), { readonly: true });
        const savedId = updatedDb.prepare("SELECT SharedProfileId FROM Profiles WHERE Id = 1").get();
        updatedDb.close();
        assert.deepEqual(savedId, { SharedProfileId: "1234567890abcdef1234567890abcdef" });

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
