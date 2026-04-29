export const SETTINGS_DOWNLOAD_CONCURRENCY_MIN = 1;
export const SETTINGS_DOWNLOAD_CONCURRENCY_MAX = 5;
export const DEFAULT_STEAMWORKS_CONCURRENCY = 3;
export const DEFAULT_STEAMCMD_CONCURRENCY = 1;

export function getDefaultSettingsModel() {
    return {
        gamePath: "", launchOptions: "", modsPath: "", managedModsPath: "", steamCmdPath: "", steamCmdDownloadPath: "",
        workshopDownloadRuntime: "Auto",
        steamworksMaxConcurrentDownloads: DEFAULT_STEAMWORKS_CONCURRENCY,
        steamCmdMaxConcurrentDownloads: DEFAULT_STEAMCMD_CONCURRENCY,
        lastDetectedGameVersion: "",
        autoDetectGame: true, developerMode: false, warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember", autoCheckAppUpdates: true,
        compatibilityReporterId: "", lastAppUpdateCheckUtc: "",
        lastOfferedAppVersion: "", skippedAppVersion: "", publicProfileUsername: "",
        hideDisabledMods: false
    };
}

export function normalizeSettingsPathKey(value, platform = globalThis.navigator?.platform || "") {
    const normalized = String(value || "")
        .trim()
        .replace(/[\\/]+/g, "/")
        .replace(/\/+$/, "");
    if (!normalized) {
        return "";
    }

    return String(platform).toLowerCase().includes("win")
        ? normalized.toLowerCase()
        : normalized;
}

export function clampSettingsConcurrency(value, fallback) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(SETTINGS_DOWNLOAD_CONCURRENCY_MAX, Math.max(SETTINGS_DOWNLOAD_CONCURRENCY_MIN, parsed));
}

export function getWorkshopRuntimeHint(runtime, steamCmdPath, steamCmdDownloadPath) {
    const normalizedRuntime = String(runtime || "Auto").trim();
    const hasSteamCmdPath = String(steamCmdPath || "").trim().length > 0;
    const hasSteamCmdDownloadPath = String(steamCmdDownloadPath || "").trim().length > 0;

    if (normalizedRuntime === "Steamworks" && !hasSteamCmdPath) {
        return "Steamworks needs a valid Steam session for Stellaris. Configure SteamCMD as the fallback and recovery path.";
    }

    if (normalizedRuntime === "Steamworks") {
        return "Steamworks is preferred when a valid Stellaris Steam session is available. SteamCMD stays ready as the fallback path.";
    }

    if (normalizedRuntime === "SteamCMD") {
        return hasSteamCmdPath && hasSteamCmdDownloadPath
            ? "SteamCMD is configured and ready for standalone downloads, including larger profile imports."
            : "SteamCMD is selected. Set both the executable and download path for reliable installs.";
    }

    return hasSteamCmdPath
        ? "Auto will use the best configured runtime and can fall back to SteamCMD when needed."
        : "Auto works best when SteamCMD is configured as the fallback path.";
}
