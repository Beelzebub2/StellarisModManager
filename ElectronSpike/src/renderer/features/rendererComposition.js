import {
    syncSearchClearButton
} from "../runtime/versionLoading.js";
import {
    checkForAppUpdates,
    hookAppUpdateControls
} from "./appUpdates.js";
import { createAppStartupController } from "./appStartup.js";
import {
    handleLaunchGame,
    refreshGameRunningStatus,
    refreshStellarisyncStatus,
    syncLaunchGameAvailability
} from "./gameLaunch.js";
import { createDetailDrawerController } from "./detailDrawer.js";
import { createGlobalControlsController } from "./globalControls.js";
import { createTabNavigationController } from "./tabNavigation.js";
import { createVersionControlsController } from "./versionControls.js";
import { createSettingsControlsController } from "./settingsControls.js";
import { createModsPathMigrationController } from "./modsPathMigration.js";
import { createMergerProgressController } from "./mergerProgress.js";
import { createMergerWorkspaceController } from "./mergerWorkspace.js";
import { createDownloadQueueController } from "./downloadQueue.js";
import { createDownloadFailureNoticeController } from "./downloadFailureNotice.js";
import { createWorkshopController } from "./workshopView.js";
import { createSettingsPageController } from "./settingsPage.js";
import { createLibraryWorkspaceController } from "./libraryWorkspace.js";
import {
    actionButtonClass,
    actionIntent,
    actionIsDisabled,
    actionLabel,
    applyInstalledHoverLabel,
    createVersionBrowserController
} from "./versionBrowser.js";

