import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SteamDiscoverySummary, SteamLibraryCandidate } from "../../shared/types";

const STELLARIS_APP_ID = "281990";

function normalizePathKey(value: string): string {
    return process.platform === "win32"
        ? value.toLowerCase()
        : value;
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entry of paths) {
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }

        const key = normalizePathKey(path.normalize(trimmed));
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(path.normalize(trimmed));
    }

    return result;
}

function parseLibraryFolders(vdfContent: string): string[] {
    const paths: string[] = [];

    // Steam's modern VDF format stores each library under a numbered block with a "path" key.
    const modernPathRegex = /"path"\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = modernPathRegex.exec(vdfContent)) !== null) {
        const raw = match[1].replace(/\\\\/g, "\\");
        paths.push(raw);
    }

    // Legacy format can store numeric key-value pairs directly.
    const legacyPathRegex = /"\d+"\s*"([^"]+)"/g;
    while ((match = legacyPathRegex.exec(vdfContent)) !== null) {
        const raw = match[1].replace(/\\\\/g, "\\");
        paths.push(raw);
    }

    return dedupePaths(paths);
}

function candidateSteamRootsForPlatform(platform: string): string[] {
    const home = os.homedir();
    const roots: string[] = [];

    if (process.env.STEAM_PATH) {
        roots.push(process.env.STEAM_PATH);
    }

    if (platform === "win32") {
        if (process.env["PROGRAMFILES(X86)"]) {
            roots.push(path.join(process.env["PROGRAMFILES(X86)"], "Steam"));
        }

        if (process.env.PROGRAMFILES) {
            roots.push(path.join(process.env.PROGRAMFILES, "Steam"));
        }

        roots.push("C:\\Program Files (x86)\\Steam");
        roots.push("C:\\Program Files\\Steam");
    } else if (platform === "darwin") {
        roots.push(path.join(home, "Library", "Application Support", "Steam"));
    } else {
        roots.push(path.join(home, ".local", "share", "Steam"));
        roots.push(path.join(home, ".steam", "steam"));
        roots.push("/usr/lib/steam");
    }

    return dedupePaths(roots);
}

function toLibraryCandidate(libraryPath: string, source: string): SteamLibraryCandidate {
    const steamAppsPath = path.join(libraryPath, "steamapps");
    const stellarisPath = path.join(steamAppsPath, "common", "Stellaris");
    const workshopPath = path.join(steamAppsPath, "workshop", "content", STELLARIS_APP_ID);

    return {
        path: libraryPath,
        source,
        exists: fs.existsSync(libraryPath),
        steamAppsPath,
        stellarisPath,
        workshopContentPath: workshopPath,
        hasStellaris: fs.existsSync(stellarisPath),
        hasWorkshopContent: fs.existsSync(workshopPath)
    };
}

export function discoverSteamLibraries(): SteamDiscoverySummary {
    const platform = process.platform;
    const candidateRoots = candidateSteamRootsForPlatform(platform);
    const existingRoots = candidateRoots.filter((entry) => fs.existsSync(entry));

    const libraryFolderFiles = existingRoots
        .map((root) => path.join(root, "steamapps", "libraryfolders.vdf"))
        .filter((entry) => fs.existsSync(entry));

    const librarySources = new Map<string, { path: string; source: string }>();

    for (const root of existingRoots) {
        const normalized = path.normalize(root);
        librarySources.set(normalizePathKey(normalized), {
            path: normalized,
            source: "root"
        });
    }

    for (const filePath of libraryFolderFiles) {
        try {
            const content = fs.readFileSync(filePath, "utf8");
            const parsedLibraries = parseLibraryFolders(content);
            for (const libraryPath of parsedLibraries) {
                const normalized = path.normalize(libraryPath);
                const key = normalizePathKey(normalized);
                if (!librarySources.has(key)) {
                    librarySources.set(key, {
                        path: normalized,
                        source: `libraryfolders:${path.basename(filePath)}`
                    });
                }
            }
        } catch {
            // Intentionally ignore malformed or inaccessible files during discovery.
        }
    }

    const libraries = Array.from(librarySources.values())
        .map((entry) => {
            return toLibraryCandidate(entry.path, entry.source);
        })
        .sort((a, b) => a.path.localeCompare(b.path));

    const discoveredGamePaths = libraries
        .filter((entry) => entry.hasStellaris)
        .map((entry) => entry.stellarisPath);

    const discoveredWorkshopPaths = libraries
        .filter((entry) => entry.hasWorkshopContent)
        .map((entry) => entry.workshopContentPath);

    return {
        platform,
        steamRootCandidates: candidateRoots,
        existingSteamRoots: existingRoots,
        libraryFoldersFiles: libraryFolderFiles,
        libraries,
        discoveredGamePaths,
        discoveredWorkshopPaths
    };
}
