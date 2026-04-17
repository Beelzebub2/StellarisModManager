export interface AppPaths {
    appDataRoot: string;
    productDir: string;
    settingsPath: string;
    modsDbPath: string;
    logsDir: string;
}

export interface SettingsSnapshot {
    gamePath?: string;
    modsPath?: string;
    steamCmdPath?: string;
    steamCmdDownloadPath?: string;
    workshopDownloadRuntime?: string;
    lastDetectedGameVersion?: string;
    autoDetectGame?: boolean;
    developerMode?: boolean;
    warnBeforeRestartGame?: boolean;
    themePalette?: string;
    autoCheckAppUpdates?: boolean;
    compatibilityReporterId?: string;
    lastAppUpdateCheckUtc?: string;
    lastOfferedAppVersion?: string;
    skippedAppVersion?: string;
    publicProfileUsername?: string;
}

export interface SettingsSaveResult {
    ok: boolean;
    message: string;
    settings: SettingsSnapshot;
}

export interface SettingsValidationResult {
    ok: boolean;
    message: string;
    warnings: string[];
    errors: string[];
}

export interface SettingsAutoDetectResult {
    ok: boolean;
    message: string;
    settings: SettingsSnapshot;
}

export interface DbSummary {
    modCount: number;
    profileCount: number;
    activeProfileName: string | null;
    latestInstalledModName: string | null;
}

export interface SystemSummary {
    platform: string;
    nodeVersion: string;
    electronVersion: string;
    paths: AppPaths;
    settingsExists: boolean;
    dbExists: boolean;
}

export interface SteamCmdProbeRequest {
    steamCmdPath?: string;
    forceInstallDir?: string;
    timeoutMs?: number;
    extraArgs?: string[];
}

export interface SteamCmdProbeStatus {
    isRunning: boolean;
    pid: number | null;
    command: string | null;
    startedAtUtc: string | null;
}

export interface SteamCmdProbeStartResult {
    ok: boolean;
    message: string;
    status: SteamCmdProbeStatus;
}

export interface SteamCmdProbeEvent {
    kind: "status" | "stdout" | "stderr" | "exit" | "error";
    message: string;
    timestampUtc: string;
    code?: number | null;
    signal?: string | null;
}

export interface SteamLibraryCandidate {
    path: string;
    source: string;
    exists: boolean;
    steamAppsPath: string;
    stellarisPath: string;
    workshopContentPath: string;
    hasStellaris: boolean;
    hasWorkshopContent: boolean;
}

export interface SteamDiscoverySummary {
    platform: string;
    steamRootCandidates: string[];
    existingSteamRoots: string[];
    libraryFoldersFiles: string[];
    libraries: SteamLibraryCandidate[];
    discoveredGamePaths: string[];
    discoveredWorkshopPaths: string[];
}

export type VersionSortMode = "relevance" | "most-subscribed" | "most-popular";

export type WorkshopSortMode = "relevance" | "most-subscribed" | "most-popular" | "recent" | "trend";

export interface WorkshopModCard {
    workshopId: string;
    workshopUrl: string;
    name: string;
    previewImageUrl: string | null;
    tags: string[];
    totalSubscribers: number;
    actionState: "not-installed" | "queued" | "installing" | "installed" | "uninstalling" | "error";
}

export interface WorkshopBrowserQuery {
    searchText?: string;
    sortMode?: WorkshopSortMode;
    page?: number;
    pageSize?: number;
}

export interface WorkshopBrowserResult {
    currentPage: number;
    totalPages: number;
    totalMatches: number;
    pageSize: number;
    cards: WorkshopModCard[];
    statusText: string;
    hasMore: boolean;
}

export interface VersionOption {
    version: string;
    displayName: string;
}

export interface VersionBrowserQuery {
    selectedVersion: string;
    searchText?: string;
    showOlderVersions?: boolean;
    sortMode?: VersionSortMode;
    page?: number;
    pageSize?: number;
}

export interface VersionModCard {
    workshopId: string;
    workshopUrl: string;
    name: string;
    gameVersionBadge: string;
    previewImageUrl: string | null;
    totalSubscribers: number;
    communityWorksCount: number;
    communityNotWorksCount: number;
    communityWorksPercent: number;
    actionState: "not-installed" | "queued" | "installing" | "installed" | "uninstalling" | "error";
}

export interface VersionBrowserResult {
    selectedVersion: string;
    currentPage: number;
    totalPages: number;
    totalMatches: number;
    pageSize: number;
    cards: VersionModCard[];
    statusText: string;
}

export interface VersionModActionRequest {
    workshopId: string;
    action: "install" | "uninstall";
}

export interface VersionModActionResult {
    ok: boolean;
    workshopId: string;
    actionState: VersionModCard["actionState"];
    message: string;
}

export interface VersionQueueItem {
    workshopId: string;
    action: "install" | "uninstall";
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    message: string;
    updatedAtUtc: string;
}

export interface VersionQueueSnapshot {
    items: VersionQueueItem[];
    hasActiveWork: boolean;
}

export interface VersionModDetail {
    workshopId: string;
    workshopUrl: string;
    title: string;
    descriptionText: string;
    previewImageUrl: string | null;
    additionalPreviewUrls: string[];
    tags: string[];
    totalSubscribers: number;
    gameVersionBadge: string;
    communityWorksCount: number;
    communityNotWorksCount: number;
    communityWorksPercent: number;
    actionState: VersionModCard["actionState"];
    queueMessage: string | null;
}

export interface LibraryProfile {
    id: number;
    name: string;
    sharedProfileId: string | null;
    isActive: boolean;
    createdAtUtc: string | null;
}

