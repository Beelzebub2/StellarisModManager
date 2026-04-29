import { byId, escapeHtml, formatInteger } from "../runtime/dom.js";
import { state } from "../runtime/state.js";
import { setMergerStatus } from "../runtime/status.js";

export function createMergerProgressController({
    syncMergerButtons
}) {
    function getMergerProgressTitle(progress = state.merger.progress) {
        switch (progress.operation) {
            case "analyze":
                return "Analyzing merger conflicts";
            case "build":
                return "Building merged mod";
            case "export-report":
                return "Exporting merge report";
            default:
                return "Merger in progress";
        }
    }

    function getMergerProgressBusyMessage(progress = state.merger.progress) {
        if (progress.message) {
            return progress.message;
        }

        switch (progress.operation) {
            case "analyze":
                return "Scanning enabled mods and building the conflict plan.";
            case "build":
                return "Writing the merged output mod and its manifest files.";
            case "export-report":
                return "Writing a standalone merge report.";
            default:
                return "Working on the current merger task.";
        }
    }

    function getMergerProgressCountLabel(progress = state.merger.progress) {
        const processed = Math.max(0, Number(progress.processedItemCount || 0));
        const total = Math.max(0, Number(progress.totalItemCount || 0));
        if (total <= 0) {
            return "Preparing work queue...";
        }

        return `${formatInteger(processed)} of ${formatInteger(total)} items complete`;
    }

    function getMergerProgressPercentLabel(progress = state.merger.progress) {
        const percent = Math.max(0, Math.min(100, Math.round(Number(progress.progressPercent || 0))));
        return `${percent}% complete`;
    }

    function syncMergerProgressPolling() {
        if (state.merger.progress.active) {
            if (state.mergerProgressPollingHandle) {
                return;
            }

            state.mergerProgressPollingHandle = setInterval(() => void refreshMergerProgressStatus(), 500);
            return;
        }

        if (state.mergerProgressPollingHandle) {
            clearInterval(state.mergerProgressPollingHandle);
            state.mergerProgressPollingHandle = null;
        }
    }

    function renderMergerProgressModal() {
        if (!state.merger.progress.modalVisible || !state.merger.progress.active) {
            return;
        }

        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const confirmBtn = byId("modalConfirm");
        const phaseEl = byId("mergerProgressPhase");
        const currentItemEl = byId("mergerProgressCurrentItem");
        const countEl = byId("mergerProgressCount");
        const percentEl = byId("mergerProgressPercent");
        const progressBar = byId("mergerProgressBar");

        if (titleEl) titleEl.textContent = getMergerProgressTitle();
        if (msgEl) msgEl.textContent = getMergerProgressBusyMessage();
        if (confirmBtn) {
            confirmBtn.textContent = state.merger.progress.backgrounded ? "Hide" : "Run in background";
        }
        if (phaseEl) {
            phaseEl.textContent = state.merger.progress.phase || "Preparing";
        }
        if (currentItemEl) {
            currentItemEl.innerHTML = `<strong>Current item:</strong> ${escapeHtml(state.merger.progress.currentItemLabel || "Preparing work queue...")}`;
        }
        if (countEl) {
            countEl.textContent = getMergerProgressCountLabel();
        }
        if (percentEl) {
            percentEl.textContent = getMergerProgressPercentLabel();
        }
        if (progressBar) {
            const percent = Math.max(0, Math.min(100, Math.round(Number(state.merger.progress.progressPercent || 0))));
            const isDeterminate = state.merger.progress.totalItemCount > 0;
            progressBar.setAttribute("data-progress-mode", isDeterminate ? "determinate" : "indeterminate");
            progressBar.style.width = isDeterminate ? `${Math.max(percent, 4)}%` : "";
        }
    }

    function renderMergerProgressNotice() {
        const notice = byId("mergerProgressNotice");
        const titleEl = byId("mergerProgressNoticeTitle");
        const messageEl = byId("mergerProgressNoticeMessage");
        const openBtn = byId("mergerProgressNoticeOpen");
        if (!notice || !titleEl || !messageEl || !openBtn) {
            return;
        }

        const shouldShow = state.merger.progress.active
            && state.merger.progress.backgrounded
            && !state.merger.progress.modalVisible;

        notice.classList.toggle("hidden", !shouldShow);
        if (!shouldShow) {
            return;
        }

        titleEl.textContent = state.merger.progress.currentItemLabel || getMergerProgressTitle();
        messageEl.textContent = `${state.merger.progress.phase || "Working"} | ${getMergerProgressPercentLabel()}`;
        openBtn.textContent = "Open progress";
    }

    function hideMergerProgressModal() {
        const overlay = byId("modalOverlay");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        state.merger.progress.modalVisible = false;
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
        renderMergerProgressNotice();
    }

    function showMergerProgressModal() {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        state.merger.progress.modalVisible = true;
        state.merger.progress.backgrounded = false;

        if (titleEl) titleEl.textContent = getMergerProgressTitle();
        if (msgEl) msgEl.textContent = getMergerProgressBusyMessage();
        if (confirmBtn) {
            confirmBtn.textContent = "Run in background";
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
                '<div class="merger-progress-shell">',
                '  <div class="merger-progress-copy">',
                '    <p class="muted">Large profiles can take a while to analyze or build. You can background this task and keep working elsewhere in the app.</p>',
                '    <p id="mergerProgressPhase" class="merger-progress-phase">Preparing</p>',
                '    <p id="mergerProgressCurrentItem" class="merger-progress-current muted">Current item: Preparing work queue...</p>',
                '    <div class="merger-progress-meta">',
                '      <span id="mergerProgressCount" class="muted">Preparing work queue...</span>',
                '      <strong id="mergerProgressPercent">0% complete</strong>',
                '    </div>',
                '  </div>',
                '  <div class="merger-progress-track" aria-hidden="true"><span id="mergerProgressBar" data-progress-mode="indeterminate"></span></div>',
                '</div>'
            ].join("");
        }
        if (backdrop) backdrop.onclick = null;
        if (overlay) overlay.classList.remove("hidden");

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                state.merger.progress.backgrounded = true;
                hideMergerProgressModal();
                setMergerStatus(`${getMergerProgressTitle()} running in background.`);
            };
        }

        renderMergerProgressModal();
        renderMergerProgressNotice();
    }

    function beginMergerProgress(operation, message) {
        state.merger.progress = {
            ...state.merger.progress,
            active: true,
            operation,
            startedAtUtc: new Date().toISOString(),
            completedAtUtc: null,
            phase: "Preparing",
            currentItemLabel: null,
            processedItemCount: 0,
            totalItemCount: 0,
            progressPercent: 0,
            message,
            lastResultOk: null,
            modalVisible: true,
            backgrounded: false
        };

        showMergerProgressModal();
        renderMergerProgressNotice();
        syncMergerProgressPolling();
        syncMergerButtons();
    }

    function applyMergerProgressStatus(status) {
        const previousActive = state.merger.progress.active;
        state.merger.progress = {
            ...state.merger.progress,
            ...(status || {})
        };

        if (state.merger.progress.active) {
            if (state.merger.progress.modalVisible) {
                renderMergerProgressModal();
            }
            renderMergerProgressNotice();
            syncMergerProgressPolling();
            syncMergerButtons();
            return;
        }

        syncMergerProgressPolling();
        renderMergerProgressNotice();
        syncMergerButtons();
        if (previousActive) {
            hideMergerProgressModal();
        }
    }

    async function refreshMergerProgressStatus() {
        try {
            const status = await window.spikeApi.getModMergerProgressStatus();
            applyMergerProgressStatus(status);
        } catch {
            syncMergerProgressPolling();
        }
    }

    return {
        beginMergerProgress,
        refreshMergerProgressStatus,
        showMergerProgressModal
    };
}
