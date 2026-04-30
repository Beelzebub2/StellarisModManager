import { applyAppIcon } from "../runtime/appShell.js";
import { setText } from "../runtime/dom.js";
import { applyDataIcons } from "../runtime/icons.js";
import { state } from "../runtime/state.js";
import { setLibraryStatus, setMergerStatus } from "../runtime/status.js";
import { syncSearchClearButton } from "../runtime/versionLoading.js";
import {
    hookCustomTooltips,
    hookWindowResizeResponsiveness
} from "../runtime/windowUi.js";

function getWindowView() {
    try {
        return new URLSearchParams(window.location.search).get("view") || "main";
    } catch {
        return "main";
    }
}

export function createAppStartupController({
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
}) {
    async function refreshTopbarShell() {
        try {
            await window.spikeApi.ping();
            const version = await window.spikeApi.getAppVersion();
            setText("appVersionText", `v${version}`);
        } catch {
            setText("appVersionText", "v0.1.0");
        }

        await applyAppIcon();
        await refreshStellarisyncStatus();
    }

    async function init() {
        hookWindowResizeResponsiveness();
        applyDataIcons(document);
        hookCustomTooltips();

        const windowView = getWindowView();
        document.body.dataset.windowView = windowView;
        if (windowView === "merger-results") {
            hookMergerControls();
            hookGlobalControls();
            await refreshTopbarShell();
            await Promise.all([
                refreshMergerPlan(),
                refreshMergerProgressStatus()
            ]);
            renderMergerResultsWorkspace();
            setMergerStatus("Merger results ready.");
            return;
        }

        hookVersionControls();
        hookSettingsControls();
        hookLibraryControls();
        hookMergerControls();
        hookGlobalControls();
        hookAppUpdateControls();
        initWorkshop();
        renderSettingsSubtabs();

        await refreshTopbarShell();
        await bootstrapSelectedVersionFromSettings();

        // Load all data in parallel
        await Promise.all([
            refreshVersionOptions(),
            refreshSettingsPage(),
            refreshLibrarySnapshot(),
            refreshMergerPlan(),
            refreshMergerProgressStatus(),
            refreshQueueSnapshot(),
            refreshModsPathMigrationStatus(),
            refreshGameRunningStatus()
        ]);

        await ensurePublicUsernameConfigured();

        // Auto-scan local mods on startup
        setLibraryStatus("Auto-scanning local mods...");
        const previousLibrarySnapshot = state.library.snapshot;
        const scanResult = await window.spikeApi.scanLocalMods();
        let revealedHiddenAddedMods = false;
        if (scanResult.added > 0 || scanResult.alreadyKnown > 0) {
            await refreshLibrarySnapshot();
            if (scanResult.added > 0) {
                revealedHiddenAddedMods = await revealNewlyAddedDisabledMods(previousLibrarySnapshot);
            }
        }
        if (!revealedHiddenAddedMods) {
            setLibraryStatus(scanResult.message);
        }

        // Fetch subscriber counts and thumbnails from Steam in the background.
        // This is fire-and-forget; the library re-renders once it completes.
        window.spikeApi.checkLibraryUpdates().then(async () => {
            await refreshLibrarySnapshot();
        }).catch(() => { /* non-fatal */ });

        await refreshVersionResults();
        syncSearchClearButton();
        activateTab("version");

        // Push-based queue events from main process
        if (state.downloadEventUnsubscribe) state.downloadEventUnsubscribe();
        state.downloadEventUnsubscribe = window.spikeApi.onDownloadQueueEvent((event) => {
            if (event.snapshot) applyQueueSnapshot(event.snapshot);
        });

        if (state.gamePollingHandle) clearInterval(state.gamePollingHandle);
        state.gamePollingHandle = setInterval(() => {
            void refreshGameRunningStatus();
            void refreshModsPathMigrationStatus();
        }, 3000);

        if (state.stellarisyncPollingHandle) clearInterval(state.stellarisyncPollingHandle);
        state.stellarisyncPollingHandle = setInterval(() => void refreshStellarisyncStatus(), 120000);

        if (state.settingsModel?.autoCheckAppUpdates !== false) {
            void checkForAppUpdates("auto");
        }
    }

    return { init };
}
