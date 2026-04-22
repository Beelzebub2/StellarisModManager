import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import type {
    DirectoryPickerRequest,
    DownloadActionRequest,
    DownloadQueueSnapshot,
    LibraryCompatibilityReportRequest,
    LibraryMoveDirectionRequest,
    ModsPathMigrationRequest,
    LibraryPublishSharedProfileRequest,
    LibraryReorderRequest,
    LibraryRenameProfileRequest,
    LibrarySetModEnabledRequest,
    LibrarySetSharedProfileIdRequest,
    LibrarySyncSharedProfileRequest,
    SettingsSnapshot,
    SteamCmdProbeRequest,
    SystemSummary,
    VersionBrowserQuery,
    WorkshopBrowserQuery
} from "../shared/types";
import { loadDbSummary } from "./services/database";
import { getGameRunningStatus, launchGame } from "./services/gameLauncher";
import { checkStellarisyncStatus } from "./services/stellarisync";
import {
    activateLibraryProfile,
    checkLibraryUpdates,
    createLibraryProfile,
    deleteLibraryProfile,
    exportLibraryMods,
    getLibrarySnapshot,
    importLibraryMods,
    migrateModsPath,
    getCompatibilityTags,
    moveLibraryMod,
    publishLibrarySharedProfile,
    reorderLibraryMod,
    renameLibraryProfile,
    reportLibraryCompatibility,
    scanLocalMods,
    setLibraryModEnabled,
    setLibraryProfileSharedId,
    syncLibrarySharedProfile,
    uninstallLibraryMod
} from "./services/library";
import { logError, logInfo } from "./services/logger";
import { getLegacyPaths } from "./services/paths";
import {
    autoConfigureSteamCmdSnapshot,
    autoDetectSettingsSnapshot,
    detectGameVersionFromPath,
    getDownloadRuntimeOptions,
    getThemePaletteOptions,
    loadSettingsSnapshot,
    saveSettingsSnapshot,
    validateSettingsSnapshot
} from "./services/settings";
import { discoverSteamLibraries } from "./services/steamDiscovery";
import {
    getSteamCmdProbeStatus,
    startSteamCmdProbe,
    stopSteamCmdProbe
} from "./services/steamCmdProbe";
import {
    clearVersionResultCache,
    getVersionModDetail,
    getVersionOptions,
    queryVersionMods
} from "./services/versionBrowser";
import {
    cancelAllDownloads,
    cancelDownload,
    clearDownloadHistory,
    getDownloadQueueSnapshot,
    getInstalledWorkshopIdsList,
    queueDownload,
    setDownloadEventEmitter
} from "./services/downloadManager";
import {
    clearWorkshopCache,
    queryWorkshopMods
} from "./services/workshopBrowser";
import {
    checkAppUpdate,
    startAppUpdate
} from "./services/appUpdater";
import { applyTitleBarOverlayForTheme } from "./windowChrome";

