import { contextBridge, ipcRenderer } from "electron";
import type {
    DbSummary,
    LaunchGameResult,
    LibraryActionResult,
    LibraryCompatibilityReportRequest,
    LibraryImportResult,
    LibraryMoveDirectionRequest,
    ScanLocalModsResult,
    LibraryRenameProfileRequest,
    LibrarySetModEnabledRequest,
    LibrarySetSharedProfileIdRequest,
    LibrarySnapshot,
    SettingsAutoDetectResult,
    SettingsSaveResult,
    SettingsSnapshot,
    SettingsValidationResult,
    SpikeApi,
    StellarisyncStatus,
    VersionBrowserQuery,
    VersionBrowserResult,
    VersionModDetail,
    VersionModActionRequest,
    VersionModActionResult,
    VersionOption,
    VersionQueueSnapshot,
    SteamDiscoverySummary,
    SteamCmdProbeEvent,
    SteamCmdProbeRequest,
    SteamCmdProbeStartResult,
    SteamCmdProbeStatus,
    SystemSummary,
    WorkshopBrowserQuery,
    WorkshopBrowserResult
} from "./shared/types";

const api: SpikeApi = {
    ping: () => ipcRenderer.invoke("spike:ping") as Promise<string>,
    getSystemSummary: () => ipcRenderer.invoke("spike:getSystemSummary") as Promise<SystemSummary>,
    getSettings: () => ipcRenderer.invoke("spike:getSettings") as Promise<SettingsSnapshot | null>,
    saveSettings: (settings: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:saveSettings", settings) as Promise<SettingsSaveResult>,
    autoDetectSettings: () =>
        ipcRenderer.invoke("spike:autoDetectSettings") as Promise<SettingsAutoDetectResult>,
    validateSettings: (settings: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:validateSettings", settings) as Promise<SettingsValidationResult>,
    getThemePaletteOptions: () =>
        ipcRenderer.invoke("spike:getThemePaletteOptions") as Promise<string[]>,
    getDownloadRuntimeOptions: () =>
        ipcRenderer.invoke("spike:getDownloadRuntimeOptions") as Promise<string[]>,
    getDbSummary: () => ipcRenderer.invoke("spike:getDbSummary") as Promise<DbSummary | null>,
    getLibrarySnapshot: () =>
        ipcRenderer.invoke("spike:getLibrarySnapshot") as Promise<LibrarySnapshot>,
    createLibraryProfile: (name: string) =>
        ipcRenderer.invoke("spike:createLibraryProfile", name) as Promise<LibraryActionResult>,
    renameLibraryProfile: (request: LibraryRenameProfileRequest) =>
        ipcRenderer.invoke("spike:renameLibraryProfile", request) as Promise<LibraryActionResult>,
    deleteLibraryProfile: (profileId: number) =>
        ipcRenderer.invoke("spike:deleteLibraryProfile", profileId) as Promise<LibraryActionResult>,
    activateLibraryProfile: (profileId: number) =>
        ipcRenderer.invoke("spike:activateLibraryProfile", profileId) as Promise<LibraryActionResult>,
    setLibraryProfileSharedId: (request: LibrarySetSharedProfileIdRequest) =>
        ipcRenderer.invoke("spike:setLibraryProfileSharedId", request) as Promise<LibraryActionResult>,
    setLibraryModEnabled: (request: LibrarySetModEnabledRequest) =>
        ipcRenderer.invoke("spike:setLibraryModEnabled", request) as Promise<LibraryActionResult>,
    moveLibraryMod: (request: LibraryMoveDirectionRequest) =>
        ipcRenderer.invoke("spike:moveLibraryMod", request) as Promise<LibraryActionResult>,
    uninstallLibraryMod: (modId: number) =>
        ipcRenderer.invoke("spike:uninstallLibraryMod", modId) as Promise<LibraryActionResult>,
    checkLibraryUpdates: () =>
        ipcRenderer.invoke("spike:checkLibraryUpdates") as Promise<LibraryActionResult>,
    exportLibraryMods: () =>
        ipcRenderer.invoke("spike:exportLibraryMods") as Promise<LibraryActionResult>,
    importLibraryMods: () =>
        ipcRenderer.invoke("spike:importLibraryMods") as Promise<LibraryImportResult>,
    reportLibraryCompatibility: (request: LibraryCompatibilityReportRequest) =>
        ipcRenderer.invoke("spike:reportLibraryCompatibility", request) as Promise<LibraryActionResult>,
    scanLocalMods: () =>
        ipcRenderer.invoke("spike:scanLocalMods") as Promise<ScanLocalModsResult>,
    getSteamDiscoverySummary: () =>
        ipcRenderer.invoke("spike:getSteamDiscoverySummary") as Promise<SteamDiscoverySummary>,
    startSteamCmdProbe: (request?: SteamCmdProbeRequest) =>
        ipcRenderer.invoke("spike:startSteamCmdProbe", request) as Promise<SteamCmdProbeStartResult>,
    stopSteamCmdProbe: () =>
        ipcRenderer.invoke("spike:stopSteamCmdProbe") as Promise<SteamCmdProbeStartResult>,
    getSteamCmdProbeStatus: () =>
        ipcRenderer.invoke("spike:getSteamCmdProbeStatus") as Promise<SteamCmdProbeStatus>,
    getVersionOptions: (showOlderVersions: boolean) =>
        ipcRenderer.invoke("spike:getVersionOptions", showOlderVersions) as Promise<VersionOption[]>,
    clearVersionResultCache: () =>
        ipcRenderer.invoke("spike:clearVersionResultCache") as Promise<void>,
    queryVersionMods: (query: VersionBrowserQuery) =>
        ipcRenderer.invoke("spike:queryVersionMods", query) as Promise<VersionBrowserResult>,
    queueVersionModAction: (request: VersionModActionRequest) =>
        ipcRenderer.invoke("spike:queueVersionModAction", request) as Promise<VersionModActionResult>,
    cancelVersionModAction: (workshopId: string) =>
        ipcRenderer.invoke("spike:cancelVersionModAction", workshopId) as Promise<VersionModActionResult>,
    getVersionQueueSnapshot: () =>
        ipcRenderer.invoke("spike:getVersionQueueSnapshot") as Promise<VersionQueueSnapshot>,
    getVersionModDetail: (workshopId: string, selectedVersion: string) =>
        ipcRenderer.invoke("spike:getVersionModDetail", workshopId, selectedVersion) as Promise<VersionModDetail | null>,
    queryWorkshopMods: (query: WorkshopBrowserQuery) =>
        ipcRenderer.invoke("spike:queryWorkshopMods", query) as Promise<WorkshopBrowserResult>,
    clearWorkshopCache: () =>
        ipcRenderer.invoke("spike:clearWorkshopCache") as Promise<void>,
    launchGame: () =>
        ipcRenderer.invoke("spike:launchGame") as Promise<LaunchGameResult>,
    getGameRunningStatus: () =>
        ipcRenderer.invoke("spike:getGameRunningStatus") as Promise<boolean>,
    getStellarisyncStatus: () =>
        ipcRenderer.invoke("spike:getStellarisyncStatus") as Promise<StellarisyncStatus>,
    getAppVersion: () =>
        ipcRenderer.invoke("spike:getAppVersion") as Promise<string>,
    getAppIconDataUrl: () =>
        ipcRenderer.invoke("spike:getAppIconDataUrl") as Promise<string>,
    openExternalUrl: (url: string) =>
        ipcRenderer.invoke("spike:openExternalUrl", url) as Promise<boolean>,
    openPathInFileExplorer: (targetPath: string) =>
        ipcRenderer.invoke("spike:openPathInFileExplorer", targetPath) as Promise<boolean>,
    copyText: (value: string) =>
        ipcRenderer.invoke("spike:copyText", value) as Promise<boolean>,
    onSteamCmdProbeEvent: (handler: (event: SteamCmdProbeEvent) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
            handler(payload as SteamCmdProbeEvent);
        };

        ipcRenderer.on("spike:steamCmdProbeEvent", listener);
        return () => {
            ipcRenderer.removeListener("spike:steamCmdProbeEvent", listener);
        };
    }
};

contextBridge.exposeInMainWorld("spikeApi", api);

declare global {
    interface Window {
        spikeApi: SpikeApi;
    }
}
