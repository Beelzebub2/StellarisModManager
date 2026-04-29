import { contextBridge, ipcRenderer } from "electron";
import type {
    DirectoryPickerRequest,
    CompatibilityTagCatalogResult,
    DbSummary,
    DownloadActionRequest,
    DownloadActionResult,
    DownloadQueueCommandResult,
    DownloadQueueEvent,
    DownloadQueueSnapshot,
    LaunchGameResult,
    LibraryActionResult,
    LibraryCompatibilityReportRequest,
    LibraryApplyLoadOrderRequest,
    LibraryLoadOrderPreviewResult,
    LibraryModContextMenuCommandEvent,
    LibraryImportResult,
    LibraryMoveDirectionRequest,
    LibraryProfileActivationPreviewResult,
    MergePlan,
    ModMergerAnalyzeRequest,
    ModMergerAnalyzeResult,
    ModMergerBuildRequest,
    ModMergerBuildResult,
    ModMergerExportReportResult,
    ModMergerProgressStatus,
    ModMergerResolutionResult,
    ModMergerSetResolutionRequest,
    ModsPathMigrationRequest,
    ModsPathMigrationResult,
    ModsPathMigrationStatus,
    LibraryReorderRequest,
    ScanLocalModsResult,
    LibraryRenameProfileRequest,
    LibraryPublishSharedProfileRequest,
    LibraryPublishSharedProfileResult,
    LibrarySetModEnabledRequest,
    LibrarySetSharedProfileIdRequest,
    LibrarySyncSharedProfileRequest,
    LibrarySyncSharedProfileResult,
    LibrarySharedProfileSyncPreviewResult,
    LibrarySnapshot,
    ShowLibraryModContextMenuRequest,
    SettingsAutoDetectResult,
    SettingsSaveResult,
    SettingsSnapshot,
    SettingsValidationResult,
    SpikeApi,
    StellarisyncStatus,
    ModMergerApplyAutoRequest,
    ModMergerApplyAutoResult,
    ModMergerOpenResultsResult,
    ModMergerReadFilePreviewRequest,
    ModMergerReadFilePreviewResult,
    VersionBrowserQuery,
    VersionBrowserResult,
    VersionModDetail,
    VersionOption,
    SteamDiscoverySummary,
    SteamCmdProbeEvent,
    SteamCmdProbeRequest,
    SteamCmdProbeStartResult,
    SteamCmdProbeStatus,
    SystemSummary,
    WorkshopBrowserQuery,
    WorkshopBrowserResult,
    AppReleaseInfo,
    AppUpdateCheckResult,
    StartAppUpdateResult
} from "./shared/types";

