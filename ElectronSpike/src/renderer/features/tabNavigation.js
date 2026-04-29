import { byId } from "../runtime/dom.js";
import { setGlobalStatus } from "../runtime/status.js";
import { state } from "../runtime/state.js";

export function createTabNavigationController({
    dismissDownloadFailureNotice,
    renderDownloadFailureNotice,
    resolveUnsavedSettingsBeforeLeave
}) {
    let suppressTabHistoryRecord = false;

    function activateTab(name) {
        const prev = state.selectedTab;
        if (!suppressTabHistoryRecord && prev && prev !== name) {
            state.tabHistory.push(prev);
            if (state.tabHistory.length > 50) state.tabHistory.shift();
            state.tabForwardStack.length = 0;
        }
        state.selectedTab = name;
        document.body.dataset.activeTab = name;

        const tabs = {
            version: "tabVersion",
            downloads: "tabDownloads",
            library: "tabLibrary",
            merger: "tabMerger",
            workshop: "tabWorkshop",
            settings: "tabSettings"
        };
        for (const [tabName, id] of Object.entries(tabs)) {
            const el = byId(id);
            if (el) el.classList.toggle("is-active", tabName === name);
        }

        const pages = {
            version: "pageVersion",
            downloads: "pageDownloads",
            library: "pageLibrary",
            merger: "pageMerger",
            workshop: "pageWorkshop",
            settings: "pageSettings"
        };
        for (const [tabName, id] of Object.entries(pages)) {
            const el = byId(id);
            if (el) el.classList.toggle("hidden", tabName !== name);
        }

        if (name === "downloads") {
            dismissDownloadFailureNotice();
        } else {
            renderDownloadFailureNotice();
        }

        const statusMap = {
            version: "Version browser ready.",
            downloads: "Downloads queue ready.",
            library: "Library view ready.",
            merger: "Merger ready.",
            workshop: "Workshop browser ready.",
            settings: "Settings view ready."
        };
        setGlobalStatus(statusMap[name] || "Ready.");
    }

    async function activateTabGuarded(name) {
        if (name !== "settings") {
            const canLeave = await resolveUnsavedSettingsBeforeLeave();
            if (!canLeave) {
                return false;
            }
        }

        activateTab(name);
        return true;
    }

    async function navigateTabHistoryBack() {
        if (state.tabHistory.length === 0) return false;
        const current = state.selectedTab;
        const target = state.tabHistory[state.tabHistory.length - 1];
        suppressTabHistoryRecord = true;
        try {
            const ok = await activateTabGuarded(target);
            if (ok) {
                state.tabHistory.pop();
                state.tabForwardStack.push(current);
            }
            return ok;
        } finally {
            suppressTabHistoryRecord = false;
        }
    }

    async function navigateTabHistoryForward() {
        if (state.tabForwardStack.length === 0) return false;
        const current = state.selectedTab;
        const target = state.tabForwardStack[state.tabForwardStack.length - 1];
        suppressTabHistoryRecord = true;
        try {
            const ok = await activateTabGuarded(target);
            if (ok) {
                state.tabForwardStack.pop();
                state.tabHistory.push(current);
            }
            return ok;
        } finally {
            suppressTabHistoryRecord = false;
        }
    }

    return {
        activateTab,
        activateTabGuarded,
        navigateTabHistoryBack,
        navigateTabHistoryForward
    };
}
