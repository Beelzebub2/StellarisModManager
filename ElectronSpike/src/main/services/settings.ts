import fs from "node:fs";
import http from "node:http";
import { execFileSync } from "node:child_process";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type {
    SettingsAutoDetectResult,
    SettingsSaveResult,
    SettingsSnapshot,
    SettingsValidationResult
} from "../../shared/types";
import { logError, logInfo } from "./logger";
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
const DOWNLOAD_RUNTIME_OPTIONS = ["Auto", "Steamworks", "SteamCMD"];
const WINDOWS_USER_SHELL_FOLDERS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
const WINDOWS_SHELL_FOLDERS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders";
const WINDOWS_DOCUMENTS_VALUE = "Personal";
const STEAMCMD_BOOTSTRAP_TIMEOUT_MS = 45000;
const STEAMCMD_BOOTSTRAP_REDIRECT_LIMIT = 5;
const STEAMCMD_BOOTSTRAP_DIR_NAME = "steamcmd";
export const MIN_DOWNLOAD_CONCURRENCY = 1;
export const MAX_DOWNLOAD_CONCURRENCY = 5;
export const DEFAULT_STEAMWORKS_MAX_CONCURRENT_DOWNLOADS = 3;
export const DEFAULT_STEAMCMD_MAX_CONCURRENT_DOWNLOADS = 1;

interface WindowsDocumentsResolverInput {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    shellFoldersPersonal?: string;
    userShellFoldersPersonal?: string;
    skipRegistryLookup?: boolean;
}

interface DefaultModsPathResolverInput extends WindowsDocumentsResolverInput {
    platform?: NodeJS.Platform;
}

interface SteamCmdBootstrapSpec {
    archiveUrl: string;
    archiveFileName: string;
    archiveKind: "zip" | "tar.gz";
    executableName: string;
}

interface SteamCmdInstallRequest extends SteamCmdBootstrapSpec {
    installRoot: string;
}

interface AutoConfigureSteamCmdSnapshotOptions {
    baseSettings?: SettingsSnapshot;
    discovery?: ReturnType<typeof discoverSteamLibraries>;
    installRoot?: string;
    installSteamCmd?: (request: SteamCmdInstallRequest) => Promise<void>;
    allowExecutableDiscovery?: boolean;
    platform?: NodeJS.Platform;
}

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

function coerceInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }

    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
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

function normalizeDownloadConcurrencyLimit(value: unknown, fallback: number): number {
    const parsed = coerceInteger(value);
    if (parsed === undefined) {
        return fallback;
    }

    return Math.min(MAX_DOWNLOAD_CONCURRENCY, Math.max(MIN_DOWNLOAD_CONCURRENCY, parsed));
}

function getDownloadConcurrencyLimit(raw: Record<string, unknown>, fallback: number, ...keys: string[]): number {
    for (const key of keys) {
        if (raw[key] !== undefined) {
            return normalizeDownloadConcurrencyLimit(raw[key], fallback);
        }
    }

    return fallback;
}

