import fs from "node:fs";
import Database from "better-sqlite3";
import type { DbSummary } from "../../shared/types";
import { getLegacyPaths } from "./paths";

function getDb(): Database.Database {
    const { modsDbPath } = getLegacyPaths();
    return new Database(modsDbPath, { readonly: true, fileMustExist: true });
}

export function loadDbSummary(): DbSummary | null {
    const { modsDbPath } = getLegacyPaths();

    if (!fs.existsSync(modsDbPath)) {
        return null;
    }

    let db: Database.Database | null = null;

    try {
        db = getDb();

        const modCountRow = db.prepare("SELECT COUNT(*) AS count FROM Mods").get() as { count: number };
        const profileCountRow = db.prepare("SELECT COUNT(*) AS count FROM Profiles").get() as { count: number };
        const activeProfileRow = db
            .prepare("SELECT Name FROM Profiles WHERE IsActive = 1 LIMIT 1")
            .get() as { Name: string } | undefined;

        const latestModRow = db
            .prepare(
                "SELECT Name FROM Mods ORDER BY COALESCE(LastUpdatedAt, InstalledAt) DESC, Id DESC LIMIT 1"
            )
            .get() as { Name: string } | undefined;

        return {
            modCount: modCountRow?.count ?? 0,
            profileCount: profileCountRow?.count ?? 0,
            activeProfileName: activeProfileRow?.Name ?? null,
            latestInstalledModName: latestModRow?.Name ?? null
        };
    } catch {
        return null;
    } finally {
        db?.close();
    }
}
