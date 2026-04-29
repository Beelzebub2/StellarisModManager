import { byId } from "../runtime/dom.js";
import { buildQueueMessageForDisplay } from "../runtime/queueFormatting.js";
import { state } from "../runtime/state.js";

function getLatestFailedQueueItem(snapshot) {
    const failedItems = Array.isArray(snapshot?.items)
        ? snapshot.items.filter((item) => item?.status === "failed")
        : [];
    if (failedItems.length <= 0) {
        return null;
    }

    return failedItems
        .slice()
        .sort((left, right) => {
            const leftTime = Date.parse(String(left?.updatedAtUtc || ""));
            const rightTime = Date.parse(String(right?.updatedAtUtc || ""));
            return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        })[0] || null;
}

function getDownloadFailureNoticeKey(item) {
    if (!item) {
        return "";
    }

    return `${String(item.workshopId || "").trim()}:${String(item.updatedAtUtc || "").trim()}`;
}

export function createDownloadFailureNoticeController({
    isDeveloperModeEnabled
}) {
    function renderDownloadFailureNotice() {
        const notice = byId("downloadFailureNotice");
        const titleEl = byId("downloadFailureNoticeTitle");
        const messageEl = byId("downloadFailureNoticeMessage");
        const openBtn = byId("downloadFailureNoticeOpen");
        if (!notice || !titleEl || !messageEl || !openBtn) {
            return;
        }

        const latestFailureKey = String(state.downloadFailureNotice.latestFailureKey || "").trim();
        const dismissedFailureKey = String(state.downloadFailureNotice.dismissedFailureKey || "").trim();
        const shouldShow = latestFailureKey
            && latestFailureKey !== dismissedFailureKey
            && state.selectedTab !== "downloads";

        notice.classList.toggle("hidden", !shouldShow);
        if (!shouldShow) {
            return;
        }

        const modName = String(state.downloadFailureNotice.modName || "").trim();
        titleEl.textContent = modName ? `${modName} failed` : "Download failed";
        messageEl.textContent = state.downloadFailureNotice.message || "Open Downloads for details and retry options.";
        openBtn.textContent = "Open downloads";
    }

    function dismissDownloadFailureNotice() {
        const latestFailureKey = String(state.downloadFailureNotice.latestFailureKey || "").trim();
        if (latestFailureKey) {
            state.downloadFailureNotice.dismissedFailureKey = latestFailureKey;
        }
        renderDownloadFailureNotice();
    }

    function syncDownloadFailureNotice(snapshot) {
        const latestFailedItem = getLatestFailedQueueItem(snapshot);
        if (!latestFailedItem) {
            state.downloadFailureNotice.latestFailureKey = "";
            state.downloadFailureNotice.workshopId = null;
            state.downloadFailureNotice.modName = null;
            state.downloadFailureNotice.message = "";
            state.downloadFailureNotice.updatedAtUtc = null;
            renderDownloadFailureNotice();
            return;
        }

        // Use the failed item's updatedAtUtc as the dismissal boundary so only newer failures re-open the notice.
        state.downloadFailureNotice.latestFailureKey = getDownloadFailureNoticeKey(latestFailedItem);
        state.downloadFailureNotice.workshopId = String(latestFailedItem.workshopId || "").trim() || null;
        state.downloadFailureNotice.modName = String(latestFailedItem.modName || "").trim() || null;
        state.downloadFailureNotice.message = buildQueueMessageForDisplay(latestFailedItem, isDeveloperModeEnabled());
        state.downloadFailureNotice.updatedAtUtc = String(latestFailedItem.updatedAtUtc || "").trim() || null;
        renderDownloadFailureNotice();
    }

    return {
        dismissDownloadFailureNotice,
        renderDownloadFailureNotice,
        syncDownloadFailureNotice
    };
}
