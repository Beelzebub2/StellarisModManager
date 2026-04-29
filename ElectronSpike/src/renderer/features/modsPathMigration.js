import { byId, escapeHtml } from "../runtime/dom.js";
import { showChoiceModal } from "../runtime/modal.js";
import { normalizeSettingsPathKey } from "../runtime/settingsModel.js";
import { state } from "../runtime/state.js";
import { setGlobalStatus, setSettingsStatus } from "../runtime/status.js";

export function createModsPathMigrationController({
    applySettingsToForm,
    refreshLibrarySnapshot,
    refreshSettingsPage,
    syncLaunchGameAvailability
}) {
    function getModsPathMigrationBusyMessage(migration = state.modsPathMigration) {
        return migration.moveExistingMods === true
            ? "Moving managed mods to the new managed mods folder..."
            : "Updating managed descriptor paths for the new managed mods folder...";
    }

    function getModsPathMigrationTitle(migration = state.modsPathMigration) {
        return migration.moveExistingMods === true
            ? "Moving managed mods"
            : "Updating managed mod paths";
    }

    function getModsPathMigrationCurrentActionLabel(migration = state.modsPathMigration) {
        return migration.moveExistingMods === true
            ? "Currently moving"
            : "Currently updating";
    }

    function getModsPathMigrationCountLabel(migration = state.modsPathMigration) {
        const processed = Math.max(0, Number(migration.processedModCount || 0));
        const total = Math.max(0, Number(migration.totalModCount || 0));
        if (total <= 0) {
            return "Preparing mod list...";
        }

        return `${processed} of ${total} mods complete`;
    }

    function getModsPathMigrationPercentLabel(migration = state.modsPathMigration) {
        const percent = Math.max(0, Math.min(100, Math.round(Number(migration.progressPercent || 0))));
        return `${percent}% complete`;
    }

    function syncModsPathMigrationPolling() {
        if (state.modsPathMigration.active) {
            if (state.modsPathMigrationPollingHandle) {
                return;
            }

            state.modsPathMigrationPollingHandle = setInterval(() => void refreshModsPathMigrationStatus(), 750);
            return;
        }

        if (state.modsPathMigrationPollingHandle) {
            clearInterval(state.modsPathMigrationPollingHandle);
            state.modsPathMigrationPollingHandle = null;
        }
    }

    function renderModsPathMigrationProgress() {
        if (!state.modsPathMigration.modalVisible || !state.modsPathMigration.active) {
            return;
        }

        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const confirmBtn = byId("modalConfirm");
        const phaseEl = byId("modsPathMigrationPhase");
        const currentModEl = byId("modsPathMigrationCurrentMod");
        const countEl = byId("modsPathMigrationCount");
        const percentEl = byId("modsPathMigrationPercent");
        const progressBar = byId("modsPathMigrationBar");

        if (titleEl) titleEl.textContent = getModsPathMigrationTitle();
        if (msgEl) msgEl.textContent = getModsPathMigrationBusyMessage();
        if (confirmBtn) {
            confirmBtn.textContent = state.modsPathMigration.backgrounded ? "Hide" : "Run in background";
        }
        if (phaseEl) {
            phaseEl.textContent = state.modsPathMigration.currentPhase || "Preparing";
        }
        if (currentModEl) {
            const modName = state.modsPathMigration.currentModName || "Preparing mod list...";
            currentModEl.innerHTML = `<strong>${escapeHtml(getModsPathMigrationCurrentActionLabel())}:</strong> ${escapeHtml(modName)}`;
        }
        if (countEl) {
            countEl.textContent = getModsPathMigrationCountLabel();
        }
        if (percentEl) {
            percentEl.textContent = getModsPathMigrationPercentLabel();
        }
        if (progressBar) {
            const percent = Math.max(0, Math.min(100, Math.round(Number(state.modsPathMigration.progressPercent || 0))));
            progressBar.setAttribute("data-progress-mode", state.modsPathMigration.totalModCount > 0 ? "determinate" : "indeterminate");
            progressBar.style.width = state.modsPathMigration.totalModCount > 0 ? `${Math.max(percent, 4)}%` : "";
        }
    }

    function renderModsPathMigrationBackgroundNotice() {
        const notice = byId("modsPathMigrationNotice");
        const titleEl = byId("modsPathMigrationNoticeTitle");
        const messageEl = byId("modsPathMigrationNoticeMessage");
        const openBtn = byId("modsPathMigrationNoticeOpen");
        if (!notice || !titleEl || !messageEl || !openBtn) {
            return;
        }

        const shouldShow = state.modsPathMigration.active
            && state.modsPathMigration.backgrounded
            && !state.modsPathMigration.modalVisible;

        notice.classList.toggle("hidden", !shouldShow);
        if (!shouldShow) {
            return;
        }

        titleEl.textContent = state.modsPathMigration.currentModName || getModsPathMigrationTitle();
        messageEl.textContent = `${state.modsPathMigration.currentPhase || "Working"} | ${getModsPathMigrationPercentLabel()}`;
        openBtn.textContent = "Open progress";
    }

    function hideModsPathMigrationModal() {
        const overlay = byId("modalOverlay");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        state.modsPathMigration.modalVisible = false;
        if (overlay) overlay.classList.add("hidden");
        if (extra) extra.innerHTML = "";
        if (confirmBtn) {
            confirmBtn.onclick = null;
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Confirm";
        }
        if (cancelBtn) {
            cancelBtn.onclick = null;
            cancelBtn.disabled = false;
            cancelBtn.classList.remove("hidden");
            cancelBtn.textContent = "Cancel";
        }
        if (altBtn) {
            altBtn.onclick = null;
            altBtn.classList.add("hidden");
            altBtn.textContent = "Alternate";
        }
        if (backdrop) backdrop.onclick = null;
        renderModsPathMigrationBackgroundNotice();
    }

    function showModsPathMigrationProgressModal() {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        state.modsPathMigration.modalVisible = true;

        if (titleEl) titleEl.textContent = getModsPathMigrationTitle();
        if (msgEl) msgEl.textContent = getModsPathMigrationBusyMessage();
        if (confirmBtn) {
            confirmBtn.textContent = state.modsPathMigration.backgrounded ? "Hide" : "Run in background";
            confirmBtn.disabled = false;
        }
        if (cancelBtn) {
            cancelBtn.classList.add("hidden");
            cancelBtn.disabled = true;
            cancelBtn.onclick = null;
        }
        if (altBtn) {
            altBtn.classList.add("hidden");
            altBtn.onclick = null;
            altBtn.textContent = "Alternate";
        }
        if (extra) {
            extra.innerHTML = [
                '<div class="migration-progress-shell">',
                '  <div class="migration-progress-copy">',
                '    <p class="muted">This can take a while for large mod folders. Descriptor files stay in the Paradox Documents folder while the managed mod contents are updated here.</p>',
                `    <p class="muted"><strong>Target managed folder:</strong> <code>${escapeHtml(state.modsPathMigration.targetModsPath || "Not set")}</code></p>`,
                state.modsPathMigration.sourceModsPath
                    ? `    <p class="muted"><strong>Current managed folder:</strong> <code>${escapeHtml(state.modsPathMigration.sourceModsPath)}</code></p>`
                    : "",
                '    <p id="modsPathMigrationPhase" class="migration-progress-phase">Preparing</p>',
                '    <p id="modsPathMigrationCurrentMod" class="migration-progress-current muted">Currently moving: Preparing mod list...</p>',
                '    <div class="migration-progress-meta">',
                '      <span id="modsPathMigrationCount" class="muted">Preparing mod list...</span>',
                '      <strong id="modsPathMigrationPercent">0% complete</strong>',
                '    </div>',
                '  </div>',
                '  <div class="migration-progress-track" aria-hidden="true"><span id="modsPathMigrationBar" data-progress-mode="indeterminate"></span></div>',
                '</div>'
            ].filter(Boolean).join("");
        }
        if (backdrop) backdrop.onclick = null;
        if (overlay) overlay.classList.remove("hidden");

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                state.modsPathMigration.backgrounded = true;
                hideModsPathMigrationModal();
                setSettingsStatus(`${getModsPathMigrationBusyMessage()} Running in background.`);
                setGlobalStatus(`${getModsPathMigrationBusyMessage()} Running in background.`);
            };
        }

        renderModsPathMigrationProgress();
        renderModsPathMigrationBackgroundNotice();
    }

    function applyModsPathMigrationStatus(status) {
        state.modsPathMigration = {
            ...state.modsPathMigration,
            ...(status || {})
        };
        syncLaunchGameAvailability();
        renderModsPathMigrationProgress();
        renderModsPathMigrationBackgroundNotice();
        syncModsPathMigrationPolling();
    }

    async function refreshModsPathMigrationStatus() {
        try {
            const status = await window.spikeApi.getModsPathMigrationStatus();
            applyModsPathMigrationStatus(status);
        } catch {
            // ignore polling errors; the next explicit refresh will reconcile state.
        }
    }

    function didModsPathChange(nextSettings) {
        return normalizeSettingsPathKey(state.settingsModel?.managedModsPath)
            !== normalizeSettingsPathKey(nextSettings?.managedModsPath);
    }

    async function promptForModsPathMigration(nextSettings) {
        const currentModsPath = String(state.settingsModel?.managedModsPath || "").trim();
        const nextModsPath = String(nextSettings?.managedModsPath || "").trim();

        return showChoiceModal(
            "Change managed mods folder",
            "You changed the managed mods folder. Do you want to move the existing managed mod folders into the new location too?",
            {
                confirmLabel: "Yes, move folders",
                alternateLabel: "No, only rewrite paths",
                cancelLabel: "Cancel",
                detailHtml: [
                    "<p><code>.mod</code> descriptor files stay in the Paradox Documents <code>mod</code> folder.</p>",
                    "<p><strong>Yes, move folders</strong> copies the existing managed mod folders into the new location and rewrites each descriptor <code>path=</code> line for you.</p>",
                    "<p><strong>No, only rewrite paths</strong> keeps the folders where they are and only rewrites descriptor paths. Use that if you plan to move the folders yourself.</p>",
                    currentModsPath ? `<p><strong>Current folder:</strong> <code>${escapeHtml(currentModsPath)}</code></p>` : "",
                    nextModsPath ? `<p><strong>New folder:</strong> <code>${escapeHtml(nextModsPath)}</code></p>` : ""
                ].filter(Boolean).join("")
            }
        );
    }

    async function finalizeModsPathMigration(result) {
        state.modsPathMigration.pendingPromise = null;
        state.modsPathMigration.modalVisible = false;
        state.modsPathMigration.backgrounded = false;
        hideModsPathMigrationModal();
        await refreshModsPathMigrationStatus();

        if (!result?.ok) {
            const message = String(result?.message || "Failed to change managed mods folder.");
            setSettingsStatus(message);
            setGlobalStatus(message);
            await refreshSettingsPage();
            return;
        }

        applySettingsToForm(result.settings);
        setSettingsStatus(result.message);
        setGlobalStatus(result.message);
        await refreshLibrarySnapshot();
    }

    async function beginModsPathMigrationSave(nextSettings, moveExistingMods) {
        if (state.modsPathMigration.active) {
            setSettingsStatus("A managed mods folder change is already running.");
            return false;
        }

        const gameRunning = await window.spikeApi.getGameRunningStatus();
        state.gameRunning = gameRunning;
        syncLaunchGameAvailability();
        if (gameRunning) {
            setSettingsStatus("Close Stellaris before changing the managed mods folder.");
            return false;
        }

        const initialStatus = {
            active: true,
            sourceModsPath: String(state.settingsModel?.managedModsPath || "").trim() || null,
            targetModsPath: String(nextSettings?.managedModsPath || "").trim() || null,
            moveExistingMods: moveExistingMods === true,
            startedAtUtc: new Date().toISOString(),
            completedAtUtc: null,
            lastMessage: getModsPathMigrationBusyMessage({ moveExistingMods }),
            currentModName: null,
            currentPhase: null,
            processedModCount: 0,
            totalModCount: 0,
            progressPercent: 0
        };

        applySettingsToForm(nextSettings);
        applyModsPathMigrationStatus(initialStatus);
        showModsPathMigrationProgressModal();

        const busyMessage = getModsPathMigrationBusyMessage(initialStatus);
        setSettingsStatus(busyMessage);
        setGlobalStatus(busyMessage);

        const migrationPromise = window.spikeApi.migrateModsPath({
            settings: nextSettings,
            moveExistingMods
        });
        state.modsPathMigration.pendingPromise = migrationPromise;

        void migrationPromise
            .then((result) => finalizeModsPathMigration(result))
            .catch((error) => finalizeModsPathMigration({
                ok: false,
                message: error instanceof Error ? error.message : String(error || "Unknown mods-path migration error"),
                settings: nextSettings,
                movedModCount: 0,
                rewrittenDescriptorCount: 0
            }));

        return true;
    }

    return {
        beginModsPathMigrationSave,
        didModsPathChange,
        promptForModsPathMigration,
        refreshModsPathMigrationStatus,
        showModsPathMigrationProgressModal
    };
}