export function createRendererApp() {
    const {
        applySettingsToForm,
        autoConfigureSteamCmdSettings,
        detectAndApplyGameVersion,
        detectModsPathSettings,
        detectWorkshopRuntimeSettings,
        ensurePublicUsernameConfigured,
        getInputValue,
        handleWindowCloseWithUnsavedSettings,
        isDeveloperModeEnabled,
        markSettingsDirty,
        refreshSettingsPage,
        renderSettingsSubtabs,
        resolveUnsavedSettingsBeforeLeave,
        saveSettingsPage,
        setInputValue,
        syncDeveloperDiagnosticsVisibility,
        syncSettingsRuntimeVisibility,
        validateSettingsPage
    } = createSettingsPageController({
        beginModsPathMigrationSave: (...args) => beginModsPathMigrationSave(...args),
        didModsPathChange: (...args) => didModsPathChange(...args),
        promptForModsPathMigration: (...args) => promptForModsPathMigration(...args),
        refreshVersionOptions: (...args) => refreshVersionOptions(...args),
        refreshVersionResults: (...args) => refreshVersionResults(...args)
    });

    const {
        dismissDownloadFailureNotice,
        renderDownloadFailureNotice,
        syncDownloadFailureNotice
    } = createDownloadFailureNoticeController({
        isDeveloperModeEnabled
    });

    const {
        activateTab,
        activateTabGuarded,
        navigateTabHistoryBack,
        navigateTabHistoryForward
    } = createTabNavigationController({
        dismissDownloadFailureNotice,
        renderDownloadFailureNotice,
        resolveUnsavedSettingsBeforeLeave
    });

    const {
        applyQueueSnapshot,
        cancelAllQueueActions,
        cancelQueueAction,
        clearQueueHistory,
        getModNameByWorkshopId,
        queueAction,
        queueDownloadAction,
        refreshQueueSnapshot
    } = createDownloadQueueController({
        activateTab,
        isDeveloperModeEnabled,
        refreshDetailDrawer: (...args) => refreshDetailDrawer(...args),
        refreshLibrarySnapshot: (...args) => refreshLibrarySnapshot(...args),
        revealNewlyAddedDisabledMods: (...args) => revealNewlyAddedDisabledMods(...args),
        syncDownloadFailureNotice,
        syncVisibleVersionCardActionStates: () => syncVisibleVersionCardActionStates()
    });

    const {
        refreshDetailDrawer,
        showDetailDrawer
    } = createDetailDrawerController({
        actionButtonClass,
        actionIntent,
        actionIsDisabled,
        actionLabel,
        applyInstalledHoverLabel,
        cancelQueueAction,
        isDeveloperModeEnabled,
        queueAction
    });

    const {
        bootstrapSelectedVersionFromSettings,
        hookVersionCardDelegation,
        refreshVersionOptions,
        refreshVersionResults,
        syncVisibleVersionCardActionStates
    } = createVersionBrowserController({
        activateTab,
        queueAction,
        refreshDetailDrawer
    });

    const {
        initWorkshop,
        restoreVersionTabFromWorkshopContext
    } = createWorkshopController({
        activateTab,
        getModNameByWorkshopId,
        queueDownloadAction,
        refreshDetailDrawer,
        refreshLibrarySnapshot: (...args) => refreshLibrarySnapshot(...args),
        refreshQueueSnapshot
    });

    const {
        hookLibraryControls,
        refreshLibrarySnapshot,
        revealNewlyAddedDisabledMods
    } = createLibraryWorkspaceController({
        activateTab,
        activateTabGuarded,
        ensurePublicUsernameConfigured,
        queueAction,
        queueDownloadAction,
        refreshQueueSnapshot,
        syncVisibleVersionCardActionStates
    });

    const {
        beginModsPathMigrationSave,
        didModsPathChange,
        promptForModsPathMigration,
        refreshModsPathMigrationStatus,
        showModsPathMigrationProgressModal
    } = createModsPathMigrationController({
        applySettingsToForm,
        refreshLibrarySnapshot,
        refreshSettingsPage,
        syncLaunchGameAvailability
    });

    const {
        beginMergerProgress,
        refreshMergerProgressStatus,
        showMergerProgressModal
    } = createMergerProgressController({
        syncMergerButtons: (...args) => syncMergerButtons(...args)
    });

    const {
        hookMergerControls,
        refreshMergerPlan,
        renderMergerResultsWorkspace,
        syncMergerButtons
    } = createMergerWorkspaceController({
        beginMergerProgress,
        refreshMergerProgressStatus
    });

    const { hookGlobalControls } = createGlobalControlsController({
        activateTabGuarded,
        cancelAllQueueActions,
        clearQueueHistory,
        dismissDownloadFailureNotice,
        handleLaunchGame,
        handleWindowCloseWithUnsavedSettings,
        navigateTabHistoryBack,
        navigateTabHistoryForward,
        restoreVersionTabFromWorkshopContext,
        showDetailDrawer,
        showMergerProgressModal,
        showModsPathMigrationProgressModal
    });

    const { hookVersionControls } = createVersionControlsController({
        hookVersionCardDelegation,
        refreshVersionOptions,
        refreshVersionResults,
        syncSearchClearButton
    });

    const { hookSettingsControls } = createSettingsControlsController({
        autoConfigureSteamCmdSettings,
        detectAndApplyGameVersion,
        detectModsPathSettings,
        detectWorkshopRuntimeSettings,
        getInputValue,
        markSettingsDirty,
        refreshSettingsPage,
        renderSettingsSubtabs,
        saveSettingsPage,
        setInputValue,
        syncDeveloperDiagnosticsVisibility,
        syncSettingsRuntimeVisibility,
        validateSettingsPage
    });

    return createAppStartupController({
        activateTab,
        applyQueueSnapshot,
        bootstrapSelectedVersionFromSettings,
        checkForAppUpdates,
        ensurePublicUsernameConfigured,
        hookAppUpdateControls,
        hookGlobalControls,
        hookLibraryControls,
        hookMergerControls,
        hookSettingsControls,
        hookVersionControls,
        initWorkshop,
        refreshGameRunningStatus,
        refreshLibrarySnapshot,
        refreshMergerPlan,
        refreshMergerProgressStatus,
        refreshModsPathMigrationStatus,
        refreshQueueSnapshot,
        refreshSettingsPage,
        refreshStellarisyncStatus,
        refreshVersionOptions,
        refreshVersionResults,
        renderMergerResultsWorkspace,
        renderSettingsSubtabs,
        revealNewlyAddedDisabledMods
    });
}