export interface LibraryModItem {
    id: number;
    workshopId: string;
    name: string;
    version: string;
    gameVersion: string | null;
    isEnabled: boolean;
    loadOrder: number;
    installedAtUtc: string | null;
    lastUpdatedAtUtc: string | null;
    installedPath: string;
    descriptorPath: string;
    totalSubscribers: number;
    isMultiplayerSafe: boolean;
    tags: string[];
    description: string | null;
    thumbnailUrl: string | null;
    hasUpdate: boolean;
}

export interface LibrarySnapshot {
    mods: LibraryModItem[];
    profiles: LibraryProfile[];
    activeProfileId: number | null;
    totalMods: number;
    enabledMods: number;
    updatesAvailable: number;
    compatibilityReporterId: string | null;
    lastDetectedGameVersion: string | null;
}

export interface LibraryActionResult {
    ok: boolean;
    message: string;
}

export interface LibraryMoveDirectionRequest {
    modId: number;
    direction: "up" | "down";
}

export interface LibrarySetModEnabledRequest {
    modId: number;
    isEnabled: boolean;
}

export interface LibraryRenameProfileRequest {
    profileId: number;
    name: string;
}

export interface LibrarySetSharedProfileIdRequest {
    profileId: number;
    sharedProfileId: string;
}

export interface LibraryCompatibilityReportRequest {
    workshopId: string;
    gameVersion: string;
    worked: boolean;
}

export interface LibraryImportResult extends LibraryActionResult {
    queuedCount: number;
    ignoredCount: number;
    sourcePath: string | null;
}

export interface ScanLocalModsResult {
    ok: boolean;
    message: string;
    discovered: number;
    added: number;
    alreadyKnown: number;
}

export interface LaunchGameResult {
    ok: boolean;
    message: string;
    wasRunning: boolean;
}

export interface StellarisyncStatus {
    online: boolean;
    checkedAtUtc: string;
}

export interface SpikeApi {
    ping: () => Promise<string>;
    getSystemSummary: () => Promise<SystemSummary>;
    getSettings: () => Promise<SettingsSnapshot | null>;
    saveSettings: (settings: SettingsSnapshot) => Promise<SettingsSaveResult>;
    autoDetectSettings: () => Promise<SettingsAutoDetectResult>;
    validateSettings: (settings: SettingsSnapshot) => Promise<SettingsValidationResult>;
    getThemePaletteOptions: () => Promise<string[]>;
    getDownloadRuntimeOptions: () => Promise<string[]>;
    getDbSummary: () => Promise<DbSummary | null>;
    getLibrarySnapshot: () => Promise<LibrarySnapshot>;
    createLibraryProfile: (name: string) => Promise<LibraryActionResult>;
    renameLibraryProfile: (request: LibraryRenameProfileRequest) => Promise<LibraryActionResult>;
    deleteLibraryProfile: (profileId: number) => Promise<LibraryActionResult>;
    activateLibraryProfile: (profileId: number) => Promise<LibraryActionResult>;
    setLibraryProfileSharedId: (request: LibrarySetSharedProfileIdRequest) => Promise<LibraryActionResult>;
    setLibraryModEnabled: (request: LibrarySetModEnabledRequest) => Promise<LibraryActionResult>;
    moveLibraryMod: (request: LibraryMoveDirectionRequest) => Promise<LibraryActionResult>;
    uninstallLibraryMod: (modId: number) => Promise<LibraryActionResult>;
    checkLibraryUpdates: () => Promise<LibraryActionResult>;
    exportLibraryMods: () => Promise<LibraryActionResult>;
    importLibraryMods: () => Promise<LibraryImportResult>;
    reportLibraryCompatibility: (request: LibraryCompatibilityReportRequest) => Promise<LibraryActionResult>;
    scanLocalMods: () => Promise<ScanLocalModsResult>;
    getSteamDiscoverySummary: () => Promise<SteamDiscoverySummary>;
    startSteamCmdProbe: (request?: SteamCmdProbeRequest) => Promise<SteamCmdProbeStartResult>;
    stopSteamCmdProbe: () => Promise<SteamCmdProbeStartResult>;
    getSteamCmdProbeStatus: () => Promise<SteamCmdProbeStatus>;
    getVersionOptions: (showOlderVersions: boolean) => Promise<VersionOption[]>;
    clearVersionResultCache: () => Promise<void>;
    queryVersionMods: (query: VersionBrowserQuery) => Promise<VersionBrowserResult>;
    queueVersionModAction: (request: VersionModActionRequest) => Promise<VersionModActionResult>;
    cancelVersionModAction: (workshopId: string) => Promise<VersionModActionResult>;
    getVersionQueueSnapshot: () => Promise<VersionQueueSnapshot>;
    getVersionModDetail: (workshopId: string, selectedVersion: string) => Promise<VersionModDetail | null>;
    queryWorkshopMods: (query: WorkshopBrowserQuery) => Promise<WorkshopBrowserResult>;
    clearWorkshopCache: () => Promise<void>;
    launchGame: () => Promise<LaunchGameResult>;
    getGameRunningStatus: () => Promise<boolean>;
    getStellarisyncStatus: () => Promise<StellarisyncStatus>;
    getAppVersion: () => Promise<string>;
    getAppIconDataUrl: () => Promise<string>;
    openExternalUrl: (url: string) => Promise<boolean>;
    openPathInFileExplorer: (targetPath: string) => Promise<boolean>;
    copyText: (value: string) => Promise<boolean>;
    onSteamCmdProbeEvent: (handler: (event: SteamCmdProbeEvent) => void) => () => void;
}
