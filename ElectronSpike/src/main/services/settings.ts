import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    SettingsAutoDetectResult,
    SettingsSaveResult,
    SettingsSnapshot,
    SettingsValidationResult
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { discoverSteamLibraries } from "./steamDiscovery";

const THEME_PALETTE_OPTIONS = [
    "Obsidian Ember",
    "Graphite Moss",
    "Nocturne Slate",
    "Starlight White",
    "Ivory White",
    "Frost White"
];
const DOWNLOAD_RUNTIME_OPTIONS = ["Auto", "SteamKit2", "SteamCmd"];

function coerceString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
        return {};
    }

    return value as Record<string, unknown>;
}

function getString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const resolved = coerceString(raw[key]);
        if (resolved) {
            return resolved;
        }
    }

    return undefined;
}

function getBoolean(raw: Record<string, unknown>, fallback: boolean, ...keys: string[]): boolean {
    for (const key of keys) {
        if (typeof raw[key] === "boolean") {
            return raw[key] as boolean;
        }
    }

    return fallback;
}

function normalizeRuntime(value: string | undefined): string {
    if (!value) {
        return "Auto";
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "steamkit2") {
        return "SteamKit2";
    }

    if (normalized === "steamcmd") {
        return "SteamCmd";
    }

    return "Auto";
}

function defaultSettings(): SettingsSnapshot {
    return {
        workshopDownloadRuntime: "Auto",
        autoDetectGame: true,
        warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember",
        autoCheckAppUpdates: true,
        hideDisabledMods: false
    };
}

function extractVersionNumber(value: string | undefined): string | undefined {
    const raw = coerceString(value);
    if (!raw) {
        return undefined;
    }

    // Strip leading "v" then return a clean major.minor.patch string.
    // Handles both "3.14.159265" and "Shelley v2.5.0 (735cf9b8976d3960ce220e405e459939)".
    const stripped = raw.replace(/^v/i, "").trim();
    const match = stripped.match(/^(\d+\.\d+(?:\.\d+)*)/);
    if (match) {
        return match[1];
    }

    // Fallback: find any version-like token anywhere in the string.
    const anyMatch = raw.match(/\bv?(\d+\.\d+(?:\.\d+)*)\b/i);
    return anyMatch ? anyMatch[1] : undefined;
}