function normalizeRuntime(value: string | undefined): string {
    if (!value) {
        return "Auto";
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "steamworks" || normalized === "steamkit2") {
        return "Steamworks";
    }

    if (normalized === "steamcmd") {
        return "SteamCMD";
    }

    return "Auto";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandWindowsEnvVariables(value: string, env: NodeJS.ProcessEnv): string {
    return value.replace(/%([^%]+)%/g, (_match, rawName: string) => {
        const name = String(rawName || "").trim();
        if (!name) {
            return "";
        }

        const resolved = env[name]
            ?? env[name.toUpperCase()]
            ?? env[name.toLowerCase()];
        return resolved ? resolved.trim() : `%${name}%`;
    });
}

function parseRegistryQueryValue(output: string, valueName: string): string | undefined {
    const match = output.match(new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_\\w+\\s+(.+)$`, "mi"));
    return coerceString(match?.[1]);
}

function queryWindowsRegistryValue(key: string, valueName: string): string | undefined {
    try {
        const output = execFileSync("reg", ["query", key, "/v", valueName], {
            encoding: "utf8",
            windowsHide: true
        });
        return parseRegistryQueryValue(output, valueName);
    } catch {
        return undefined;
    }
}

function resolveWindowsDocumentsDirectory(input?: WindowsDocumentsResolverInput): string {
    const homeDir = input?.homeDir?.trim() || os.homedir();
    const env = input?.env ?? process.env;
    const allowRegistryLookup = input?.skipRegistryLookup !== true;
    const shellFoldersPersonal = coerceString(input?.shellFoldersPersonal)
        ?? (allowRegistryLookup
            ? queryWindowsRegistryValue(WINDOWS_SHELL_FOLDERS_KEY, WINDOWS_DOCUMENTS_VALUE)
            : undefined);
    if (shellFoldersPersonal) {
        return path.normalize(shellFoldersPersonal);
    }

    const userShellFoldersPersonal = coerceString(input?.userShellFoldersPersonal)
        ?? (allowRegistryLookup
            ? queryWindowsRegistryValue(WINDOWS_USER_SHELL_FOLDERS_KEY, WINDOWS_DOCUMENTS_VALUE)
            : undefined);
    if (userShellFoldersPersonal) {
        return path.normalize(expandWindowsEnvVariables(userShellFoldersPersonal, env));
    }

    const oneDriveRoots = [
        coerceString(env.OneDrive),
        coerceString(env.OneDriveConsumer),
        coerceString(env.OneDriveCommercial)
    ].filter((value): value is string => Boolean(value));

    for (const root of oneDriveRoots) {
        const candidate = path.join(root, "Documents");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(homeDir, "Documents");
}

function defaultSettings(): SettingsSnapshot {
    return {
        launchOptions: "",
        workshopDownloadRuntime: "Auto",
        steamworksMaxConcurrentDownloads: DEFAULT_STEAMWORKS_MAX_CONCURRENT_DOWNLOADS,
        steamCmdMaxConcurrentDownloads: DEFAULT_STEAMCMD_MAX_CONCURRENT_DOWNLOADS,
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
    const legacyModsPath = getString(raw, "modsPath", "ModsPath");

    return {
        gamePath: getString(raw, "gamePath", "GamePath"),
        launchOptions: getString(raw, "launchOptions", "LaunchOptions") ?? defaults.launchOptions,
        modsPath: legacyModsPath,
        managedModsPath: getString(raw, "managedModsPath", "ManagedModsPath") ?? legacyModsPath,
        steamCmdPath: getString(raw, "steamCmdPath", "SteamCmdPath"),
        steamCmdDownloadPath: getString(raw, "steamCmdDownloadPath", "SteamCmdDownloadPath"),
        workshopDownloadRuntime: normalizeRuntime(
            getString(raw, "workshopDownloadRuntime", "WorkshopDownloadRuntime")
        ),
        steamworksMaxConcurrentDownloads: getDownloadConcurrencyLimit(
            raw,
            defaults.steamworksMaxConcurrentDownloads ?? DEFAULT_STEAMWORKS_MAX_CONCURRENT_DOWNLOADS,
            "steamworksMaxConcurrentDownloads",
            "SteamworksMaxConcurrentDownloads"
        ),
        steamCmdMaxConcurrentDownloads: getDownloadConcurrencyLimit(
            raw,
            defaults.steamCmdMaxConcurrentDownloads ?? DEFAULT_STEAMCMD_MAX_CONCURRENT_DOWNLOADS,
            "steamCmdMaxConcurrentDownloads",
            "SteamCmdMaxConcurrentDownloads"
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
        LaunchOptions: coerceString(settings.launchOptions) ?? null,
        ModsPath: coerceString(settings.modsPath) ?? null,
        ManagedModsPath: coerceString(settings.managedModsPath) ?? null,
        SteamCmdPath: coerceString(settings.steamCmdPath) ?? null,
        SteamCmdDownloadPath: coerceString(settings.steamCmdDownloadPath) ?? null,
        WorkshopDownloadRuntime: normalizeRuntime(coerceString(settings.workshopDownloadRuntime)),
        SteamworksMaxConcurrentDownloads: normalizeDownloadConcurrencyLimit(
            settings.steamworksMaxConcurrentDownloads,
            DEFAULT_STEAMWORKS_MAX_CONCURRENT_DOWNLOADS
        ),
        SteamCmdMaxConcurrentDownloads: normalizeDownloadConcurrencyLimit(
            settings.steamCmdMaxConcurrentDownloads,
            DEFAULT_STEAMCMD_MAX_CONCURRENT_DOWNLOADS
        ),
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

function resolveDefaultModsPath(input?: DefaultModsPathResolverInput): string {
    const platform = input?.platform ?? process.platform;
    const homeDir = input?.homeDir?.trim() || os.homedir();
    if (platform === "win32") {
        return path.join(
            resolveWindowsDocumentsDirectory(input),
            "Paradox Interactive",
            "Stellaris",
            "mod"
        );
    }

    if (platform === "darwin") {
        return path.join(homeDir, "Documents", "Paradox Interactive", "Stellaris", "mod");
    }

    return path.join(homeDir, ".local", "share", "Paradox Interactive", "Stellaris", "mod");
}

export function resolveWindowsDocumentsDirectoryForTest(input: WindowsDocumentsResolverInput): string {
    return resolveWindowsDocumentsDirectory(input);
}

export function getDefaultModsPath(): string {
    return resolveDefaultModsPath();
}

export function getDefaultModsPathForTest(input: DefaultModsPathResolverInput): string {
    return resolveDefaultModsPath(input);
}

export function resolveDescriptorModsPath(settings?: Pick<SettingsSnapshot, "modsPath"> | null): string {
    const configured = coerceString(settings?.modsPath);
    return configured ?? getDefaultModsPath();
}

export function resolveManagedModsPath(
    settings?: Pick<SettingsSnapshot, "managedModsPath" | "modsPath"> | null
): string {
    const configured = coerceString(settings?.managedModsPath);
    if (configured) {
        return configured;
    }

    return resolveDescriptorModsPath(settings);
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

function getSteamCmdExecutableNames(platform: NodeJS.Platform = process.platform): string[] {
    return platform === "win32"
        ? ["steamcmd.exe"]
        : ["steamcmd.sh", "steamcmd"];
}

function findSteamCmdExecutableInRoots(
    candidateRoots: string[],
    platform: NodeJS.Platform = process.platform
): string | undefined {
    const executableNames = getSteamCmdExecutableNames(platform);
    const roots = dedupePaths(candidateRoots);

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
    return findSteamCmdExecutableInRoots(roots);
}

function resolveSteamCmdDownloadPath(
    currentPath: string | undefined,
    steamCmdPath: string | undefined
): string | undefined {
    const existing = coerceString(currentPath);
    if (existing && fs.existsSync(existing)) {
        return existing;
    }

    const executableDir = steamCmdPath ? path.dirname(steamCmdPath) : undefined;
    if (executableDir && fs.existsSync(executableDir)) {
        return executableDir;
    }

    return undefined;
}

function resolveSteamCmdAutoConfig(
    current: SettingsSnapshot,
    discovery: ReturnType<typeof discoverSteamLibraries>,
    options?: {
        allowExecutableDiscovery?: boolean;
    }
): Pick<SettingsSnapshot, "steamCmdPath" | "steamCmdDownloadPath" | "workshopDownloadRuntime"> {
    const currentSteamCmdPath = coerceString(current.steamCmdPath);
    const allowExecutableDiscovery = options?.allowExecutableDiscovery !== false;
    const detectedSteamCmdPath = (currentSteamCmdPath && fs.existsSync(currentSteamCmdPath))
        ? currentSteamCmdPath
        : (allowExecutableDiscovery ? findSteamCmdExecutable(discovery) : undefined);

    const detectedSteamCmdDownloadPath = resolveSteamCmdDownloadPath(
        current.steamCmdDownloadPath,
        detectedSteamCmdPath
    );

    const currentRuntime = normalizeRuntime(coerceString(current.workshopDownloadRuntime));
    const detectedRuntime = currentRuntime === "Auto"
        ? (detectedSteamCmdPath && detectedSteamCmdDownloadPath ? "SteamCMD" : "Steamworks")
        : currentRuntime;

    return {
        steamCmdPath: detectedSteamCmdPath,
        steamCmdDownloadPath: detectedSteamCmdDownloadPath,
        workshopDownloadRuntime: detectedRuntime
    };
}

export function resolveSteamCmdAutoConfigForTest(input: {
    currentSettings?: SettingsSnapshot;
    discovery: ReturnType<typeof discoverSteamLibraries>;
    skipExecutableDiscovery?: boolean;
}): Pick<SettingsSnapshot, "steamCmdPath" | "steamCmdDownloadPath" | "workshopDownloadRuntime"> {
    return resolveSteamCmdAutoConfig(
        {
            ...defaultSettings(),
            ...(input.currentSettings ?? {})
        },
        input.discovery,
        {
            allowExecutableDiscovery: input.skipExecutableDiscovery !== true
        }
    );
}

function getSteamCmdBootstrapSpec(platform: NodeJS.Platform = process.platform): SteamCmdBootstrapSpec | undefined {
    switch (platform) {
        case "win32":
            return {
                archiveUrl: "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip",
                archiveFileName: "steamcmd.zip",
                archiveKind: "zip",
                executableName: "steamcmd.exe"
            };
        case "linux":
            return {
                archiveUrl: "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz",
                archiveFileName: "steamcmd_linux.tar.gz",
                archiveKind: "tar.gz",
                executableName: "steamcmd.sh"
            };
        case "darwin":
            return {
                archiveUrl: "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz",
                archiveFileName: "steamcmd_osx.tar.gz",
                archiveKind: "tar.gz",
                executableName: "steamcmd.sh"
            };
        default:
            return undefined;
    }
}

function isAppOwnedSteamCmdRoot(candidate: string): boolean {
    const resolvedCandidate = path.resolve(candidate);
    const productDir = path.resolve(getLegacyPaths().productDir);
    return resolvedCandidate === productDir || resolvedCandidate.startsWith(`${productDir}${path.sep}`);
}

function looksLikeDedicatedSteamCmdRoot(candidate: string): boolean {
    return path.basename(candidate).trim().toLowerCase() === STEAMCMD_BOOTSTRAP_DIR_NAME;
}

function escapePowerShellSingleQuotedString(value: string): string {
    return value.replace(/'/g, "''");
}

function resolveSteamCmdInstallRoot(current: SettingsSnapshot, overridePath?: string): string {
    const overridden = coerceString(overridePath);
    if (overridden) {
        return overridden;
    }

    const configuredExecutable = coerceString(current.steamCmdPath);
    if (configuredExecutable && fs.existsSync(configuredExecutable)) {
        return path.dirname(configuredExecutable);
    }

    const configuredDownloadRoot = coerceString(current.steamCmdDownloadPath);
    if (configuredDownloadRoot) {
        const existingExecutable = findSteamCmdExecutableInRoots([configuredDownloadRoot]);
        if (existingExecutable) {
            return path.dirname(existingExecutable);
        }

        if (isAppOwnedSteamCmdRoot(configuredDownloadRoot) || looksLikeDedicatedSteamCmdRoot(configuredDownloadRoot)) {
            return configuredDownloadRoot;
        }
    }

    return path.join(getLegacyPaths().productDir, STEAMCMD_BOOTSTRAP_DIR_NAME);
}

async function downloadFileWithRedirects(
    urlString: string,
    destinationPath: string,
    redirectCount = 0
): Promise<void> {
    if (redirectCount > STEAMCMD_BOOTSTRAP_REDIRECT_LIMIT) {
        throw new Error("Too many redirects while downloading SteamCMD.");
    }

    await new Promise<void>((resolve, reject) => {
        const url = new URL(urlString);
        const client = url.protocol === "https:" ? https : http;
        const request = client.get(url, { timeout: STEAMCMD_BOOTSTRAP_TIMEOUT_MS }, (response) => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode >= 301 && statusCode <= 308 && response.headers.location) {
                response.resume();
                const redirectedUrl = new URL(response.headers.location, url).toString();
                downloadFileWithRedirects(redirectedUrl, destinationPath, redirectCount + 1).then(resolve, reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(new Error(`HTTP ${statusCode}`));
                return;
            }

            const stream = fs.createWriteStream(destinationPath);
            const handleFailure = (error: unknown) => {
                stream.destroy();
                try {
                    fs.rmSync(destinationPath, { force: true });
                } catch {
                    // ignore cleanup failures for partial downloads
                }
                reject(error instanceof Error ? error : new Error("SteamCMD download failed."));
            };

            response.on("error", handleFailure);
            stream.on("error", handleFailure);
            stream.on("finish", () => resolve());
            response.pipe(stream);
        });

        request.on("error", reject);
        request.on("timeout", () => {
            request.destroy(new Error("Request timed out"));
        });
    });
}

function extractSteamCmdArchive(archivePath: string, destinationPath: string, archiveKind: SteamCmdBootstrapSpec["archiveKind"]): void {
    fs.mkdirSync(destinationPath, { recursive: true });

    if (archiveKind === "zip") {
        const command = `Expand-Archive -LiteralPath '${escapePowerShellSingleQuotedString(archivePath)}' -DestinationPath '${escapePowerShellSingleQuotedString(destinationPath)}' -Force`;
        try {
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command
                ],
                { encoding: "utf8" }
            );
        } catch (error) {
            const stderr = error instanceof Error && "stderr" in error
                ? String((error as { stderr?: string | Buffer }).stderr ?? "").trim()
                : "";
            if (stderr) {
                throw new Error(`SteamCMD zip extraction failed: ${stderr}`);
            }
            throw error;
        }
        return;
    }

    execFileSync("tar", ["-xzf", archivePath, "-C", destinationPath], { encoding: "utf8" });
}

export function extractSteamCmdArchiveForTest(input: {
    archivePath: string;
    destinationPath: string;
    archiveKind: SteamCmdBootstrapSpec["archiveKind"];
}): void {
    extractSteamCmdArchive(input.archivePath, input.destinationPath, input.archiveKind);
}

async function installSteamCmdToRoot(request: SteamCmdInstallRequest): Promise<void> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-steamcmd-bootstrap-"));
    const archivePath = path.join(tempRoot, request.archiveFileName);

    try {
        logInfo(`Downloading SteamCMD archive to ${archivePath}`);
        await downloadFileWithRedirects(request.archiveUrl, archivePath);
        extractSteamCmdArchive(archivePath, request.installRoot, request.archiveKind);
    } finally {
        try {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // ignore temp cleanup failures
        }
    }
}

async function autoConfigureSteamCmdSnapshotInternal(
    options: AutoConfigureSteamCmdSnapshotOptions
): Promise<SettingsAutoDetectResult> {
    const current: SettingsSnapshot = {
        ...loadSettingsOrDefault(),
        ...(options.baseSettings ?? {})
    };
    const discovery = options.discovery ?? discoverSteamLibraries();
    const platform = options.platform ?? process.platform;

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
    current.managedModsPath = resolveManagedModsPath(current);

    let steamCmdAutoConfig = resolveSteamCmdAutoConfig(current, discovery, {
        allowExecutableDiscovery: options.allowExecutableDiscovery !== false
    });
    let downloadedSteamCmd = false;

    if (!steamCmdAutoConfig.steamCmdPath || !steamCmdAutoConfig.steamCmdDownloadPath) {
        const bootstrapSpec = getSteamCmdBootstrapSpec(platform);
        if (!bootstrapSpec) {
            return {
                ok: false,
                message: `SteamCMD auto-configuration is not supported on platform '${platform}'.`,
                settings: current
            };
        }

        const installRoot = resolveSteamCmdInstallRoot(current, options.installRoot);
        const installSteamCmd = options.installSteamCmd ?? installSteamCmdToRoot;

        try {
            await installSteamCmd({
                installRoot,
                ...bootstrapSpec
            });
            downloadedSteamCmd = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown SteamCMD bootstrap error";
            logError(`SteamCMD bootstrap failed: ${message}`);
            return {
                ok: false,
                message: `Failed to download and extract SteamCMD: ${message}`,
                settings: current
            };
        }

        const installedExecutable = findSteamCmdExecutableInRoots([installRoot], platform);
        current.steamCmdPath = installedExecutable;
        current.steamCmdDownloadPath = installRoot;
        steamCmdAutoConfig = resolveSteamCmdAutoConfig(current, discovery, {
            allowExecutableDiscovery: false
        });
    }

    current.steamCmdPath = steamCmdAutoConfig.steamCmdPath;
    current.steamCmdDownloadPath = steamCmdAutoConfig.steamCmdDownloadPath;
    current.workshopDownloadRuntime = steamCmdAutoConfig.workshopDownloadRuntime;

    const detectedVersion = detectGameVersion(current.gamePath);
    if (detectedVersion) {
        current.lastDetectedGameVersion = detectedVersion;
    }

    if (!current.steamCmdPath || !current.steamCmdDownloadPath) {
        return {
            ok: false,
            message: "SteamCMD auto-configuration could not resolve a usable install.",
            settings: current
        };
    }

    return {
        ok: true,
        message: downloadedSteamCmd
            ? "SteamCMD downloaded and configured. Review and save settings."
            : "SteamCMD detected and configured. Review and save settings.",
        settings: current
    };
}

export async function autoConfigureSteamCmdSnapshot(baseSettings?: SettingsSnapshot): Promise<SettingsAutoDetectResult> {
    return autoConfigureSteamCmdSnapshotInternal({ baseSettings });
}

export async function autoConfigureSteamCmdSnapshotForTest(input: {
    currentSettings?: SettingsSnapshot;
    discovery: ReturnType<typeof discoverSteamLibraries>;
    installRoot?: string;
    installSteamCmd?: (request: SteamCmdInstallRequest) => Promise<void>;
    skipExecutableDiscovery?: boolean;
    platform?: NodeJS.Platform;
}): Promise<SettingsAutoDetectResult> {
    return autoConfigureSteamCmdSnapshotInternal({
        baseSettings: {
            ...defaultSettings(),
            ...(input.currentSettings ?? {})
        },
        discovery: input.discovery,
        installRoot: input.installRoot,
        installSteamCmd: input.installSteamCmd,
        allowExecutableDiscovery: input.skipExecutableDiscovery !== true,
        platform: input.platform
    });
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
        return {
            ...defaultSettings(),
            modsPath: getDefaultModsPath(),
            managedModsPath: getDefaultModsPath()
        };
    }

    const snapshot = {
        ...defaultSettings(),
        ...normalizeSettings(raw)
    };
    snapshot.modsPath = resolveDescriptorModsPath(snapshot);
    snapshot.managedModsPath = resolveManagedModsPath(snapshot);
    return snapshot;
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

    snapshot.modsPath = resolveDescriptorModsPath(snapshot);
    snapshot.managedModsPath = resolveManagedModsPath(snapshot);

    return snapshot;
}

export function saveSettingsSnapshot(next: SettingsSnapshot): SettingsSaveResult {
    const merged: SettingsSnapshot = {
        ...defaultSettings(),
        ...next,
        workshopDownloadRuntime: normalizeRuntime(coerceString(next.workshopDownloadRuntime)),
        steamworksMaxConcurrentDownloads: normalizeDownloadConcurrencyLimit(
            next.steamworksMaxConcurrentDownloads,
            DEFAULT_STEAMWORKS_MAX_CONCURRENT_DOWNLOADS
        ),
        steamCmdMaxConcurrentDownloads: normalizeDownloadConcurrencyLimit(
            next.steamCmdMaxConcurrentDownloads,
            DEFAULT_STEAMCMD_MAX_CONCURRENT_DOWNLOADS
        ),
        themePalette: coerceString(next.themePalette) ?? "Obsidian Ember"
    };
    merged.modsPath = resolveDescriptorModsPath(merged);
    merged.managedModsPath = resolveManagedModsPath(merged);

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

export function autoDetectSettingsSnapshot(baseSettings?: SettingsSnapshot): SettingsAutoDetectResult {
    const current: SettingsSnapshot = {
        ...loadSettingsOrDefault(),
        ...(baseSettings ?? {})
    };
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
    current.managedModsPath = resolveManagedModsPath(current);

    const steamCmdAutoConfig = resolveSteamCmdAutoConfig(current, discovery);
    current.steamCmdPath = steamCmdAutoConfig.steamCmdPath;
    current.steamCmdDownloadPath = steamCmdAutoConfig.steamCmdDownloadPath;
    current.workshopDownloadRuntime = steamCmdAutoConfig.workshopDownloadRuntime;

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
    const modsPath = coerceString(resolveDescriptorModsPath(settings));
    const managedModsPath = coerceString(resolveManagedModsPath(settings));
    const steamCmdPath = coerceString(settings.steamCmdPath);
    const runtime = normalizeRuntime(coerceString(settings.workshopDownloadRuntime));

    if (!gamePath) {
        warnings.push("Game path is not set.");
    } else if (!fs.existsSync(gamePath)) {
        errors.push("Game path does not exist.");
    }

    if (!modsPath) {
        warnings.push("Descriptor folder is not set.");
    } else if (!fs.existsSync(modsPath)) {
        warnings.push("Descriptor folder does not exist yet and will be created on demand.");
    }

    if (!managedModsPath) {
        warnings.push("Managed mods folder is not set.");
    } else if (!fs.existsSync(managedModsPath)) {
        warnings.push("Managed mods folder does not exist yet and will be created on demand.");
    }

    if (runtime !== "Steamworks") {
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
