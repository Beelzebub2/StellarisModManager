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
    managedModsPath?: string;
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
    hideDisabledMods?: boolean;
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

export interface ModsPathMigrationRequest {
    settings: SettingsSnapshot;
    moveExistingMods: boolean;
}

export interface ModsPathMigrationResult extends SettingsSaveResult {
    movedModCount: number;
    rewrittenDescriptorCount: number;
}

export interface ModsPathMigrationStatus {
    active: boolean;
    sourceModsPath: string | null;
    targetModsPath: string | null;
    moveExistingMods: boolean;
    startedAtUtc: string | null;
    completedAtUtc: string | null;
    lastMessage: string | null;
    currentModName: string | null;
    currentPhase: string | null;
    processedModCount: number;
    totalModCount: number;
    progressPercent: number;
}

export type ModMergerProgressOperation = "analyze" | "build" | "export-report";

export interface ModMergerProgressStatus {
    active: boolean;
    operation: ModMergerProgressOperation | null;
    startedAtUtc: string | null;
    completedAtUtc: string | null;
    phase: string | null;
    currentItemLabel: string | null;
    processedItemCount: number;
    totalItemCount: number;
    progressPercent: number;
    message: string | null;
    lastResultOk: boolean | null;
}

export interface DirectoryPickerRequest {
    title?: string;
    defaultPath?: string;
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
    fileSizeLabel: string | null;
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

export interface VersionQueueCommandResult {
    ok: boolean;
    message: string;
    affected: number;
}

export interface VersionModDetail {
    workshopId: string;
    workshopUrl: string;
    title: string;
    descriptionText: string;
    previewImageUrl: string | null;
    additionalPreviewUrls: string[];
    tags: string[];
    fileSizeLabel: string | null;
    totalSubscribers: number;
    gameVersionBadge: string;
    communityWorksCount: number;
    communityNotWorksCount: number;
    communityWorksPercent: number;
    actionState: VersionModCard["actionState"];
    queueMessage: string | null;
}

export type ConsensusState = "trusted" | "disputed" | "insufficient_votes" | "no_data";

export interface CompatibilityTagDefinition {
    key: string;
    label: string;
    description: string | null;
    conflictGroup: string | null;
    createdBy: "system" | "user";
    createdAtUtc: string;
}

export interface CompatibilityTagConsensus {
    tagKey: string;
    tagLabel: string;
    votes: number;
    totalVotes: number;
    confidencePercent: number;
    state: ConsensusState;
}

export interface CompatibilityTagGroupOption {
    tagKey: string;
    tagLabel: string;
    votes: number;
}

export interface CompatibilityTagGroupConsensus {
    groupKey: string;
    groupLabel: string;
    state: ConsensusState;
    leadingTagKey: string | null;
    leadingTagLabel: string | null;
    leadingVotes: number;
    totalVotes: number;
    confidencePercent: number;
    options: CompatibilityTagGroupOption[];
}

export interface LibraryCompatibilitySummary {
    workedCount: number;
    notWorkedCount: number;
    totalReports: number;
    workedPercentage: number;
    state: ConsensusState;
    tagConsensus: CompatibilityTagConsensus[];
    groupConsensus: CompatibilityTagGroupConsensus[];
    lastReportedUtc: string | null;
}

export interface LibraryProfile {
    id: number;
    name: string;
    sharedProfileId: string | null;
    sharedProfileRevision: number | null;
    sharedProfileUpdatedUtc: string | null;
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
    communityCompatibility: LibraryCompatibilitySummary | null;
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

export interface LibraryReorderRequest {
    modId: number;
    targetIndex: number;
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

export interface ShowLibraryModContextMenuRequest {
    modId: number;
    x?: number;
    y?: number;
}

export type LibraryModContextMenuCommand =
    | "view-details"
    | "update-mod"
    | "reinstall-mod"
    | "open-workshop"
    | "open-location"
    | "remove-mod";

export interface LibraryModContextMenuCommandEvent {
    modId: number;
    command: LibraryModContextMenuCommand;
}

export interface LibraryPublishSharedProfileRequest {
    profileId: number;
}

export interface LibraryPublishSharedProfileResult extends LibraryActionResult {
    sharedProfileId: string | null;
    created: boolean;
}

export interface LibrarySyncSharedProfileRequest {
    profileId: number;
    sharedProfileId: string;
    sharedProfileSince?: string;
}

export interface LibrarySyncSharedProfileResult extends LibraryActionResult {
    profileName: string | null;
    missingWorkshopIds: string[];
    enabledCount: number;
    disabledCount: number;
    syncedLoadOrderCount: number;
}

export interface LibraryCompatibilityReportRequest {
    workshopId: string;
    gameVersion: string;
    worked?: boolean;
    outcome?: "worked" | "not_worked";
    selectedTags?: string[];
    tagsOnly?: boolean;
}

export interface CompatibilityTagCatalogResult {
    ok: boolean;
    message: string;
    tags: CompatibilityTagDefinition[];
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

export interface MergeSourceMod {
    modId: number;
    workshopId: string;
    name: string;
    loadOrder: number;
    installedPath: string;
    descriptorPath: string;
    isEnabled: boolean;
    gameVersion?: string | null;
}

export interface MergePlan {
    id: string;
    createdAtUtc: string;
    profileId: number | null;
    profileName: string | null;
    sourceMods: MergeSourceMod[];
    outputModName: string;
    outputModPath: string;
    descriptorPath: string;
    filePlans: MergeFilePlan[];
    unresolvedConflictCount: number;
    warnings: string[];
}

export interface MergeFilePlan {
    virtualPath: string;
    fileType: MergeFileType;
    strategy: MergeStrategy;
    winner?: MergeConflictEntry;
    entries: MergeConflictEntry[];
    objectPlan?: unknown;
    localisationPlan?: unknown;
    outputPreview?: string | null;
    severity: MergeSeverity;
    resolutionState: MergeResolutionState;
}

export type MergeFileType =
    | "script"
    | "localisation"
    | "asset"
    | "interface"
    | "event"
    | "plain";

export type MergeStrategy =
    | "copy-load-order-winner"
    | "script-object-merge"
    | "localisation-key-merge"
    | "manual-text-merge"
    | "ignore";

export type MergeSeverity =
    | "info"
    | "warning"
    | "risky"
    | "critical";

export type MergeResolutionState =
    | "auto"
    | "manual"
    | "unresolved"
    | "ignored";

export interface ModMergerAnalyzeRequest {
    profileId?: number | null;
    includeDisabled?: boolean;
    outputModName?: string;
}

export interface ModMergerSummary {
    enabledModCount: number;
    scannedFileCount: number;
    conflictingFileCount: number;
    scriptConflictCount: number;
    scriptObjectConflictCount: number;
    localisationConflictCount: number;
    assetConflictCount: number;
    autoResolvedCount: number;
    unresolvedCount: number;
}

export interface ModMergerAnalyzeResult {
    ok: boolean;
    message: string;
    plan: MergePlan | null;
    summary: ModMergerSummary;
    warnings: string[];
}

export interface MergeConflictEntry {
    modId: number;
    workshopId: string;
    modName: string;
    loadOrder: number;
    realPath: string;
    virtualPath: string;
    sha256: string;
    sizeBytes: number;
    modifiedTimeUtc: string | null;
}

export interface ModMergerSetResolutionRequest {
    virtualPath: string;
    strategy: MergeStrategy;
    selectedModId?: number | null;
    manualText?: string | null;
}

export interface ModMergerResolutionResult {
    ok: boolean;
    message: string;
    plan: MergePlan | null;
    summary: ModMergerSummary;
}

export interface ModMergerBuildRequest {
    outputModName?: string;
    cleanOutputFolder?: boolean;
    disableSourceModsInGeneratedProfile?: boolean;
}

export interface ModMergerBuildResult {
    ok: boolean;
    message: string;
    outputModPath: string | null;
    descriptorPath: string | null;
    reportPath: string | null;
    manifestPath: string | null;
    copiedFileCount: number;
    generatedFileCount: number;
    unresolvedConflictCount: number;
}

export interface ModMergerExportReportResult {
    ok: boolean;
    message: string;
    reportPath: string | null;
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

export interface AppReleaseInfo {
    version: string;
    changelog: string | null;
    critical: boolean;
    downloadUrl: string;
    releaseUrl: string;
    releasedAt: string;
    sha256: string | null;
}

export interface AppUpdateCheckResult {
    ok: boolean;
    message: string;
    hasUpdate: boolean;
    release: AppReleaseInfo | null;
    currentVersion: string;
    checkedAtUtc: string;
}

export interface StartAppUpdateResult {
    ok: boolean;
    message: string;
}

export type ModActionState = "not-installed" | "queued" | "installing" | "installed" | "uninstalling" | "error";

export interface DownloadQueueItem {
    workshopId: string;
    modName: string;
    action: "install" | "uninstall";
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    progress: number;
    progressMode?: "determinate" | "indeterminate";
    message: string;
    updatedAtUtc: string;
}

export interface DownloadQueueSnapshot {
    items: DownloadQueueItem[];
    hasActiveWork: boolean;
    runningCount: number;
    queuedCount: number;
    pendingCount: number;
    finishedCount: number;
    failedCount: number;
    cancelledCount: number;
    totalTrackedCount: number;
    updatedAtUtc: string;
}

export interface DownloadQueueEvent {
    kind: "item-updated" | "snapshot";
    snapshot: DownloadQueueSnapshot;
}

export interface DownloadActionRequest {
    workshopId: string;
    modName?: string;
    action: "install" | "uninstall";
}

export interface DownloadActionResult {
    ok: boolean;
    workshopId: string;
    actionState: ModActionState;
    message: string;
}

export interface DownloadQueueCommandResult {
    ok: boolean;
    message: string;
    affected: number;
}

export interface SpikeApi {
    ping: () => Promise<string>;
    getSystemSummary: () => Promise<SystemSummary>;
    getSettings: () => Promise<SettingsSnapshot | null>;
    saveSettings: (settings: SettingsSnapshot) => Promise<SettingsSaveResult>;
    migrateModsPath: (request: ModsPathMigrationRequest) => Promise<ModsPathMigrationResult>;
    getModsPathMigrationStatus: () => Promise<ModsPathMigrationStatus>;
    autoDetectSettings: (settings?: SettingsSnapshot) => Promise<SettingsAutoDetectResult>;
    autoConfigureSteamCmd: (settings?: SettingsSnapshot) => Promise<SettingsAutoDetectResult>;
    validateSettings: (settings: SettingsSnapshot) => Promise<SettingsValidationResult>;
    getThemePaletteOptions: () => Promise<string[]>;
    getDownloadRuntimeOptions: () => Promise<string[]>;
    setWindowChromeTheme: (themePalette?: string) => Promise<boolean>;
    pickDirectory: (request?: DirectoryPickerRequest) => Promise<string | null>;
    getDbSummary: () => Promise<DbSummary | null>;
    getLibrarySnapshot: () => Promise<LibrarySnapshot>;
    createLibraryProfile: (name: string) => Promise<LibraryActionResult>;
    renameLibraryProfile: (request: LibraryRenameProfileRequest) => Promise<LibraryActionResult>;
    deleteLibraryProfile: (profileId: number) => Promise<LibraryActionResult>;
    activateLibraryProfile: (profileId: number) => Promise<LibraryActionResult>;
    setLibraryProfileSharedId: (request: LibrarySetSharedProfileIdRequest) => Promise<LibraryActionResult>;
    publishLibrarySharedProfile: (request: LibraryPublishSharedProfileRequest) => Promise<LibraryPublishSharedProfileResult>;
    syncLibrarySharedProfile: (request: LibrarySyncSharedProfileRequest) => Promise<LibrarySyncSharedProfileResult>;
    setLibraryModEnabled: (request: LibrarySetModEnabledRequest) => Promise<LibraryActionResult>;
    moveLibraryMod: (request: LibraryMoveDirectionRequest) => Promise<LibraryActionResult>;
    reorderLibraryMod: (request: LibraryReorderRequest) => Promise<LibraryActionResult>;
    showLibraryModContextMenu: (request: ShowLibraryModContextMenuRequest) => Promise<void>;
    onLibraryModContextMenuCommand: (handler: (event: LibraryModContextMenuCommandEvent) => void) => () => void;
    uninstallLibraryMod: (modId: number) => Promise<LibraryActionResult>;
    checkLibraryUpdates: () => Promise<LibraryActionResult>;
    exportLibraryMods: () => Promise<LibraryActionResult>;
    importLibraryMods: () => Promise<LibraryImportResult>;
    getCompatibilityTags: () => Promise<CompatibilityTagCatalogResult>;
    reportLibraryCompatibility: (request: LibraryCompatibilityReportRequest) => Promise<LibraryActionResult>;
    scanLocalMods: () => Promise<ScanLocalModsResult>;
    modMergerAnalyze: (request?: ModMergerAnalyzeRequest) => Promise<ModMergerAnalyzeResult>;
    modMergerGetPlan: () => Promise<MergePlan | null>;
    getModMergerProgressStatus: () => Promise<ModMergerProgressStatus>;
    modMergerSetResolution: (request: ModMergerSetResolutionRequest) => Promise<ModMergerResolutionResult>;
    modMergerBuild: (request?: ModMergerBuildRequest) => Promise<ModMergerBuildResult>;
    modMergerExportReport: () => Promise<ModMergerExportReportResult>;
    getSteamDiscoverySummary: () => Promise<SteamDiscoverySummary>;
    startSteamCmdProbe: (request?: SteamCmdProbeRequest) => Promise<SteamCmdProbeStartResult>;
    stopSteamCmdProbe: () => Promise<SteamCmdProbeStartResult>;
    getSteamCmdProbeStatus: () => Promise<SteamCmdProbeStatus>;
    getVersionOptions: (showOlderVersions: boolean) => Promise<VersionOption[]>;
    clearVersionResultCache: () => Promise<void>;
    queryVersionMods: (query: VersionBrowserQuery) => Promise<VersionBrowserResult>;
    queueVersionModAction: (request: VersionModActionRequest) => Promise<VersionModActionResult>;
    cancelVersionModAction: (workshopId: string) => Promise<VersionModActionResult>;
    cancelAllVersionModActions: () => Promise<VersionQueueCommandResult>;
    getVersionQueueSnapshot: () => Promise<VersionQueueSnapshot>;
    clearVersionQueueHistory: (workshopIds?: string[]) => Promise<VersionQueueCommandResult>;
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
    queueDownload: (request: DownloadActionRequest) => Promise<DownloadActionResult>;
    cancelDownload: (workshopId: string) => Promise<DownloadActionResult>;
    cancelAllDownloads: () => Promise<DownloadQueueCommandResult>;
    getDownloadQueueSnapshot: () => Promise<DownloadQueueSnapshot>;
    clearDownloadHistory: (workshopIds?: string[]) => Promise<DownloadQueueCommandResult>;
    getInstalledWorkshopIds: () => Promise<string[]>;
    onDownloadQueueEvent: (handler: (event: DownloadQueueEvent) => void) => () => void;
    checkAppUpdate: () => Promise<AppUpdateCheckResult>;
    startAppUpdate: (release: AppReleaseInfo) => Promise<StartAppUpdateResult>;
    skipAppVersion: (version: string) => Promise<SettingsSaveResult>;
    detectGameVersion: (gamePath: string) => Promise<string | null>;
}
