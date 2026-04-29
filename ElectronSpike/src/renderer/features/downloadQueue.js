import { byId } from "../runtime/dom.js";
import { setDataIcon } from "../runtime/icons.js";
import { showModal } from "../runtime/modal.js";
import {
    getDefaultSettingsModel
} from "../runtime/settingsModel.js";
import { state } from "../runtime/state.js";
import {
    setGlobalStatus,
    setLibraryStatus,
    setSettingsStatus,
    setVersionStatus
} from "../runtime/status.js";
import {
    buildQueueMessageForDisplay,
    formatQueueUpdatedAt,
    partitionQueueItems,
    queueActionLabel,
    queueClampProgress,
    queueProgressMode,
    queueStatusLabel
} from "../runtime/queueFormatting.js";
import {
    isValidWorkshopId,
    normalizeWorkshopId
} from "../runtime/workshopInput.js";

const downloadQueueState = globalThis.downloadQueueState || {};

export function createDownloadQueueController({
    activateTab,
    isDeveloperModeEnabled,
    refreshDetailDrawer,
    refreshLibrarySnapshot,
    revealNewlyAddedDisabledMods,
    syncDownloadFailureNotice,
    syncVisibleVersionCardActionStates
}) {
    function getModNameByWorkshopId(workshopId) {
        const fromLib = (state.library.snapshot?.mods ?? []).find((m) => m.workshopId === workshopId);
        if (fromLib) return fromLib.name;
        const fromCards = state.activeCards.find((c) => c.workshopId === workshopId);
        if (fromCards) return fromCards.name;
        return workshopId;
    }

    function triggerTransientClass(target, className, duration = 420) {
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const timers = target.__smmTransientClassTimers || (target.__smmTransientClassTimers = {});
        if (timers[className]) {
            clearTimeout(timers[className]);
        }

        target.classList.remove(className);
        void target.offsetWidth;
        target.classList.add(className);

        timers[className] = window.setTimeout(() => {
            target.classList.remove(className);
            delete timers[className];
        }, duration);
    }

    function captureQueueRowLayout() {
        const layout = new Map();

        for (const [workshopId, view] of state.queueRowsByWorkshopId.entries()) {
            if (!view?.root?.isConnected) {
                continue;
            }

            layout.set(workshopId, view.root.getBoundingClientRect());
        }

        return layout;
    }

    function animateQueueRowLayout(previousLayout) {
        if (!(previousLayout instanceof Map) || previousLayout.size === 0) {
            return;
        }

        for (const [workshopId, view] of state.queueRowsByWorkshopId.entries()) {
            if (!view?.root?.isConnected) {
                continue;
            }

            const before = previousLayout.get(workshopId);
            if (!before) {
                continue;
            }

            const after = view.root.getBoundingClientRect();
            const deltaX = before.left - after.left;
            const deltaY = before.top - after.top;

            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
                continue;
            }

            if (typeof view.root.animate !== "function") {
                continue;
            }

            if (view.layoutAnimation) {
                try { view.layoutAnimation.cancel(); } catch { /* ignore */ }
            }

            const animation = view.root.animate([
                {
                    transform: `translate(${deltaX}px, ${deltaY}px)`,
                    opacity: 0.7
                },
                {
                    transform: "translate(0, 0)",
                    opacity: 1
                }
            ], {
                duration: 350,
                easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
            });
            view.layoutAnimation = animation;
            animation.onfinish = animation.oncancel = () => {
                if (view.layoutAnimation === animation) {
                    view.layoutAnimation = null;
                }
            };
        }
    }

    function createQueueEmptyState(message, iconName = "queue") {
        const empty = document.createElement("div");
        empty.className = "queue-empty";

        const icon = document.createElement("span");
        icon.className = "queue-empty-icon";
        setDataIcon(icon, iconName);

        const label = document.createElement("span");
        label.textContent = message;

        empty.append(icon, label);
        return empty;
    }

    function createQueueRow(workshopId) {
        const root = document.createElement("article");
        root.className = "queue-item";
        root.setAttribute("data-workshop-id", workshopId);

        const top = document.createElement("div");
        top.className = "queue-item-top";

        const idEl = document.createElement("span");
        idEl.className = "queue-id";

        const stageEl = document.createElement("span");
        stageEl.className = "queue-stage";

        top.append(idEl, stageEl);

        const progress = document.createElement("div");
        progress.className = "queue-progress";
        const progressBar = document.createElement("span");
        progress.append(progressBar);

        const meta = document.createElement("div");
        meta.className = "queue-item-meta";

        const actionEl = document.createElement("span");
        actionEl.className = "queue-item-action";

        const bytesEl = document.createElement("span");
        bytesEl.className = "queue-item-bytes mono";

        const percentEl = document.createElement("span");
        percentEl.className = "queue-item-percent mono";

        meta.append(actionEl, bytesEl, percentEl);

        const messageEl = document.createElement("p");
        messageEl.className = "queue-item-message muted";

        const footer = document.createElement("div");
        footer.className = "queue-item-footer";

        const workshopEl = document.createElement("p");
        workshopEl.className = "muted mono queue-item-workshop";

        const actionsEl = document.createElement("div");
        actionsEl.className = "queue-item-actions";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "button-secondary queue-item-btn queue-btn-cancel";
        cancelBtn.textContent = "Stop";
        cancelBtn.title = "Cancel this download";
        cancelBtn.setAttribute("aria-label", "Cancel this download");
        cancelBtn.addEventListener("click", () => void cancelQueueAction(workshopId));

        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "button-secondary queue-item-btn";
        retryBtn.textContent = "Retry";
        retryBtn.title = "Retry this operation";
        retryBtn.setAttribute("aria-label", "Retry this operation");
        retryBtn.addEventListener("click", () => {
            const action = retryBtn.getAttribute("data-queue-action") || "";
            if (action !== "install" && action !== "uninstall") return;
            void queueAction(workshopId, action, "downloads");
        });

        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "button-secondary queue-item-btn";
        dismissBtn.textContent = "Hide";
        dismissBtn.title = "Remove from history";
        dismissBtn.setAttribute("aria-label", "Remove from history");
        dismissBtn.addEventListener("click", () => void clearQueueHistory([workshopId]));

        actionsEl.append(cancelBtn, retryBtn, dismissBtn);
        footer.append(workshopEl, actionsEl);

        root.append(top, progress, meta, messageEl, footer);

        return {
            root,
            idEl,
            stageEl,
            actionEl,
            bytesEl,
            percentEl,
            messageEl,
            progressBar,
            workshopEl,
            cancelBtn,
            retryBtn,
            dismissBtn,
            lastStatus: null,
            lastProgress: null,
            lastProgressMode: "determinate",
            lastMessage: "",
            layoutAnimation: null
        };
    }

    function updateQueueRow(view, item) {
        const status = String(item.status || "queued").toLowerCase();
        const progress = queueClampProgress(item.progress);
        const progressMode = queueProgressMode(item);
        const isActive = status === "queued" || status === "running";
        const canRetry = status === "failed" || status === "cancelled";
        const developerModeEnabled = isDeveloperModeEnabled();
        const previousStatus = view.lastStatus;
        const previousProgress = view.lastProgress;
        const previousProgressMode = view.lastProgressMode;
        const previousMessage = view.lastMessage;
        const nextMessage = buildQueueMessageForDisplay(item, developerModeEnabled);

        view.root.setAttribute("data-status", status);
        view.root.setAttribute("data-progress-mode", progressMode);

        const name = item.modName || getModNameByWorkshopId(item.workshopId);
        view.idEl.textContent = name;
        view.idEl.title = `${name} (${item.workshopId})`;

        view.stageEl.textContent = queueStatusLabel(status);
        view.stageEl.setAttribute("data-status", status);

        view.actionEl.textContent = queueActionLabel(item.action);
        if (view.percentEl) view.percentEl.hidden = true;
        if (view.bytesEl) view.bytesEl.hidden = true;

        view.messageEl.textContent = nextMessage;
        view.progressBar.style.width = `${progress}%`;

        view.workshopEl.textContent = item.workshopId;
        view.workshopEl.title = item.workshopId;
        view.workshopEl.hidden = !developerModeEnabled;

        view.cancelBtn.hidden = !isActive;
        view.cancelBtn.disabled = !isActive;

        view.retryBtn.hidden = !canRetry;
        view.retryBtn.disabled = !canRetry;
        view.retryBtn.title = item.action === "uninstall" ? "Retry uninstall" : "Retry install";
        view.retryBtn.setAttribute("data-queue-action", item.action);

        view.dismissBtn.hidden = isActive;
        view.dismissBtn.disabled = isActive;

        if (previousStatus && previousStatus !== status) {
            triggerTransientClass(view.root, "is-status-shifting", 560);
            if (status === "completed") {
                triggerTransientClass(view.root, "is-completing", 780);
            } else if (status === "failed" || status === "cancelled") {
                triggerTransientClass(view.root, "is-attention", 780);
            }
        } else if (
            status === "running"
            && previousStatus === status
            && (previousProgress !== progress || previousMessage !== nextMessage || previousProgressMode !== progressMode)
        ) {
            triggerTransientClass(view.root, "is-progressing", 420);
            triggerTransientClass(view.progressBar, "is-live", 420);
        } else if (status === "queued" && previousStatus === status && previousMessage !== nextMessage) {
            triggerTransientClass(view.stageEl, "is-soft-pulse", 360);
        }

        view.lastStatus = status;
        view.lastProgress = progress;
        view.lastProgressMode = progressMode;
        view.lastMessage = nextMessage;
    }

    function syncQueueSection(container, sectionItems, emptyLabel, emptyIconName) {
        if (!container) {
            return;
        }

        if (sectionItems.length === 0) {
            for (const child of Array.from(container.children)) {
                child.remove();
            }
            container.appendChild(createQueueEmptyState(emptyLabel, emptyIconName));
            return;
        }

        for (const empty of Array.from(container.querySelectorAll(".queue-empty"))) {
            empty.remove();
        }

        const desiredIds = new Set();

        let currentChild = container.firstElementChild;

        for (const item of sectionItems) {
            desiredIds.add(item.workshopId);

            let view = state.queueRowsByWorkshopId.get(item.workshopId);
            if (!view) {
                view = createQueueRow(item.workshopId);
                state.queueRowsByWorkshopId.set(item.workshopId, view);
            }

            const previousParent = view.root.parentElement;
            updateQueueRow(view, item);

            if (currentChild === view.root) {
                currentChild = currentChild.nextElementSibling;
            } else {
                container.insertBefore(view.root, currentChild);
            }

            if (previousParent && previousParent !== container) {
                triggerTransientClass(view.root, "is-section-moving", 520);
            }
        }

        for (const child of Array.from(container.children)) {
            if (!(child instanceof HTMLElement)) {
                continue;
            }

            if (child.classList.contains("queue-empty")) {
                child.remove();
                continue;
            }

            const workshopId = child.getAttribute("data-workshop-id") || "";
            if (!desiredIds.has(workshopId)) {
                child.remove();
            }
        }
    }

    function renderQueueList(snapshot) {
        const previousLayout = captureQueueRowLayout();
        const summary = byId("queueSummary");
        const queueActiveList = byId("queueActiveList");
        const queueHistoryList = byId("queueHistoryList");
        const queueChip = byId("statusbarQueue");
        const queueLoadChip = byId("queueLoadChip");
        const queueOverallLabel = byId("queueOverallLabel");
        const queueOverallBar = byId("queueOverallBar");
        const queueCancelAll = byId("queueCancelAll");
        const queueClearFinished = byId("queueClearFinished");
        const queueActiveSummary = byId("queueActiveSummary");
        const queueHistorySummary = byId("queueHistorySummary");
        const queueActiveCountChip = byId("queueActiveCountChip");
        const queueHistoryCountChip = byId("queueHistoryCountChip");
        const queueMetricRunning = byId("queueMetricRunning");
        const queueMetricQueued = byId("queueMetricQueued");
        const queueMetricFinished = byId("queueMetricFinished");
        const queueMetricFailed = byId("queueMetricFailed");
        const queueLastUpdated = byId("queueLastUpdated");

        const items = Array.isArray(snapshot.items) ? snapshot.items : [];
        const partitioned = partitionQueueItems(items);
        const activeItems = partitioned.active;
        const historyItems = partitioned.history;
        const runningCount = Number.isFinite(snapshot.runningCount)
            ? snapshot.runningCount
            : items.filter((i) => i.status === "running").length;
        const queuedCount = Number.isFinite(snapshot.queuedCount)
            ? snapshot.queuedCount
            : items.filter((i) => i.status === "queued").length;
        const pendingCount = Number.isFinite(snapshot.pendingCount) ? snapshot.pendingCount : queuedCount;
        const finished = Number.isFinite(snapshot.finishedCount)
            ? snapshot.finishedCount
            : items.filter((i) => i.status === "completed" || i.status === "failed" || i.status === "cancelled").length;
        const failedCount = Number.isFinite(snapshot.failedCount)
            ? snapshot.failedCount
            : items.filter((i) => i.status === "failed").length;
        const totalTracked = Number.isFinite(snapshot.totalTrackedCount) ? snapshot.totalTrackedCount : items.length;
        const active = runningCount + queuedCount;

        if (queueChip) queueChip.textContent = active > 0 ? `Queue ${active} active` : "Queue idle";
        if (queueLoadChip) {
            queueLoadChip.classList.remove("status-chip-muted", "status-chip-warn", "status-chip-success");
            if (active > 0) {
                queueLoadChip.classList.add("status-chip-warn");
                queueLoadChip.textContent = `${active} active`;
            } else if (totalTracked > 0) {
                queueLoadChip.classList.add("status-chip-success");
                queueLoadChip.textContent = `${finished} done`;
            } else {
                queueLoadChip.classList.add("status-chip-muted");
                queueLoadChip.textContent = "Idle";
            }
        }

        if (summary) {
            if (totalTracked === 0) {
                summary.textContent = "No download activity yet.";
            } else if (active > 0) {
                const slotText = runningCount > 0 ? `${runningCount} running right now` : "";
                const queueText = pendingCount > 0 ? `${pendingCount} waiting next` : "";
                const parts = [slotText, queueText].filter(Boolean);
                summary.textContent = parts.join(" | ") + (finished > 0 ? ` | ${finished} recent` : "");
            } else {
                summary.textContent = failedCount > 0
                    ? `Queue is idle. ${failedCount} recent failure${failedCount === 1 ? "" : "s"} need attention.`
                    : `Queue is idle. ${finished} recent operation${finished === 1 ? "" : "s"} finished cleanly.`;
            }
        }

        if (queueMetricRunning) queueMetricRunning.textContent = String(runningCount);
        if (queueMetricQueued) queueMetricQueued.textContent = String(pendingCount);
        if (queueMetricFinished) queueMetricFinished.textContent = String(finished);
        if (queueMetricFailed) queueMetricFailed.textContent = String(failedCount);
        if (queueActiveCountChip) queueActiveCountChip.textContent = `${activeItems.length} active`;
        if (queueHistoryCountChip) queueHistoryCountChip.textContent = `${historyItems.length} recent`;

        if (queueCancelAll) queueCancelAll.disabled = active === 0;
        if (queueClearFinished) queueClearFinished.disabled = finished === 0;

        const overallModel = typeof downloadQueueState.getQueueOverallProgressModel === "function"
            ? downloadQueueState.getQueueOverallProgressModel(items)
            : {
                percent: activeItems.length === 0
                    ? 0
                    : Math.round(activeItems.reduce((sum, item) => sum + queueClampProgress(item.progress), 0) / activeItems.length),
                source: activeItems.length > 0 ? "running" : "none",
                count: activeItems.length,
                indeterminate: false
            };
        const overallPct = overallModel.percent;

        if (queueOverallBar) {
            queueOverallBar.setAttribute("data-progress-mode", "determinate");
            queueOverallBar.style.width = `${overallPct}%`;
        }

        if (queueOverallLabel) {
            if (totalTracked === 0) queueOverallLabel.textContent = "No queue activity.";
            else if (active > 0 && overallModel.source === "running-indeterminate") {
                queueOverallLabel.textContent = `${overallModel.count} live operation${overallModel.count === 1 ? "" : "s"} running...`;
            }
            else if (active > 0 && overallModel.source === "running") {
                queueOverallLabel.textContent = `Processing ${overallModel.count} live operation${overallModel.count === 1 ? "" : "s"}...`;
            } else if (active > 0) {
                queueOverallLabel.textContent = `${pendingCount} queued operation${pendingCount === 1 ? "" : "s"} waiting for a download slot.`;
            }
            else queueOverallLabel.textContent = `${finished} recent operation${finished === 1 ? "" : "s"} tracked here.`;
        }

        if (queueLastUpdated) {
            const newestItemUpdate = items
                .map((item) => String(item.updatedAtUtc || ""))
                .filter((value) => value.length > 0)
                .sort()
                .at(-1);
            const updatedAt = newestItemUpdate || snapshot.updatedAtUtc || "";
            queueLastUpdated.textContent = `Last update: ${formatQueueUpdatedAt(updatedAt)}`;
        }

        if (queueActiveSummary) {
            queueActiveSummary.textContent = active > 0
                ? `${runningCount} running and ${pendingCount} queued.`
                : "No active operations.";
        }

        if (queueHistorySummary) {
            queueHistorySummary.textContent = historyItems.length > 0
                ? `${historyItems.length} recent operation${historyItems.length === 1 ? "" : "s"} kept for review.`
                : "No recent history yet.";
        }

        if (!queueActiveList || !queueHistoryList) return;

        if (totalTracked === 0) {
            for (const [, view] of state.queueRowsByWorkshopId.entries()) {
                view.root.remove();
            }
            state.queueRowsByWorkshopId.clear();
            syncQueueSection(queueActiveList, [], "No active operations.", "queue");
            syncQueueSection(queueHistoryList, [], "No recent history yet.", "check");
            return;
        }

        const statusOrder = { running: 0, queued: 1, failed: 2, cancelled: 3, completed: 4 };
        const sortedActiveItems = [...activeItems].sort((a, b) =>
            (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)
        );
        const sortedHistoryItems = [...historyItems].sort((a, b) =>
            (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5)
        );

        syncQueueSection(queueActiveList, sortedActiveItems, "No active operations.", "queue");
        syncQueueSection(queueHistoryList, sortedHistoryItems, "No recent history yet.", "check");

        const renderedIds = new Set(items.map((item) => item.workshopId));
        for (const [workshopId, view] of state.queueRowsByWorkshopId.entries()) {
            if (renderedIds.has(workshopId)) continue;
            view.root.remove();
            state.queueRowsByWorkshopId.delete(workshopId);
        }

        animateQueueRowLayout(previousLayout);
    }

    async function refreshQueueSnapshot() {
        try {
            const snapshot = await window.spikeApi.getDownloadQueueSnapshot();
            applyQueueSnapshot(snapshot);
        } catch { /* ignore */ }
    }

    function applyQueueSnapshot(snapshot) {
        state.queueSnapshot = snapshot;
        renderQueueList(snapshot);
        syncVisibleVersionCardActionStates();
        syncDownloadFailureNotice(snapshot);

        const completedOps = (snapshot.items || [])
            .filter((item) => item.status === "completed" && (item.action === "install" || item.action === "uninstall"))
            .map((item) => `${item.workshopId}:${item.action}:${item.updatedAtUtc}`)
            .sort();
        const completedOpsKey = completedOps.join("|");

        if (completedOpsKey && completedOpsKey !== state.queueLibrarySyncKey && !state.queueLibrarySyncInFlight) {
            state.queueLibrarySyncKey = completedOpsKey;
            state.queueLibrarySyncInFlight = true;
            void (async () => {
                const previousLibrarySnapshot = state.library.snapshot;
                try {
                    await window.spikeApi.scanLocalMods();
                    await refreshLibrarySnapshot();
                    await revealNewlyAddedDisabledMods(previousLibrarySnapshot);
                } finally {
                    state.queueLibrarySyncInFlight = false;
                }
            })();
        }

        state.queueHadActiveWork = snapshot.hasActiveWork === true;
    }

    function setQueueActionStatus(source, message) {
        if (source === "library") {
            setLibraryStatus(message);
            return;
        }

        if (source === "downloads") {
            setGlobalStatus(message);
            return;
        }

        setVersionStatus(message);
    }

    function getInstallPrerequisiteStateForRenderer(settings) {
        const helper = window.installPrerequisites?.getInstallPrerequisiteState;
        if (typeof helper === "function") {
            return helper(settings);
        }

        return {
            canInstall: true,
            missingModsPath: false,
            missingSteamCmd: false,
            message: ""
        };
    }

    async function ensureInstallPrerequisitesConfigured(action) {
        if (action !== "install") {
            return { ok: true, message: "" };
        }

        const prerequisiteState = getInstallPrerequisiteStateForRenderer(
            state.settingsModel || getDefaultSettingsModel()
        );
        if (prerequisiteState.canInstall) {
            return { ok: true, message: "" };
        }

        const shouldOpenSettings = await showModal(
            "Settings required",
            prerequisiteState.message,
            "Go to Settings",
            "Cancel"
        );
        if (shouldOpenSettings) {
            activateTab("settings");
            setSettingsStatus(prerequisiteState.message);
        }

        return {
            ok: false,
            blockedBySettings: true,
            message: prerequisiteState.message
        };
    }

    async function queueDownloadAction(request) {
        const prerequisiteResult = await ensureInstallPrerequisitesConfigured(request.action);
        if (!prerequisiteResult.ok) {
            return {
                ok: false,
                workshopId: request.workshopId,
                actionState: "not-installed",
                message: prerequisiteResult.message,
                blockedBySettings: true
            };
        }

        return window.spikeApi.queueDownload(request);
    }

    async function queueAction(workshopId, action, source = "version") {
        const normalizedWorkshopId = normalizeWorkshopId(workshopId);
        if (!isValidWorkshopId(normalizedWorkshopId)) {
            const message = "Invalid workshop ID. Paste the numeric ID or a Steam Workshop URL.";
            setQueueActionStatus(source, message);
            return;
        }

        const modName = getModNameByWorkshopId(normalizedWorkshopId);
        const result = await queueDownloadAction({ workshopId: normalizedWorkshopId, modName, action });
        setQueueActionStatus(source, result.message);
        if (result.blockedBySettings) {
            return;
        }

        await refreshQueueSnapshot();
        if (state.activeDetailWorkshopId === normalizedWorkshopId) await refreshDetailDrawer(normalizedWorkshopId);
        if (source === "library") await refreshLibrarySnapshot();
    }

    async function cancelQueueAction(workshopId) {
        const result = await window.spikeApi.cancelDownload(workshopId);
        setGlobalStatus(result.message);
        await refreshQueueSnapshot();
        if (state.activeDetailWorkshopId === workshopId) await refreshDetailDrawer(workshopId);
    }

    async function cancelAllQueueActions() {
        const result = await window.spikeApi.cancelAllDownloads();
        setGlobalStatus(result.message);
        await refreshQueueSnapshot();
        if (state.activeDetailWorkshopId) await refreshDetailDrawer(state.activeDetailWorkshopId);
    }

    async function clearQueueHistory(workshopIds) {
        const result = await window.spikeApi.clearDownloadHistory(workshopIds);
        setGlobalStatus(result.message);
        await refreshQueueSnapshot();
    }

    return {
        applyQueueSnapshot,
        cancelAllQueueActions,
        cancelQueueAction,
        clearQueueHistory,
        getModNameByWorkshopId,
        queueAction,
        queueDownloadAction,
        refreshQueueSnapshot
    };
}
