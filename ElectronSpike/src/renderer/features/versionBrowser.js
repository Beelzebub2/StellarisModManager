import { byId, escapeHtml, setText } from "../runtime/dom.js";
import { state } from "../runtime/state.js";
import { setResultSummary, setVersionStatus } from "../runtime/status.js";
import {
    clearVersionLoadingDelay,
    renderVersionFeedbackCard,
    resetVersionCardsLoadingState,
    scheduleVersionLoadingSkeleton,
    setLoadingState
} from "../runtime/versionLoading.js";

export function actionLabel(actionState) {
    switch (actionState) {
        case "queued": return "Queued";
        case "installing": return "Installing...";
        case "installed": return "Installed";
        case "uninstalling": return "Removing...";
        case "error": return "Retry";
        default: return "Install";
    }
}

export function actionIntent(actionState) {
    return actionState === "installed" ? "uninstall" : "install";
}

export function actionButtonClass(actionState) {
    switch (actionState) {
        case "installed":
            return "mod-action-btn mod-action-installed";
        case "queued":
        case "installing":
            return "mod-action-btn mod-action-installing";
        case "uninstalling":
            return "mod-action-btn mod-action-uninstalling";
        case "error":
            return "mod-action-btn mod-action-error";
        default:
            return "mod-action-btn mod-action-install";
    }
}

export function actionIsDisabled(actionState) {
    return actionState === "queued" || actionState === "installing" || actionState === "uninstalling";
}

export function normalizeDetectedGameVersion(rawVersion) {
    const value = String(rawVersion || "").trim();
    if (!value) return null;

    const match = value.match(/(\d+)\.(\d+)(?:\.\d+)?/);
    if (!match) return null;

    return `${match[1]}.${match[2]}`;
}

export function applyInstalledHoverLabel(button, actionState) {
    if (!button) return;

    if (actionState === "installed" && !button.disabled) {
        button.onmouseenter = () => {
            button.textContent = "Uninstall";
        };
        button.onmouseleave = () => {
            button.textContent = "Installed";
        };
        return;
    }

    button.onmouseenter = null;
    button.onmouseleave = null;
}

