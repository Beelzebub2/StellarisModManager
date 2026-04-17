import fs from "node:fs";
import path from "node:path";
import { app, clipboard, dialog, ipcMain, shell } from "electron";
import type {
    LibraryCompatibilityReportRequest,
    LibraryMoveDirectionRequest,
    LibraryReorderRequest,
    LibraryRenameProfileRequest,
    LibrarySetModEnabledRequest,
    LibrarySetSharedProfileIdRequest,
    SettingsSnapshot,
    SteamCmdProbeRequest,
    SystemSummary,
    VersionBrowserQuery,
    VersionModActionRequest,
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
    moveLibraryMod,
    reorderLibraryMod,
    renameLibraryProfile,
    reportLibraryCompatibility,
    scanLocalMods,
    setLibraryModEnabled,
    setLibraryProfileSharedId,
    uninstallLibraryMod
} from "./services/library";
import { logError, logInfo } from "./services/logger";
import { getLegacyPaths } from "./services/paths";
import {
    autoDetectSettingsSnapshot,
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
    cancelAllVersionModActions,
    cancelVersionModAction,
    clearVersionQueueHistory,
    clearVersionResultCache,
    getVersionModDetail,
    getVersionQueueSnapshot,
    getVersionOptions,
    queryVersionMods,
    queueVersionModAction
} from "./services/versionBrowser";
import {
    clearWorkshopCache,
    queryWorkshopMods
} from "./services/workshopBrowser";

const CHANNELS = {
    ping: "spike:ping",
    systemSummary: "spike:getSystemSummary",
    settings: "spike:getSettings",
    settingsSave: "spike:saveSettings",
    settingsAutoDetect: "spike:autoDetectSettings",
    settingsValidate: "spike:validateSettings",
    settingsPalettes: "spike:getThemePaletteOptions",
    settingsRuntimes: "spike:getDownloadRuntimeOptions",
    dbSummary: "spike:getDbSummary",
    librarySnapshot: "spike:getLibrarySnapshot",
    libraryCreateProfile: "spike:createLibraryProfile",
    libraryRenameProfile: "spike:renameLibraryProfile",
    libraryDeleteProfile: "spike:deleteLibraryProfile",
    libraryActivateProfile: "spike:activateLibraryProfile",
    librarySetSharedProfileId: "spike:setLibraryProfileSharedId",
    librarySetModEnabled: "spike:setLibraryModEnabled",
    libraryMoveMod: "spike:moveLibraryMod",
    libraryReorderMod: "spike:reorderLibraryMod",
    libraryUninstallMod: "spike:uninstallLibraryMod",
    libraryCheckUpdates: "spike:checkLibraryUpdates",
    libraryExport: "spike:exportLibraryMods",
    libraryImport: "spike:importLibraryMods",
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
    versionAction: "spike:queueVersionModAction",
    versionActionCancel: "spike:cancelVersionModAction",
    versionActionCancelAll: "spike:cancelAllVersionModActions",
    versionQueue: "spike:getVersionQueueSnapshot",
    versionQueueClearHistory: "spike:clearVersionQueueHistory",
    versionDetail: "spike:getVersionModDetail",
    launchGame: "spike:launchGame",
    gameRunningStatus: "spike:getGameRunningStatus",
    stellarisyncStatus: "spike:getStellarisyncStatus",
    appVersion: "spike:getAppVersion",
    appIconDataUrl: "spike:getAppIconDataUrl",
    openExternalUrl: "spike:openExternalUrl",
    openPathInFileExplorer: "spike:openPathInFileExplorer",
    copyText: "spike:copyText",
    workshopQuery: "spike:queryWorkshopMods",
    workshopClearCache: "spike:clearWorkshopCache"
} as const;

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
    ipcMain.removeHandler(CHANNELS.settingsAutoDetect);
    ipcMain.removeHandler(CHANNELS.settingsValidate);
    ipcMain.removeHandler(CHANNELS.settingsPalettes);
    ipcMain.removeHandler(CHANNELS.settingsRuntimes);
    ipcMain.removeHandler(CHANNELS.dbSummary);
    ipcMain.removeHandler(CHANNELS.librarySnapshot);
    ipcMain.removeHandler(CHANNELS.libraryCreateProfile);
    ipcMain.removeHandler(CHANNELS.libraryRenameProfile);
    ipcMain.removeHandler(CHANNELS.libraryDeleteProfile);
    ipcMain.removeHandler(CHANNELS.libraryActivateProfile);
    ipcMain.removeHandler(CHANNELS.librarySetSharedProfileId);
    ipcMain.removeHandler(CHANNELS.librarySetModEnabled);
    ipcMain.removeHandler(CHANNELS.libraryMoveMod);
    ipcMain.removeHandler(CHANNELS.libraryReorderMod);
    ipcMain.removeHandler(CHANNELS.libraryUninstallMod);
    ipcMain.removeHandler(CHANNELS.libraryCheckUpdates);
    ipcMain.removeHandler(CHANNELS.libraryExport);
    ipcMain.removeHandler(CHANNELS.libraryImport);
    ipcMain.removeHandler(CHANNELS.libraryReportCompatibility);
    ipcMain.removeHandler(CHANNELS.libraryScanLocal);
    ipcMain.removeHandler(CHANNELS.steamDiscovery);
    ipcMain.removeHandler(CHANNELS.steamCmdStart);
    ipcMain.removeHandler(CHANNELS.steamCmdStop);
    ipcMain.removeHandler(CHANNELS.steamCmdStatus);
    ipcMain.removeHandler(CHANNELS.versionOptions);
    ipcMain.removeHandler(CHANNELS.versionClearCache);
    ipcMain.removeHandler(CHANNELS.versionQuery);
    ipcMain.removeHandler(CHANNELS.versionAction);
    ipcMain.removeHandler(CHANNELS.versionActionCancel);
    ipcMain.removeHandler(CHANNELS.versionActionCancelAll);
    ipcMain.removeHandler(CHANNELS.versionQueue);
    ipcMain.removeHandler(CHANNELS.versionQueueClearHistory);
    ipcMain.removeHandler(CHANNELS.versionDetail);
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

    ipcMain.handle(CHANNELS.settingsAutoDetect, async () => {
        return autoDetectSettingsSnapshot();
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

        const result = exportLibraryMods(selection.filePath);
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

    ipcMain.handle(CHANNELS.versionAction, async (_event, request: VersionModActionRequest) => {
        return queueVersionModAction(request);
    });

    ipcMain.handle(CHANNELS.versionActionCancel, async (_event, workshopId: string) => {
        return cancelVersionModAction(workshopId);
    });

    ipcMain.handle(CHANNELS.versionActionCancelAll, async () => {
        return cancelAllVersionModActions();
    });

    ipcMain.handle(CHANNELS.versionQueue, async () => {
        return getVersionQueueSnapshot();
    });

    ipcMain.handle(CHANNELS.versionQueueClearHistory, async (_event, workshopIds?: string[]) => {
        return clearVersionQueueHistory(workshopIds);
    });

    ipcMain.handle(CHANNELS.versionDetail, async (_event, workshopId: string, selectedVersion: string) => {
        return getVersionModDetail(workshopId, selectedVersion);
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
}