const CHANNELS = {
    ping: "spike:ping",
    systemSummary: "spike:getSystemSummary",
    settings: "spike:getSettings",
    settingsSave: "spike:saveSettings",
    settingsMigrateModsPath: "spike:migrateModsPath",
    settingsAutoDetect: "spike:autoDetectSettings",
    settingsAutoConfigureSteamCmd: "spike:autoConfigureSteamCmd",
    settingsValidate: "spike:validateSettings",
    settingsPalettes: "spike:getThemePaletteOptions",
    settingsRuntimes: "spike:getDownloadRuntimeOptions",
    windowChromeTheme: "spike:setWindowChromeTheme",
    settingsPickDirectory: "spike:pickDirectory",
    dbSummary: "spike:getDbSummary",
    librarySnapshot: "spike:getLibrarySnapshot",
    libraryCreateProfile: "spike:createLibraryProfile",
    libraryRenameProfile: "spike:renameLibraryProfile",
    libraryDeleteProfile: "spike:deleteLibraryProfile",
    libraryActivateProfile: "spike:activateLibraryProfile",
    librarySetSharedProfileId: "spike:setLibraryProfileSharedId",
    libraryPublishSharedProfile: "spike:publishLibrarySharedProfile",
    librarySyncSharedProfile: "spike:syncLibrarySharedProfile",
    librarySetModEnabled: "spike:setLibraryModEnabled",
    libraryMoveMod: "spike:moveLibraryMod",
    libraryReorderMod: "spike:reorderLibraryMod",
    libraryUninstallMod: "spike:uninstallLibraryMod",
    libraryCheckUpdates: "spike:checkLibraryUpdates",
    libraryExport: "spike:exportLibraryMods",
    libraryImport: "spike:importLibraryMods",
    libraryGetCompatibilityTags: "spike:getCompatibilityTags",
    libraryReportCompatibility: "spike:reportLibraryCompatibility",
    libraryScanLocal: "spike:scanLocalMods",
    steamDiscovery: "spike:getSteamDiscoverySummary",
    steamCmdStart: "spike:startSteamCmdProbe",
    steamCmdStop: "spike:stopSteamCmdProbe",
    steamCmdStatus: "spike:getSteamCmdProbeStatus",
    steamCmdEvent: "spike:steamCmdProbeEvent",
    versionOptions: "spike:getVersionOptions",
    versionClearCache: "spike:clearVersionResultCache",
    versionQuery: "spike:queryVersionMods",
    versionDetail: "spike:getVersionModDetail",
    downloadQueue: "spike:queueDownload",
    downloadCancel: "spike:cancelDownload",
    downloadCancelAll: "spike:cancelAllDownloads",
    downloadSnapshot: "spike:getDownloadQueueSnapshot",
    downloadClearHistory: "spike:clearDownloadHistory",
    downloadInstalledIds: "spike:getInstalledWorkshopIds",
    downloadQueueEvent: "spike:downloadQueueEvent",
    launchGame: "spike:launchGame",
    gameRunningStatus: "spike:getGameRunningStatus",
    stellarisyncStatus: "spike:getStellarisyncStatus",
    appVersion: "spike:getAppVersion",
    appIconDataUrl: "spike:getAppIconDataUrl",
    openExternalUrl: "spike:openExternalUrl",
    openPathInFileExplorer: "spike:openPathInFileExplorer",
    copyText: "spike:copyText",
    workshopQuery: "spike:queryWorkshopMods",
    workshopClearCache: "spike:clearWorkshopCache",
    appUpdateCheck: "spike:checkAppUpdate",
    appUpdateStart: "spike:startAppUpdate",
    appUpdateSkip: "spike:skipAppVersion",
    settingsDetectGameVersion: "spike:detectGameVersion"
} as const;

let queueCompletionSyncTimer: NodeJS.Timeout | null = null;
let pendingQueueCompletionKey = "";
let appliedQueueCompletionKey = "";

function getCompletedQueueOpsKey(snapshot: DownloadQueueSnapshot): string {
    return (snapshot.items ?? [])
        .filter((item) => item.status === "completed" && (item.action === "install" || item.action === "uninstall"))
        .map((item) => `${item.workshopId}:${item.action}:${item.updatedAtUtc}`)
        .sort()
        .join("|");
}