function detectGameVersion(gamePath: string | undefined): string | undefined {
    const root = coerceString(gamePath);
    if (!root) {
        return undefined;
    }

    try {
        const settingsFile = path.join(root, "launcher-settings.json");
        if (!fs.existsSync(settingsFile)) {
            return undefined;
        }

        const raw = fs.readFileSync(settingsFile, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        // "rawVersion" is the clean field ("3.14.159265" or "v3.14.159265").
        // "version" is a display string ("Shelley v2.5.0 (735cf9b8976d3960ce220e405e459939)").
        return extractVersionNumber(String(parsed.rawVersion ?? ""))
            ?? extractVersionNumber(String(parsed.version ?? ""));
    } catch {
        return undefined;
    }
}

export function detectGameVersionFromPath(gamePath: string): string | null {
    return detectGameVersion(gamePath) ?? null;
}

function normalizeSettings(rawValue: unknown): SettingsSnapshot {
    const raw = asRecord(rawValue);
    const defaults = defaultSettings();

    return {
        gamePath: getString(raw, "gamePath", "GamePath"),
        modsPath: getString(raw, "modsPath", "ModsPath"),
        steamCmdPath: getString(raw, "steamCmdPath", "SteamCmdPath"),
        steamCmdDownloadPath: getString(raw, "steamCmdDownloadPath", "SteamCmdDownloadPath"),
        workshopDownloadRuntime: normalizeRuntime(
            getString(raw, "workshopDownloadRuntime", "WorkshopDownloadRuntime")
        ),
        lastDetectedGameVersion: getString(raw, "lastDetectedGameVersion", "LastDetectedGameVersion"),
        autoDetectGame: getBoolean(raw, defaults.autoDetectGame ?? true, "autoDetectGame", "AutoDetectGame"),
        developerMode: getBoolean(raw, defaults.developerMode ?? false, "developerMode", "DeveloperMode"),
        warnBeforeRestartGame: getBoolean(
            raw,
            defaults.warnBeforeRestartGame ?? true,
            "warnBeforeRestartGame",
            "WarnBeforeRestartGame"
        ),
        themePalette: getString(raw, "themePalette", "ThemePalette") ?? defaults.themePalette,
        autoCheckAppUpdates: getBoolean(
            raw,
            defaults.autoCheckAppUpdates ?? true,
            "autoCheckAppUpdates",
            "AutoCheckAppUpdates"
        ),
        compatibilityReporterId: getString(raw, "compatibilityReporterId", "CompatibilityReporterId"),
        lastAppUpdateCheckUtc: getString(raw, "lastAppUpdateCheckUtc", "LastAppUpdateCheckUtc"),
        lastOfferedAppVersion: getString(raw, "lastOfferedAppVersion", "LastOfferedAppVersion"),
        skippedAppVersion: getString(raw, "skippedAppVersion", "SkippedAppVersion"),
        publicProfileUsername: getString(raw, "publicProfileUsername", "PublicProfileUsername"),
        hideDisabledMods: getBoolean(raw, defaults.hideDisabledMods ?? false, "hideDisabledMods", "HideDisabledMods")
    };
}

function toPersistedSettings(settings: SettingsSnapshot): Record<string, unknown> {
    return {
        GamePath: coerceString(settings.gamePath) ?? null,
        ModsPath: coerceString(settings.modsPath) ?? null,
        SteamCmdPath: coerceString(settings.steamCmdPath) ?? null,
        SteamCmdDownloadPath: coerceString(settings.steamCmdDownloadPath) ?? null,
        WorkshopDownloadRuntime: normalizeRuntime(coerceString(settings.workshopDownloadRuntime)),
        LastDetectedGameVersion: coerceString(settings.lastDetectedGameVersion) ?? null,
        AutoDetectGame: coerceBoolean(settings.autoDetectGame, true),
        DeveloperMode: coerceBoolean(settings.developerMode, false),
        WarnBeforeRestartGame: coerceBoolean(settings.warnBeforeRestartGame, true),
        ThemePalette: coerceString(settings.themePalette) ?? "Obsidian Ember",
        AutoCheckAppUpdates: coerceBoolean(settings.autoCheckAppUpdates, true),
        CompatibilityReporterId: coerceString(settings.compatibilityReporterId) ?? null,
        LastAppUpdateCheckUtc: coerceString(settings.lastAppUpdateCheckUtc) ?? null,
        LastOfferedAppVersion: coerceString(settings.lastOfferedAppVersion) ?? null,
        SkippedAppVersion: coerceString(settings.skippedAppVersion) ?? null,
        PublicProfileUsername: coerceString(settings.publicProfileUsername) ?? null,
        HideDisabledMods: coerceBoolean(settings.hideDisabledMods, false)
    };
}

function getDefaultModsPath(): string {
    const home = os.homedir();
    if (process.platform === "win32") {
        return path.join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
    }

    if (process.platform === "darwin") {
        return path.join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
    }

    return path.join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod");
}

function dedupePaths(paths: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of paths) {
        if (!value) {
            continue;
        }

        const normalized = path.normalize(value);
        const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);
    }

    return result;
}

