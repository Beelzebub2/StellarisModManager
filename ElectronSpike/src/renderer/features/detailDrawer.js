import { byId, escapeHtml, setText } from "../runtime/dom.js";
import { state } from "../runtime/state.js";
import { buildQueueDetailMessage } from "../runtime/queueFormatting.js";

export function createDetailDrawerController({
    actionButtonClass,
    actionIntent,
    actionIsDisabled,
    actionLabel,
    applyInstalledHoverLabel,
    cancelQueueAction,
    isDeveloperModeEnabled,
    queueAction
}) {
    function showDetailDrawer(show) {
        const drawer = byId("detailDrawer");
        if (!drawer) return;
        drawer.classList.toggle("hidden", !show);
        document.body.classList.toggle("drawer-open", show);
    }

    async function refreshDetailDrawer(workshopId) {
        const detail = await window.spikeApi.getVersionModDetail(workshopId, state.selectedVersion);
        if (!detail) return;
        state.activeDetailWorkshopId = workshopId;

        setText("detailTitle", detail.title);
        setText("detailVersion", detail.gameVersionBadge);

        const hasDetailCommunity = (detail.communityWorksCount + detail.communityNotWorksCount) > 0;
        setText("detailCommunity", hasDetailCommunity
            ? `${detail.communityWorksPercent}% work (${detail.communityWorksCount + detail.communityNotWorksCount} reports)`
            : "Unverified (0 reports)");

        setText("detailSubscribers", `${detail.totalSubscribers.toLocaleString()} subscribers`);
        const detailFileSize = byId("detailFileSize");
        if (detailFileSize) {
            const hasFileSize = typeof detail.fileSizeLabel === "string" && detail.fileSizeLabel.length > 0;
            detailFileSize.textContent = hasFileSize ? `${detail.fileSizeLabel} download` : "";
            detailFileSize.classList.toggle("hidden", !hasFileSize);
        }
        setText("detailDescription", detail.descriptionText || "No description available.");
        setText("detailQueueMessage", buildQueueDetailMessage(detail.queueMessage, isDeveloperModeEnabled()));

        const image = byId("detailImage");
        if (image) {
            if (detail.previewImageUrl) { image.src = detail.previewImageUrl; image.style.display = "block"; }
            else { image.removeAttribute("src"); image.style.display = "none"; }
        }

        const tags = byId("detailTags");
        if (tags) {
            tags.innerHTML = detail.tags.length === 0
                ? "<span class='muted'>No tags.</span>"
                : detail.tags.map((t) => `<span class='tag'>${escapeHtml(t)}</span>`).join(" ");
        }

        const actionBtn = byId("detailActionButton");
        if (actionBtn) {
            const intent = actionIntent(detail.actionState);
            actionBtn.textContent = actionLabel(detail.actionState);
            actionBtn.className = actionButtonClass(detail.actionState);
            actionBtn.disabled = actionIsDisabled(detail.actionState);
            actionBtn.title = actionIsDisabled(detail.actionState)
                ? "Action in progress"
                : intent === "uninstall"
                    ? "Click to uninstall this mod"
                    : "Click to install this mod";
            applyInstalledHoverLabel(actionBtn, detail.actionState);
            actionBtn.onclick = () => void queueAction(workshopId, intent, "version");
        }

        const cancelBtn = byId("detailCancelButton");
        if (cancelBtn) cancelBtn.onclick = () => void cancelQueueAction(workshopId);

        const workshopBtn = byId("detailWorkshopButton");
        if (workshopBtn) workshopBtn.onclick = () => void window.spikeApi.openExternalUrl(detail.workshopUrl);
    }

    async function openDetailDrawer(workshopId) {
        await refreshDetailDrawer(workshopId);
        showDetailDrawer(true);
    }

    return {
        openDetailDrawer,
        refreshDetailDrawer,
        showDetailDrawer
    };
}