export function createVersionBrowserController({
    activateTab,
    queueAction,
    refreshDetailDrawer
}) {
    async function bootstrapSelectedVersionFromSettings() {
        try {
            const settings = await window.spikeApi.getSettings();
            const detected = normalizeDetectedGameVersion(settings?.lastDetectedGameVersion);
            if (detected) {
                state.selectedVersion = detected;
            }

            if (settings) {
                state.library.showEnabledOnly = settings.hideDisabledMods === true;
                const toggle = byId("libraryEnabledOnly");
                if (toggle) toggle.checked = state.library.showEnabledOnly;
            }
        } catch {
            // keep default selected version
        }
    }

    function openWorkshopFromVersionCard(workshopId, workshopUrl, container) {
        const url = String(workshopUrl || "").trim();
        if (!url) {
            return;
        }

        const scrollTop = container ? container.scrollTop : 0;
        state.workshopReturnContext = {
            fromTab: "version",
            workshopId,
            scrollTop
        };

        activateTab("workshop");
        const webview = byId("workshopWebview");
        if (webview) {
            webview.loadURL(url);
        }

        const urlInput = byId("workshopUrl");
        if (urlInput) {
            urlInput.value = url;
        }
    }

    function cardTemplate(card) {
        const safeName = escapeHtml(card.name);
        const thumbnail = card.previewImageUrl
            ? `<img src="${escapeHtml(card.previewImageUrl)}" alt="${safeName}" loading="lazy" />`
            : `<div class="mod-fallback">${safeName.slice(0, 1).toUpperCase() || "?"}</div>`;
        const hasCommunity = (card.communityWorksCount + card.communityNotWorksCount) > 0;
        const reportCount = card.communityWorksCount + card.communityNotWorksCount;
        const compatibilitySummary = hasCommunity
            ? `${card.communityWorksPercent}% works from ${reportCount.toLocaleString()} reports`
            : "No compatibility reports yet";

        return `
        <article class="mod-card" data-workshop-id="${card.workshopId}" data-workshop-url="${escapeHtml(card.workshopUrl)}">
            <button class="mod-thumb" type="button" data-action="open-workshop" data-workshop-id="${card.workshopId}" data-workshop-url="${escapeHtml(card.workshopUrl)}">
                ${thumbnail}
            </button>
            <div class="mod-body">
                <div class="mod-copy">
                    <h3 class="mod-title" title="${safeName}">${safeName}</h3>
                    <div class="badges">
                        <span class="badge badge-version">${escapeHtml(card.gameVersionBadge)}</span>
                        ${hasCommunity ? `<span class="badge badge-community">${card.communityWorksPercent}% works</span>` : `<span class="badge badge-unverified">Unverified</span>`}
                    </div>
                    <div class="mod-stats">
                        <div class="mod-stat">
                            <span class="mod-stat-value">${card.totalSubscribers.toLocaleString()}</span>
                            <span class="mod-stat-label">Subscribers</span>
                        </div>
                        ${card.fileSizeLabel ? `
                            <div class="mod-stat">
                                <span class="mod-stat-value">${escapeHtml(card.fileSizeLabel)}</span>
                                <span class="mod-stat-label">File Size</span>
                            </div>` : ""}
                    </div>
                    <p class="mod-meta">${escapeHtml(compatibilitySummary)}</p>
                </div>
                <div class="mod-footer">
                    <button type="button" data-action="toggle-mod" data-workshop-id="${card.workshopId}"
                        data-action-state="${card.actionState}"
                        data-intent="${actionIntent(card.actionState)}"
                        class="${actionButtonClass(card.actionState)}"
                        ${actionIsDisabled(card.actionState) ? "disabled" : ""}>
                        ${actionLabel(card.actionState)}
                    </button>
                </div>
            </div>
        </article>`;
    }

    function renderCards(cards) {
        state.activeCards = cards;
        const container = byId("versionCards");
        if (!container) return;

        clearVersionLoadingDelay();
        resetVersionCardsLoadingState(container);

        if (!cards || cards.length === 0) {
            container.innerHTML = `
            <article class="panel-lite" style="padding:20px;text-align:center;">
                <h3 style="margin:0 0 6px">No mods found</h3>
                <p class="muted">Try a broader search term or switch to another game version.</p>
            </article>`;
            setResultSummary(0, 1, 1);
            return;
        }

        container.innerHTML = cards.map(cardTemplate).join("\n");

        for (const btn of container.querySelectorAll("button[data-action='toggle-mod']")) {
            const actionState = btn.getAttribute("data-action-state") || "not-installed";
            applyInstalledHoverLabel(btn, actionState);
        }
    }

    function hookVersionCardDelegation() {
        const container = byId("versionCards");
        if (!container || container.getAttribute("data-events-bound") === "1") {
            return;
        }

        container.setAttribute("data-events-bound", "1");
        container.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const openWorkshopButton = target.closest("button[data-action='open-workshop'], button[data-action='open-detail']");
            if (openWorkshopButton && container.contains(openWorkshopButton)) {
                const workshopId = openWorkshopButton.getAttribute("data-workshop-id") || "";
                const workshopUrl = openWorkshopButton.getAttribute("data-workshop-url")
                    || openWorkshopButton.closest(".mod-card")?.getAttribute("data-workshop-url")
                    || "";
                if (workshopId && workshopUrl) {
                    openWorkshopFromVersionCard(workshopId, workshopUrl, container);
                }
                return;
            }

            const toggleButton = target.closest("button[data-action='toggle-mod']");
            if (toggleButton && container.contains(toggleButton)) {
                const workshopId = toggleButton.getAttribute("data-workshop-id") || "";
                const intent = toggleButton.getAttribute("data-intent") === "uninstall" ? "uninstall" : "install";
                if (workshopId) {
                    void queueAction(workshopId, intent, "version");
                }
                return;
            }

            const card = target.closest(".mod-card");
            if (!card || !container.contains(card)) {
                return;
            }

            if (target.closest("button")) {
                return;
            }

            const workshopId = card.getAttribute("data-workshop-id") || "";
            const url = card.getAttribute("data-workshop-url") || "";
            if (!url) {
                return;
            }
            openWorkshopFromVersionCard(workshopId, url, container);
        });
    }

    function renderPager(result) {
        state.page = result.currentPage;
        state.totalPages = result.totalPages;
        setText("pageSummary", `Page ${result.currentPage} of ${result.totalPages}`);
        setResultSummary(result.totalMatches, result.currentPage, result.totalPages);
        const prev = byId("pagePrev");
        if (prev) prev.disabled = state.isLoading || result.currentPage <= 1;
        const next = byId("pageNext");
        if (next) next.disabled = state.isLoading || result.currentPage >= result.totalPages;
    }

    async function refreshVersionOptions() {
        const options = await window.spikeApi.getVersionOptions(state.showOlderVersions);
        const select = byId("versionSelect");
        if (!select) return;
        select.innerHTML = "";
        for (const opt of options) {
            const item = document.createElement("option");
            item.value = opt.version;
            item.textContent = opt.displayName;
            select.append(item);
        }
        const hasSelection = options.some((o) => o.version === state.selectedVersion);
        if (!hasSelection && options.length > 0) state.selectedVersion = options[0].version;
        select.value = state.selectedVersion;
    }

    async function refreshVersionResults() {
        const requestSeq = state.versionRequestSeq + 1;
        state.versionRequestSeq = requestSeq;

        setLoadingState(true);
        scheduleVersionLoadingSkeleton(requestSeq);
        try {
            const result = await window.spikeApi.queryVersionMods({
                selectedVersion: state.selectedVersion,
                searchText: state.searchText,
                showOlderVersions: state.showOlderVersions,
                sortMode: state.sortMode,
                page: state.page,
                pageSize: state.pageSize
            });

            if (requestSeq !== state.versionRequestSeq) {
                return;
            }

            renderCards(result.cards);
            renderPager(result);
            setVersionStatus(result.statusText);
            if (state.activeDetailWorkshopId) void refreshDetailDrawer(state.activeDetailWorkshopId);
        } catch (error) {
            if (requestSeq !== state.versionRequestSeq) {
                return;
            }

            const msg = error instanceof Error ? error.message : "Unknown error.";
            renderVersionFeedbackCard("Version browser failed", msg);
            setText("pageSummary", "Page 1 of 1");
            setResultSummary(0, 1, 1);
            setVersionStatus(`Version browser failed: ${msg}`);
        } finally {
            if (requestSeq === state.versionRequestSeq) {
                clearVersionLoadingDelay();
                setLoadingState(false);
            }
        }
    }

    function getLiveActionStateForWorkshopId(workshopId) {
        const queueItems = state.queueSnapshot?.items || [];
        const activeQueueItem = queueItems.find((item) => {
            if (item.workshopId !== workshopId) return false;
            return item.status === "queued" || item.status === "running";
        });

        if (activeQueueItem) {
            if (activeQueueItem.status === "queued") {
                return "queued";
            }
            return activeQueueItem.action === "uninstall" ? "uninstalling" : "installing";
        }

        const isInstalled = (state.library.snapshot?.mods || []).some((mod) => mod.workshopId === workshopId);
        return isInstalled ? "installed" : "not-installed";
    }

    function syncVisibleVersionCardActionStates() {
        const container = byId("versionCards");
        if (!container) return;

        for (const button of container.querySelectorAll("button[data-action='toggle-mod']")) {
            const workshopId = button.getAttribute("data-workshop-id") || "";
            if (!workshopId) continue;

            const actionState = getLiveActionStateForWorkshopId(workshopId);
            button.setAttribute("data-action-state", actionState);
            button.setAttribute("data-intent", actionIntent(actionState));
            button.className = actionButtonClass(actionState);
            button.disabled = actionIsDisabled(actionState);
            button.textContent = actionLabel(actionState);
            applyInstalledHoverLabel(button, actionState);
        }
    }

    return {
        bootstrapSelectedVersionFromSettings,
        hookVersionCardDelegation,
        refreshVersionOptions,
        refreshVersionResults,
        syncVisibleVersionCardActionStates
    };
}