function findSteamCmdExecutable(discovery: ReturnType<typeof discoverSteamLibraries>): string | undefined {
    const envDirect = dedupePaths([
        coerceString(process.env.STEAMCMD_PATH),
        coerceString(process.env.STEAMCMD),
        coerceString(process.env.STEAMCMDEXE)
    ]);

    for (const candidate of envDirect) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const roots = dedupePaths([
        ...discovery.existingSteamRoots,
        ...discovery.libraries.map((entry) => entry.path),
        getLegacyPaths().productDir,
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Steam"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Steam")
    ]);

    const executableNames = process.platform === "win32"
        ? ["steamcmd.exe"]
        : ["steamcmd.sh", "steamcmd"];

    for (const root of roots) {
        const folders = [
            root,
            path.join(root, "steamcmd"),
            path.join(root, "steamapps", "common", "Steamworks SDK", "tools", "ContentBuilder", "builder"),
            path.join(root, "tools", "ContentBuilder", "builder")
        ];

        for (const folder of folders) {
            for (const executable of executableNames) {
                const candidate = path.join(folder, executable);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }

    return undefined;
}

function resolveSteamCmdDownloadPath(
    currentPath: string | undefined,
    steamCmdPath: string | undefined,
    discovery: ReturnType<typeof discoverSteamLibraries>
): string | undefined {
    const existing = coerceString(currentPath);
    if (existing) {
        return existing;
    }

    const executableDir = steamCmdPath ? path.dirname(steamCmdPath) : undefined;
    if (executableDir && fs.existsSync(executableDir)) {
        return executableDir;
    }

    const firstSteamRoot = discovery.existingSteamRoots[0];
    if (firstSteamRoot) {
        return firstSteamRoot;
    }

    return undefined;
}

function readSettingsRaw(): unknown | null {
    const { settingsPath } = getLegacyPaths();
    if (!fs.existsSync(settingsPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(settingsPath, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function loadSettingsOrDefault(): SettingsSnapshot {
    const raw = readSettingsRaw();
    if (raw === null) {
        return defaultSettings();
    }

    return {
        ...defaultSettings(),
        ...normalizeSettings(raw)
    };
}

export function getThemePaletteOptions(): string[] {
    return THEME_PALETTE_OPTIONS.slice();
}

export function getDownloadRuntimeOptions(): string[] {
    return DOWNLOAD_RUNTIME_OPTIONS.slice();
}

export function loadSettingsSnapshot(): SettingsSnapshot | null {
    const raw = readSettingsRaw();
    if (raw === null) {
        return null;
    }

    const snapshot = {
        ...defaultSettings(),
        ...normalizeSettings(raw)
    };

    if (!snapshot.lastDetectedGameVersion) {
        const detected = detectGameVersion(snapshot.gamePath);
        if (detected) {
            snapshot.lastDetectedGameVersion = detected;
        }
    }

    return snapshot;
}

export function saveSettingsSnapshot(next: SettingsSnapshot): SettingsSaveResult {
    const merged: SettingsSnapshot = {
        ...defaultSettings(),
        ...next,
        workshopDownloadRuntime: normalizeRuntime(coerceString(next.workshopDownloadRuntime)),
        themePalette: coerceString(next.themePalette) ?? "Obsidian Ember"
    };

    const detected = detectGameVersion(merged.gamePath);
    if (detected) {
        merged.lastDetectedGameVersion = detected;
    }

    const { settingsPath } = getLegacyPaths();
    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(toPersistedSettings(merged), null, 2), "utf8");
        return {
            ok: true,
            message: "Settings saved.",
            settings: merged
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown save error";
        return {
            ok: false,
            message: `Failed to save settings: ${message}`,
            settings: merged
        };
    }
}

export function autoDetectSettingsSnapshot(): SettingsAutoDetectResult {
    const current = loadSettingsOrDefault();
    const discovery = discoverSteamLibraries();

    const hasGamePath = coerceString(current.gamePath);
    if (!hasGamePath) {
        const gameLibrary = discovery.libraries.find((entry) => entry.hasStellaris);
        if (gameLibrary) {
            current.gamePath = gameLibrary.stellarisPath;
        }
    }

    if (!coerceString(current.modsPath)) {
        current.modsPath = getDefaultModsPath();
    }

    const currentSteamCmdPath = coerceString(current.steamCmdPath);
    const detectedSteamCmdPath = (currentSteamCmdPath && fs.existsSync(currentSteamCmdPath))
        ? currentSteamCmdPath
        : findSteamCmdExecutable(discovery);

    if (detectedSteamCmdPath) {
        current.steamCmdPath = detectedSteamCmdPath;
    }

    const detectedSteamCmdDownloadPath = resolveSteamCmdDownloadPath(
        current.steamCmdDownloadPath,
        detectedSteamCmdPath,
        discovery
    );
    if (detectedSteamCmdDownloadPath) {
        current.steamCmdDownloadPath = detectedSteamCmdDownloadPath;
    }

    if (detectedSteamCmdPath && normalizeRuntime(coerceString(current.workshopDownloadRuntime)) === "Auto") {
        current.workshopDownloadRuntime = "SteamCmd";
    }

    const detectedVersion = detectGameVersion(current.gamePath);
    if (detectedVersion) {
        current.lastDetectedGameVersion = detectedVersion;
    }

    return {
        ok: true,
        message: "Auto-detect completed.",
        settings: current
    };
}

export function validateSettingsSnapshot(settings: SettingsSnapshot): SettingsValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const gamePath = coerceString(settings.gamePath);
    const modsPath = coerceString(settings.modsPath);
    const steamCmdPath = coerceString(settings.steamCmdPath);
    const runtime = normalizeRuntime(coerceString(settings.workshopDownloadRuntime));

    if (!gamePath) {
        warnings.push("Game path is not set.");
    } else if (!fs.existsSync(gamePath)) {
        errors.push("Game path does not exist.");
    }

    if (!modsPath) {
        warnings.push("Mods path is not set.");
    } else if (!fs.existsSync(modsPath)) {
        warnings.push("Mods path does not exist yet and will be created on demand.");
    }

    if (runtime !== "SteamKit2") {
        if (!steamCmdPath) {
            errors.push("SteamCMD runtime requires a configured SteamCMD path.");
        } else if (!fs.existsSync(steamCmdPath)) {
            errors.push("Configured SteamCMD executable was not found.");
        }
    }

    return {
        ok: errors.length === 0,
        message: errors.length === 0 ? "Settings validated." : "Settings validation failed.",
        warnings,
        errors
    };
}