function scheduleQueueCompletionLibrarySync(snapshot: DownloadQueueSnapshot): void {
    const completionKey = getCompletedQueueOpsKey(snapshot);
    if (!completionKey || completionKey === appliedQueueCompletionKey || completionKey === pendingQueueCompletionKey) {
        return;
    }

    pendingQueueCompletionKey = completionKey;
    if (queueCompletionSyncTimer) {
        clearTimeout(queueCompletionSyncTimer);
    }

    queueCompletionSyncTimer = setTimeout(() => {
        const nextKey = pendingQueueCompletionKey;
        pendingQueueCompletionKey = "";

        if (!nextKey || nextKey === appliedQueueCompletionKey) {
            return;
        }

        void (async () => {
            try {
                const result = await scanLocalMods();
                if (!result.ok) {
                    logError(`Queue completion library sync failed: ${result.message}`);
                    return;
                }

                appliedQueueCompletionKey = nextKey;
                logInfo(`Queue completion library sync finished: ${result.message}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown queue-sync error";
                logError(`Queue completion library sync crashed: ${message}`);
            }
        })();
    }, 900);
}

function buildSystemSummary(): SystemSummary {
    const paths = getLegacyPaths();

    return {
        platform: process.platform,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        paths,
        settingsExists: fs.existsSync(paths.settingsPath),
        dbExists: fs.existsSync(paths.modsDbPath)
    };
}

function resolveBundledAppIconPath(): string | null {
    const candidates = [
        path.join(app.getAppPath(), "assets", "icon.jpg"),
        path.join(app.getAppPath(), "assets", "icon.png"),
        path.join(app.getAppPath(), "assets", "app.ico"),
        path.join(__dirname, "..", "assets", "icon.jpg"),
        path.join(__dirname, "..", "assets", "icon.png"),
        path.join(__dirname, "..", "assets", "app.ico"),
        path.join(process.resourcesPath, "assets", "icon.jpg"),
        path.join(process.resourcesPath, "assets", "icon.png"),
        path.join(process.resourcesPath, "assets", "app.ico")
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function toImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") {
        return "image/png";
    }
    if (ext === ".ico") {
        return "image/x-icon";
    }

    return "image/jpeg";
}

export function registerIpcHandlers(): void {
    ipcMain.removeHandler(CHANNELS.ping);
    ipcMain.removeHandler(CHANNELS.systemSummary);
    ipcMain.removeHandler(CHANNELS.settings);
    ipcMain.removeHandler(CHANNELS.settingsSave);
    ipcMain.removeHandler(CHANNELS.settingsMigrateModsPath);
    ipcMain.removeHandler(CHANNELS.settingsAutoDetect);
    ipcMain.removeHandler(CHANNELS.settingsAutoConfigureSteamCmd);
    ipcMain.removeHandler(CHANNELS.settingsValidate);
    ipcMain.removeHandler(CHANNELS.settingsPalettes);
    ipcMain.removeHandler(CHANNELS.settingsRuntimes);
    ipcMain.removeHandler(CHANNELS.windowChromeTheme);
    ipcMain.removeHandler(CHANNELS.settingsPickDirectory);
    ipcMain.removeHandler(CHANNELS.dbSummary);
    ipcMain.removeHandler(CHANNELS.librarySnapshot);
    ipcMain.removeHandler(CHANNELS.libraryCreateProfile);
    ipcMain.removeHandler(CHANNELS.libraryRenameProfile);
    ipcMain.removeHandler(CHANNELS.libraryDeleteProfile);
    ipcMain.removeHandler(CHANNELS.libraryActivateProfile);
    ipcMain.removeHandler(CHANNELS.librarySetSharedProfileId);
    ipcMain.removeHandler(CHANNELS.libraryPublishSharedProfile);
    ipcMain.removeHandler(CHANNELS.librarySyncSharedProfile);
    ipcMain.removeHandler(CHANNELS.librarySetModEnabled);
    ipcMain.removeHandler(CHANNELS.libraryMoveMod);
    ipcMain.removeHandler(CHANNELS.libraryReorderMod);
    ipcMain.removeHandler(CHANNELS.libraryUninstallMod);
    ipcMain.removeHandler(CHANNELS.libraryCheckUpdates);
    ipcMain.removeHandler(CHANNELS.libraryExport);
    ipcMain.removeHandler(CHANNELS.libraryImport);
    ipcMain.removeHandler(CHANNELS.libraryGetCompatibilityTags);
    ipcMain.removeHandler(CHANNELS.libraryReportCompatibility);
    ipcMain.removeHandler(CHANNELS.libraryScanLocal);
    ipcMain.removeHandler(CHANNELS.steamDiscovery);
    ipcMain.removeHandler(CHANNELS.steamCmdStart);
    ipcMain.removeHandler(CHANNELS.steamCmdStop);
    ipcMain.removeHandler(CHANNELS.steamCmdStatus);
    ipcMain.removeHandler(CHANNELS.versionOptions);
    ipcMain.removeHandler(CHANNELS.versionClearCache);
    ipcMain.removeHandler(CHANNELS.versionQuery);
    ipcMain.removeHandler(CHANNELS.versionDetail);
    ipcMain.removeHandler(CHANNELS.downloadQueue);
    ipcMain.removeHandler(CHANNELS.downloadCancel);
    ipcMain.removeHandler(CHANNELS.downloadCancelAll);
    ipcMain.removeHandler(CHANNELS.downloadSnapshot);
    ipcMain.removeHandler(CHANNELS.downloadClearHistory);
    ipcMain.removeHandler(CHANNELS.downloadInstalledIds);
    ipcMain.removeHandler(CHANNELS.launchGame);
    ipcMain.removeHandler(CHANNELS.gameRunningStatus);
    ipcMain.removeHandler(CHANNELS.stellarisyncStatus);
    ipcMain.removeHandler(CHANNELS.appVersion);
    ipcMain.removeHandler(CHANNELS.appIconDataUrl);
    ipcMain.removeHandler(CHANNELS.openExternalUrl);
    ipcMain.removeHandler(CHANNELS.openPathInFileExplorer);
    ipcMain.removeHandler(CHANNELS.copyText);
    ipcMain.removeHandler(CHANNELS.workshopQuery);
    ipcMain.removeHandler(CHANNELS.workshopClearCache);
    ipcMain.removeHandler(CHANNELS.appUpdateCheck);
    ipcMain.removeHandler(CHANNELS.appUpdateStart);
    ipcMain.removeHandler(CHANNELS.appUpdateSkip);
    ipcMain.removeHandler(CHANNELS.settingsDetectGameVersion);

    setDownloadEventEmitter((downloadEvent) => {
        if (downloadEvent?.kind === "snapshot" && downloadEvent.snapshot) {
            scheduleQueueCompletionLibrarySync(downloadEvent.snapshot);
        }

        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) {
                continue;
            }

            window.webContents.send(CHANNELS.downloadQueueEvent, downloadEvent);
        }
    });

    ipcMain.handle(CHANNELS.ping, async () => {
        logInfo("Renderer ping received.");
        return "pong";
    });

    ipcMain.handle(CHANNELS.systemSummary, async () => {
        return buildSystemSummary();
    });

    ipcMain.handle(CHANNELS.settings, async () => {
        return loadSettingsSnapshot();
    });

    ipcMain.handle(CHANNELS.settingsSave, async (_event, settings: SettingsSnapshot) => {
        return saveSettingsSnapshot(settings);
    });

    ipcMain.handle(CHANNELS.settingsMigrateModsPath, async (_event, request: ModsPathMigrationRequest) => {
        return migrateModsPath(request);
    });

    ipcMain.handle(CHANNELS.settingsAutoDetect, async (_event, settings?: SettingsSnapshot) => {
        return autoDetectSettingsSnapshot(settings);
    });

    ipcMain.handle(CHANNELS.settingsAutoConfigureSteamCmd, async (_event, settings?: SettingsSnapshot) => {
        return autoConfigureSteamCmdSnapshot(settings);
    });

    ipcMain.handle(CHANNELS.settingsValidate, async (_event, settings: SettingsSnapshot) => {
        return validateSettingsSnapshot(settings);
    });

    ipcMain.handle(CHANNELS.settingsPalettes, async () => {
        return getThemePaletteOptions();
    });

    ipcMain.handle(CHANNELS.settingsRuntimes, async () => {
        return getDownloadRuntimeOptions();
    });

    ipcMain.handle(CHANNELS.windowChromeTheme, async (event, themePalette?: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        return applyTitleBarOverlayForTheme(window, themePalette);
    });

    ipcMain.handle(CHANNELS.settingsPickDirectory, async (_event, request?: DirectoryPickerRequest) => {
        const defaultPath = (request?.defaultPath ?? "").trim();
        const title = (request?.title ?? "Select folder").trim() || "Select folder";

        const selection = await dialog.showOpenDialog({
            title,
            defaultPath: defaultPath || undefined,
            properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
        });

        if (selection.canceled || selection.filePaths.length === 0) {
            return null;
        }

        return selection.filePaths[0] ?? null;
    });

    ipcMain.handle(CHANNELS.dbSummary, async () => {
        try {
            return loadDbSummary();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown db error";
            logError(`Failed to load DB summary: ${message}`);
            return null;
        }
    });

    ipcMain.handle(CHANNELS.librarySnapshot, async () => {
        return getLibrarySnapshot();
    });

    ipcMain.handle(CHANNELS.libraryCreateProfile, async (_event, name: string) => {
        return createLibraryProfile(name);
    });

    ipcMain.handle(CHANNELS.libraryRenameProfile, async (_event, request: LibraryRenameProfileRequest) => {
        return renameLibraryProfile(request);
    });

    ipcMain.handle(CHANNELS.libraryDeleteProfile, async (_event, profileId: number) => {
        return deleteLibraryProfile(profileId);
    });

    ipcMain.handle(CHANNELS.libraryActivateProfile, async (_event, profileId: number) => {
        return activateLibraryProfile(profileId);
    });

    ipcMain.handle(CHANNELS.librarySetSharedProfileId, async (_event, request: LibrarySetSharedProfileIdRequest) => {
        return setLibraryProfileSharedId(request);
    });

    ipcMain.handle(CHANNELS.libraryPublishSharedProfile, async (_event, request: LibraryPublishSharedProfileRequest) => {
        return publishLibrarySharedProfile(request);
    });

    ipcMain.handle(CHANNELS.librarySyncSharedProfile, async (_event, request: LibrarySyncSharedProfileRequest) => {
        return syncLibrarySharedProfile(request);
    });

    ipcMain.handle(CHANNELS.librarySetModEnabled, async (_event, request: LibrarySetModEnabledRequest) => {
        return setLibraryModEnabled(request);
    });

    ipcMain.handle(CHANNELS.libraryMoveMod, async (_event, request: LibraryMoveDirectionRequest) => {
        return moveLibraryMod(request);
    });

    ipcMain.handle(CHANNELS.libraryReorderMod, async (_event, request: LibraryReorderRequest) => {
        return reorderLibraryMod(request);
    });

    ipcMain.handle(CHANNELS.libraryUninstallMod, async (_event, modId: number) => {
        return uninstallLibraryMod(modId);
    });

    ipcMain.handle(CHANNELS.libraryCheckUpdates, async () => {
        return checkLibraryUpdates();
    });

    ipcMain.handle(CHANNELS.libraryExport, async () => {
        const defaultPath = path.join(getLegacyPaths().productDir, `mod-list-${Date.now()}.json`);
        const selection = await dialog.showSaveDialog({
            title: "Export Mod List",
            defaultPath,
            filters: [{ name: "JSON", extensions: ["json"] }]
        });

        if (selection.canceled || !selection.filePath) {
            return {
                ok: false,
                message: "Export canceled."
            };
        }

        const result = await exportLibraryMods(selection.filePath);
        if (result.ok) {
            return {
                ok: true,
                message: `${result.message} Saved to ${selection.filePath}`
            };
        }

        return result;
    });

    ipcMain.handle(CHANNELS.libraryImport, async () => {
        const selection = await dialog.showOpenDialog({
            title: "Import Mod List",
            properties: ["openFile"],
            filters: [{ name: "JSON", extensions: ["json"] }]
        });

        if (selection.canceled || selection.filePaths.length === 0) {
            return {
                ok: false,
                message: "Import canceled.",
                queuedCount: 0,
                ignoredCount: 0,
                sourcePath: null
            };
        }

        return importLibraryMods(selection.filePaths[0]);
    });

    ipcMain.handle(CHANNELS.libraryGetCompatibilityTags, async () => {
        return getCompatibilityTags();
    });

    ipcMain.handle(CHANNELS.libraryReportCompatibility, async (_event, request: LibraryCompatibilityReportRequest) => {
        return reportLibraryCompatibility(request);
    });

    ipcMain.handle(CHANNELS.libraryScanLocal, async () => {
        return scanLocalMods();
    });

    ipcMain.handle(CHANNELS.steamDiscovery, async () => {
        return discoverSteamLibraries();
    });

    ipcMain.handle(CHANNELS.steamCmdStatus, async () => {
        return getSteamCmdProbeStatus();
    });

    ipcMain.handle(CHANNELS.steamCmdStart, async (event, request?: SteamCmdProbeRequest) => {
        return startSteamCmdProbe(request, (probeEvent) => {
            event.sender.send(CHANNELS.steamCmdEvent, probeEvent);
        });
    });

    ipcMain.handle(CHANNELS.steamCmdStop, async (event) => {
        return stopSteamCmdProbe((probeEvent) => {
            event.sender.send(CHANNELS.steamCmdEvent, probeEvent);
        });
    });

    ipcMain.handle(CHANNELS.versionOptions, async (_event, showOlderVersions?: boolean) => {
        return getVersionOptions(showOlderVersions === true);
    });

    ipcMain.handle(CHANNELS.versionClearCache, async () => {
        clearVersionResultCache();
    });

    ipcMain.handle(CHANNELS.versionQuery, async (_event, query: VersionBrowserQuery) => {
        return queryVersionMods(query);
    });

    ipcMain.handle(CHANNELS.versionDetail, async (_event, workshopId: string, selectedVersion: string) => {
        return getVersionModDetail(workshopId, selectedVersion);
    });

    ipcMain.handle(CHANNELS.downloadQueue, async (_event, request: DownloadActionRequest) => {
        return queueDownload(request);
    });

    ipcMain.handle(CHANNELS.downloadCancel, async (_event, workshopId: string) => {
        return cancelDownload(workshopId);
    });

    ipcMain.handle(CHANNELS.downloadCancelAll, async () => {
        return cancelAllDownloads();
    });

    ipcMain.handle(CHANNELS.downloadSnapshot, async () => {
        return getDownloadQueueSnapshot();
    });

    ipcMain.handle(CHANNELS.downloadClearHistory, async (_event, workshopIds?: string[]) => {
        return clearDownloadHistory(workshopIds);
    });

    ipcMain.handle(CHANNELS.downloadInstalledIds, async () => {
        return getInstalledWorkshopIdsList();
    });

    ipcMain.handle(CHANNELS.launchGame, async () => {
        return launchGame();
    });

    ipcMain.handle(CHANNELS.gameRunningStatus, async () => {
        return getGameRunningStatus();
    });

    ipcMain.handle(CHANNELS.stellarisyncStatus, async () => {
        return checkStellarisyncStatus();
    });

    ipcMain.handle(CHANNELS.appVersion, async () => {
        return app.getVersion() || "0.1.0";
    });

    ipcMain.handle(CHANNELS.appIconDataUrl, async () => {
        try {
            const iconPath = resolveBundledAppIconPath();
            if (!iconPath) {
                return "";
            }

            const bytes = fs.readFileSync(iconPath);
            const mimeType = toImageMimeType(iconPath);
            return `data:${mimeType};base64,${bytes.toString("base64")}`;
        } catch {
            return "";
        }
    });

    ipcMain.handle(CHANNELS.openExternalUrl, async (_event, rawUrl: string) => {
        const value = (rawUrl ?? "").trim();
        if (!value) {
            return false;
        }

        try {
            await shell.openExternal(value);
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle(CHANNELS.openPathInFileExplorer, async (_event, rawPath: string) => {
        const targetPath = (rawPath ?? "").trim();
        if (!targetPath) {
            return false;
        }

        try {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                await shell.openPath(targetPath);
            } else {
                shell.showItemInFolder(targetPath);
            }

            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle(CHANNELS.copyText, async (_event, value: string) => {
        const text = (value ?? "").trim();
        if (!text) {
            return false;
        }

        clipboard.writeText(text);
        return true;
    });

    ipcMain.handle(CHANNELS.workshopQuery, async (_event, query: WorkshopBrowserQuery) => {
        return queryWorkshopMods(query);
    });

    ipcMain.handle(CHANNELS.workshopClearCache, async () => {
        clearWorkshopCache();
    });

    ipcMain.handle(CHANNELS.appUpdateCheck, async () => {
        return checkAppUpdate();
    });

    ipcMain.handle(CHANNELS.appUpdateStart, async (_event, release) => {
        return startAppUpdate(release);
    });

    ipcMain.handle(CHANNELS.appUpdateSkip, async (_event, version: string) => {
        const settings = loadSettingsSnapshot();
        if (!settings) {
            return { ok: false, message: "Settings not loaded.", settings: {} };
        }
        settings.skippedAppVersion = version;
        return saveSettingsSnapshot(settings);
    });

    ipcMain.handle(CHANNELS.settingsDetectGameVersion, (_event, gamePath: string) => {
        return detectGameVersionFromPath(gamePath);
    });
}