const api: SpikeApi = {
    ping: () => ipcRenderer.invoke("spike:ping") as Promise<string>,
    getSystemSummary: () => ipcRenderer.invoke("spike:getSystemSummary") as Promise<SystemSummary>,
    getSettings: () => ipcRenderer.invoke("spike:getSettings") as Promise<SettingsSnapshot | null>,
    saveSettings: (settings: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:saveSettings", settings) as Promise<SettingsSaveResult>,
    migrateModsPath: (request: ModsPathMigrationRequest) =>
        ipcRenderer.invoke("spike:migrateModsPath", request) as Promise<ModsPathMigrationResult>,
    getModsPathMigrationStatus: () =>
        ipcRenderer.invoke("spike:getModsPathMigrationStatus") as Promise<ModsPathMigrationStatus>,
    autoDetectSettings: (settings?: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:autoDetectSettings", settings) as Promise<SettingsAutoDetectResult>,
    autoConfigureSteamCmd: (settings?: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:autoConfigureSteamCmd", settings) as Promise<SettingsAutoDetectResult>,
    validateSettings: (settings: SettingsSnapshot) =>
        ipcRenderer.invoke("spike:validateSettings", settings) as Promise<SettingsValidationResult>,
    getThemePaletteOptions: () =>
        ipcRenderer.invoke("spike:getThemePaletteOptions") as Promise<string[]>,
    getDownloadRuntimeOptions: () =>
        ipcRenderer.invoke("spike:getDownloadRuntimeOptions") as Promise<string[]>,
    setWindowChromeTheme: (themePalette?: string) =>
        ipcRenderer.invoke("spike:setWindowChromeTheme", themePalette) as Promise<boolean>,
    pickDirectory: (request?: DirectoryPickerRequest) =>
        ipcRenderer.invoke("spike:pickDirectory", request) as Promise<string | null>,
    getDbSummary: () => ipcRenderer.invoke("spike:getDbSummary") as Promise<DbSummary | null>,
    getLibrarySnapshot: () =>
        ipcRenderer.invoke("spike:getLibrarySnapshot") as Promise<LibrarySnapshot>,
    createLibraryProfile: (name: string) =>
        ipcRenderer.invoke("spike:createLibraryProfile", name) as Promise<LibraryActionResult>,
    renameLibraryProfile: (request: LibraryRenameProfileRequest) =>
        ipcRenderer.invoke("spike:renameLibraryProfile", request) as Promise<LibraryActionResult>,
    deleteLibraryProfile: (profileId: number) =>
        ipcRenderer.invoke("spike:deleteLibraryProfile", profileId) as Promise<LibraryActionResult>,
    previewLibraryProfileActivation: (profileId: number) =>
        ipcRenderer.invoke("spike:previewLibraryProfileActivation", profileId) as Promise<LibraryProfileActivationPreviewResult>,
    activateLibraryProfile: (profileId: number) =>
        ipcRenderer.invoke("spike:activateLibraryProfile", profileId) as Promise<LibraryActionResult>,
    setLibraryProfileSharedId: (request: LibrarySetSharedProfileIdRequest) =>
        ipcRenderer.invoke("spike:setLibraryProfileSharedId", request) as Promise<LibraryActionResult>,
    publishLibrarySharedProfile: (request: LibraryPublishSharedProfileRequest) =>
        ipcRenderer.invoke("spike:publishLibrarySharedProfile", request) as Promise<LibraryPublishSharedProfileResult>,
    previewLibrarySharedProfileSync: (request: LibrarySyncSharedProfileRequest) =>
        ipcRenderer.invoke("spike:previewLibrarySharedProfileSync", request) as Promise<LibrarySharedProfileSyncPreviewResult>,
    syncLibrarySharedProfile: (request: LibrarySyncSharedProfileRequest) =>
        ipcRenderer.invoke("spike:syncLibrarySharedProfile", request) as Promise<LibrarySyncSharedProfileResult>,
    getLibraryLoadOrderSuggestion: () =>
        ipcRenderer.invoke("spike:getLibraryLoadOrderSuggestion") as Promise<LibraryLoadOrderPreviewResult>,
    applyLibraryLoadOrderSuggestion: (request: LibraryApplyLoadOrderRequest) =>
        ipcRenderer.invoke("spike:applyLibraryLoadOrderSuggestion", request) as Promise<LibraryActionResult>,
    setLibraryModEnabled: (request: LibrarySetModEnabledRequest) =>
        ipcRenderer.invoke("spike:setLibraryModEnabled", request) as Promise<LibraryActionResult>,
    moveLibraryMod: (request: LibraryMoveDirectionRequest) =>
        ipcRenderer.invoke("spike:moveLibraryMod", request) as Promise<LibraryActionResult>,
    reorderLibraryMod: (request: LibraryReorderRequest) =>
        ipcRenderer.invoke("spike:reorderLibraryMod", request) as Promise<LibraryActionResult>,
    showLibraryModContextMenu: (request: ShowLibraryModContextMenuRequest) =>
        ipcRenderer.invoke("spike:showLibraryModContextMenu", request) as Promise<void>,
    onLibraryModContextMenuCommand: (handler: (event: LibraryModContextMenuCommandEvent) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
            handler(payload as LibraryModContextMenuCommandEvent);
        };

        ipcRenderer.on("spike:onLibraryModContextMenuCommand", listener);
        return () => {
            ipcRenderer.removeListener("spike:onLibraryModContextMenuCommand", listener);
        };
    },
    uninstallLibraryMod: (modId: number) =>
        ipcRenderer.invoke("spike:uninstallLibraryMod", modId) as Promise<LibraryActionResult>,
    checkLibraryUpdates: () =>
        ipcRenderer.invoke("spike:checkLibraryUpdates") as Promise<LibraryActionResult>,
    exportLibraryMods: () =>
        ipcRenderer.invoke("spike:exportLibraryMods") as Promise<LibraryActionResult>,
    importLibraryMods: () =>
        ipcRenderer.invoke("spike:importLibraryMods") as Promise<LibraryImportResult>,
    getCompatibilityTags: () =>
        ipcRenderer.invoke("spike:getCompatibilityTags") as Promise<CompatibilityTagCatalogResult>,
    reportLibraryCompatibility: (request: LibraryCompatibilityReportRequest) =>
        ipcRenderer.invoke("spike:reportLibraryCompatibility", request) as Promise<LibraryActionResult>,
    scanLocalMods: () =>
        ipcRenderer.invoke("spike:scanLocalMods") as Promise<ScanLocalModsResult>,
    modMergerAnalyze: (request?: ModMergerAnalyzeRequest) =>
        ipcRenderer.invoke("spike:modMergerAnalyze", request) as Promise<ModMergerAnalyzeResult>,
    modMergerGetPlan: () =>
        ipcRenderer.invoke("spike:modMergerGetPlan") as Promise<MergePlan | null>,
    getModMergerProgressStatus: () =>
        ipcRenderer.invoke("spike:getModMergerProgressStatus") as Promise<ModMergerProgressStatus>,
    modMergerSetResolution: (request: ModMergerSetResolutionRequest) =>
        ipcRenderer.invoke("spike:modMergerSetResolution", request) as Promise<ModMergerResolutionResult>,
    modMergerApplyAuto: (request?: ModMergerApplyAutoRequest) =>
        ipcRenderer.invoke("spike:modMergerApplyAuto", request) as Promise<ModMergerApplyAutoResult>,
    modMergerOpenResults: () =>
        ipcRenderer.invoke("spike:modMergerOpenResults") as Promise<ModMergerOpenResultsResult>,
    modMergerReadFilePreview: (request: ModMergerReadFilePreviewRequest) =>
        ipcRenderer.invoke("spike:modMergerReadFilePreview", request) as Promise<ModMergerReadFilePreviewResult>,
    modMergerBuild: (request?: ModMergerBuildRequest) =>
        ipcRenderer.invoke("spike:modMergerBuild", request) as Promise<ModMergerBuildResult>,
    modMergerExportReport: () =>
        ipcRenderer.invoke("spike:modMergerExportReport") as Promise<ModMergerExportReportResult>,
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
    // Legacy wrappers — delegate to the unified download manager
    queueVersionModAction: (request: { workshopId: string; action: "install" | "uninstall" }) =>
        ipcRenderer.invoke("spike:queueDownload", request) as Promise<DownloadActionResult>,
    cancelVersionModAction: (workshopId: string) =>
        ipcRenderer.invoke("spike:cancelDownload", workshopId) as Promise<DownloadActionResult>,
    cancelAllVersionModActions: () =>
        ipcRenderer.invoke("spike:cancelAllDownloads") as Promise<DownloadQueueCommandResult>,
    getVersionQueueSnapshot: () =>
        ipcRenderer.invoke("spike:getDownloadQueueSnapshot") as Promise<DownloadQueueSnapshot>,
    clearVersionQueueHistory: (workshopIds?: string[]) =>
        ipcRenderer.invoke("spike:clearDownloadHistory", workshopIds) as Promise<DownloadQueueCommandResult>,
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
    },
    queueDownload: (request: DownloadActionRequest) =>
        ipcRenderer.invoke("spike:queueDownload", request) as Promise<DownloadActionResult>,
    cancelDownload: (workshopId: string) =>
        ipcRenderer.invoke("spike:cancelDownload", workshopId) as Promise<DownloadActionResult>,
    cancelAllDownloads: () =>
        ipcRenderer.invoke("spike:cancelAllDownloads") as Promise<DownloadQueueCommandResult>,
    getDownloadQueueSnapshot: () =>
        ipcRenderer.invoke("spike:getDownloadQueueSnapshot") as Promise<DownloadQueueSnapshot>,
    clearDownloadHistory: (workshopIds?: string[]) =>
        ipcRenderer.invoke("spike:clearDownloadHistory", workshopIds) as Promise<DownloadQueueCommandResult>,
    getInstalledWorkshopIds: () =>
        ipcRenderer.invoke("spike:getInstalledWorkshopIds") as Promise<string[]>,
    onDownloadQueueEvent: (handler: (event: DownloadQueueEvent) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
            handler(payload as DownloadQueueEvent);
        };

        ipcRenderer.on("spike:downloadQueueEvent", listener);
        return () => {
            ipcRenderer.removeListener("spike:downloadQueueEvent", listener);
        };
    },
    checkAppUpdate: () =>
        ipcRenderer.invoke("spike:checkAppUpdate") as Promise<AppUpdateCheckResult>,
    startAppUpdate: (release: AppReleaseInfo) =>
        ipcRenderer.invoke("spike:startAppUpdate", release) as Promise<StartAppUpdateResult>,
    skipAppVersion: (version: string) =>
        ipcRenderer.invoke("spike:skipAppVersion", version) as Promise<SettingsSaveResult>,
    detectGameVersion: (gamePath: string) =>
        ipcRenderer.invoke("spike:detectGameVersion", gamePath) as Promise<string | null>
};

contextBridge.exposeInMainWorld("spikeApi", api);

declare global {
    interface Window {
        spikeApi: SpikeApi;
    }
}
