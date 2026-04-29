import { byId, escapeHtml, formatInteger, formatUtc, setText } from "../runtime/dom.js";
import { showModal } from "../runtime/modal.js";
import { state } from "../runtime/state.js";
import { setMergerStatus } from "../runtime/status.js";

export function createMergerWorkspaceController({
    beginMergerProgress,
    refreshMergerProgressStatus
}) {
    function buildMergerSummaryFromPlan(plan) {
        if (!plan) {
            return {
                enabledModCount: 0,
                scannedFileCount: 0,
                conflictingFileCount: 0,
                scriptConflictCount: 0,
                scriptObjectConflictCount: 0,
                localisationConflictCount: 0,
                assetConflictCount: 0,
                autoResolvedCount: 0,
                unresolvedCount: 0
            };
        }

        const summary = {
            enabledModCount: Array.isArray(plan.sourceMods) ? plan.sourceMods.filter((sourceMod) => sourceMod.isEnabled !== false).length : 0,
            scannedFileCount: 0,
            conflictingFileCount: 0,
            scriptConflictCount: 0,
            scriptObjectConflictCount: 0,
            localisationConflictCount: 0,
            assetConflictCount: 0,
            autoResolvedCount: 0,
            unresolvedCount: 0
        };

        for (const filePlan of plan.filePlans || []) {
            summary.scannedFileCount += (filePlan.entries || []).length;

            const uniqueHashes = new Set((filePlan.entries || []).map((entry) => entry.sha256));
            const hasConflict = (filePlan.entries || []).length > 1 && uniqueHashes.size > 1;
            if (filePlan.resolutionState === "auto" && (filePlan.entries || []).length > 1) {
                summary.autoResolvedCount += 1;
            }
            if (filePlan.resolutionState === "unresolved" && hasConflict) {
                summary.unresolvedCount += 1;
            }
            if (!hasConflict) {
                continue;
            }

            summary.conflictingFileCount += 1;
            if (filePlan.decisionType === "script-object-merge") {
                summary.scriptObjectConflictCount += 1;
            } else if (filePlan.fileType === "script" || filePlan.fileType === "event") {
                summary.scriptConflictCount += 1;
            } else if (filePlan.fileType === "localisation") {
                summary.localisationConflictCount += 1;
            } else if (filePlan.fileType === "asset" || filePlan.fileType === "interface") {
                summary.assetConflictCount += 1;
            }
        }

        return summary;
    }

    function getMergerSummary() {
        return state.merger.summary || buildMergerSummaryFromPlan(state.merger.plan);
    }

    function getMergerAutomationSummary() {
        return state.merger.plan?.automation || {
            safeCount: 0,
            reviewCount: 0,
            manualCount: 0,
            ignoredCount: 0,
            generatedCount: 0
        };
    }

    function getMergerConflictCandidates() {
        const plan = state.merger.plan;
        if (!plan || !Array.isArray(plan.filePlans)) {
            return [];
        }

        return plan.filePlans.filter((filePlan) => (filePlan.entries || []).length > 1);
    }

    function getSelectedMergerFilePlan() {
        const plan = state.merger.plan;
        if (!plan || !Array.isArray(plan.filePlans)) {
            return null;
        }

        return plan.filePlans.find((filePlan) => filePlan.virtualPath === state.merger.selectedVirtualPath) || null;
    }

    function ensureMergerSelection() {
        const selected = getSelectedMergerFilePlan();
        if (selected) {
            return selected;
        }

        const [firstCandidate] = getMergerConflictCandidates();
        state.merger.selectedVirtualPath = firstCandidate?.virtualPath || null;
        return firstCandidate || null;
    }

    function formatMergerFileType(fileType) {
        switch (fileType) {
            case "script": return "Script";
            case "event": return "Events";
            case "localisation": return "Localisation";
            case "asset": return "Assets";
            case "interface": return "Interface";
            default: return "Plain";
        }
    }

    function formatMergerResolutionState(value) {
        switch (value) {
            case "auto": return "Auto";
            case "manual": return "Manual";
            case "ignored": return "Ignored";
            default: return "Unresolved";
        }
    }

    function formatMergerSeverity(value) {
        switch (value) {
            case "critical": return "Critical";
            case "risky": return "Risky";
            case "warning": return "Warning";
            default: return "Info";
        }
    }

    function formatMergerReasonCode(value) {
        switch (value) {
            case "identical-duplicate": return "Identical duplicate";
            case "localisation-non-overlap": return "Auto ready: unique localisation keys";
            case "script-object-non-overlap": return "Auto ready: unique script objects";
            case "localisation-key-collision": return "Needs choice: duplicate localisation key";
            case "script-object-collision": return "Needs choice: duplicate script object";
            case "parse-error": return "Needs choice: parse issue";
            case "blocked-path": return "Needs choice: protected path";
            case "winner-required": return "Needs choice: pick a winner";
            case "file-read-error": return "Needs choice: source read failed";
            case "single-provider": return "Single source";
            default: return value ? String(value).replace(/-/g, " ") : "Needs choice";
        }
    }

    function formatMergerResultStateLabel(filePlan) {
        if (filePlan.autoRecommendation?.canApply === true && filePlan.resolutionState === "unresolved") {
            return "Auto ready";
        }
        if (filePlan.resolutionState === "unresolved") {
            return "Needs choice";
        }
        if (filePlan.resolutionState === "auto" || filePlan.resolutionState === "manual") {
            return "Handled";
        }
        return formatMergerResolutionState(filePlan.resolutionState);
    }

    function getMergerPreviewKey(filePlan, modId) {
        return `${String(filePlan?.virtualPath || "").trim()}::${String(modId ?? "winner")}`;
    }

    function getMergerPreviewRecord(filePlan, modId) {
        const cache = state.merger.previewCache;
        return cache instanceof Map ? cache.get(getMergerPreviewKey(filePlan, modId)) || null : null;
    }

    function resetMergerPreviewState() {
        state.merger.previewCache = new Map();
        state.merger.previewLoadingKey = null;
        state.merger.previewSelectedModId = null;
    }

    function getActiveMergerPreviewModId(filePlan, entries) {
        const selectedModId = state.merger.previewSelectedModId;
        if (
            selectedModId !== null
            && selectedModId !== undefined
            && entries.some((entry) => entry.modId === selectedModId)
        ) {
            return selectedModId;
        }

        return filePlan.winner?.modId ?? entries[0]?.modId ?? null;
    }

    function setMergerResultsNextStep(text, detail) {
        setText("mergerResultsNextStep", text);
        setText("mergerResultsNextStepDetail", detail);
    }

    function renderMergerResultsModeControls(workspace) {
        for (const button of workspace.querySelectorAll("[data-merger-results-mode]")) {
            const mode = button.getAttribute("data-merger-results-mode") || "review";
            const isActive = mode === state.merger.resultsMode;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        }
    }

    async function loadMergerFilePreview(filePlan, modId) {
        const previewKey = getMergerPreviewKey(filePlan, modId);
        if (!filePlan || state.merger.previewLoadingKey === previewKey) {
            return;
        }

        state.merger.previewLoadingKey = previewKey;
        renderMergerResultsDetail(filePlan);
        try {
            const result = await window.spikeApi.modMergerReadFilePreview({
                virtualPath: filePlan.virtualPath,
                modId
            });
            if (!(state.merger.previewCache instanceof Map)) {
                state.merger.previewCache = new Map();
            }
            state.merger.previewCache.set(previewKey, result);
        } catch (error) {
            if (!(state.merger.previewCache instanceof Map)) {
                state.merger.previewCache = new Map();
            }
            state.merger.previewCache.set(previewKey, {
                ok: false,
                message: error instanceof Error ? error.message : "Could not read source preview.",
                virtualPath: filePlan.virtualPath,
                modId,
                modName: null,
                sourcePath: null,
                sizeBytes: 0,
                truncated: false,
                content: null
            });
        } finally {
            if (state.merger.previewLoadingKey === previewKey) {
                state.merger.previewLoadingKey = null;
            }
            renderMergerResultsDetail(getSelectedMergerFilePlan());
        }
    }

    function renderMergerCodeViewer(previewRecord, fallbackMessage = "Select a source file to load its content.") {
        if (!previewRecord) {
            return `<div class="merger-code-viewer is-empty">${escapeHtml(fallbackMessage)}</div>`;
        }

        if (!previewRecord.content) {
            return `<div class="merger-code-viewer is-empty">${escapeHtml(previewRecord.message || "Preview unavailable.")}</div>`;
        }

        const truncated = previewRecord.truncated ? "\n\n/* Preview truncated. Open the source file for the full content. */" : "";
        return `<pre class="merger-code-viewer"><code>${escapeHtml(previewRecord.content + truncated)}</code></pre>`;
    }

    function renderGeneratedCodeViewer(filePlan, generatedPreview) {
        if (generatedPreview) {
            return `<pre class="merger-code-viewer"><code>${escapeHtml(generatedPreview)}</code></pre>`;
        }

        const winner = filePlan.winner;
        if (winner) {
            const previewRecord = getMergerPreviewRecord(filePlan, winner.modId);
            return renderMergerCodeViewer(previewRecord, "Load the current winner source to inspect the exact file that will be copied.");
        }

        return '<div class="merger-code-viewer is-empty">No generated output or winner is selected for this file.</div>';
    }

    function renderMergerResultsAdvancedPanel(filePlan, entries, generatedPreview) {
        const selectedPreviewModId = getActiveMergerPreviewModId(filePlan, entries);
        const selectedPreview = selectedPreviewModId === null
            ? null
            : getMergerPreviewRecord(filePlan, selectedPreviewModId);
        const loadingKey = selectedPreviewModId === null ? "" : getMergerPreviewKey(filePlan, selectedPreviewModId);

        return `
            <article class="merger-detail-card merger-advanced-code-panel">
                <header class="merger-advanced-header">
                    <div>
                        <p class="settings-key">Advanced file inspection</p>
                        <p class="muted">Compare the source files and the exact generated or selected output for this virtual path.</p>
                    </div>
                    <span class="status-chip status-chip-muted">${escapeHtml(filePlan.virtualPath)}</span>
                </header>
                <div class="merger-advanced-grid">
                    <section class="merger-advanced-sources">
                        <p class="settings-key">Source files</p>
                        <div class="merger-source-list">
                            ${entries.map((entry) => {
                                const previewKey = getMergerPreviewKey(filePlan, entry.modId);
                                const isLoading = state.merger.previewLoadingKey === previewKey;
                                const preview = getMergerPreviewRecord(filePlan, entry.modId);
                                const isSelected = selectedPreviewModId === entry.modId;
                                return `
                                    <button type="button" class="merger-source-row${filePlan.winner?.modId === entry.modId ? " is-current" : ""}${isSelected ? " is-previewed" : ""}" data-merger-preview-mod-id="${entry.modId}"${isLoading ? " disabled" : ""}>
                                        <span class="merger-source-main">
                                            <strong>[${entry.loadOrder}] ${escapeHtml(entry.modName)}</strong>
                                            <span class="muted">${escapeHtml(entry.realPath || entry.virtualPath)}</span>
                                        </span>
                                        <span class="merger-source-meta">
                                            <span class="status-chip status-chip-muted">${preview ? "Loaded" : (isLoading ? "Loading" : "Load")}</span>
                                            <span class="status-chip status-chip-muted">${formatInteger(entry.sizeBytes)} bytes</span>
                                        </span>
                                    </button>
                                `;
                            }).join("")}
                        </div>
                    </section>
                    <section>
                        <p class="settings-key">Selected source content</p>
                        ${state.merger.previewLoadingKey === loadingKey
                            ? '<div class="merger-code-viewer is-empty">Loading source preview...</div>'
                            : renderMergerCodeViewer(selectedPreview)}
                    </section>
                    <section class="merger-advanced-output">
                        <p class="settings-key">Generated or winner output</p>
                        ${renderGeneratedCodeViewer(filePlan, generatedPreview)}
                    </section>
                </div>
            </article>
        `;
    }

    function formatMergerGroupLabel(key) {
        switch (key) {
            case "script": return "Script conflicts";
            case "localisation": return "Localisation conflicts";
            case "asset": return "Asset conflicts";
            default: return "Plain file conflicts";
        }
    }

    function getMergerGroupKey(filePlan) {
        if (filePlan.fileType === "script" || filePlan.fileType === "event") return "script";
        if (filePlan.fileType === "localisation") return "localisation";
        if (filePlan.fileType === "asset" || filePlan.fileType === "interface") return "asset";
        return "plain";
    }

    function setMergerMetric(id, value) {
        setText(id, formatInteger(value || 0));
    }

    function syncMergerButtons() {
        const hasPlan = !!state.merger.plan;
        const hasOutputPath = !!(state.merger.lastBuildOutputPath || state.merger.plan?.outputModPath);
        const isBusy = state.merger.progress.active === true;
        const automation = getMergerAutomationSummary();

        const buildBtn = byId("mergerBuildBtn");
        if (buildBtn) buildBtn.disabled = !hasPlan || isBusy;
        const resultsBuildBtn = byId("mergerResultsBuildBtn");
        if (resultsBuildBtn) resultsBuildBtn.disabled = !hasPlan || isBusy;
        const analyzeBtn = byId("mergerAnalyzeBtn");
        if (analyzeBtn) analyzeBtn.disabled = isBusy;
        const resultsScanBtn = byId("mergerResultsScanBtn");
        if (resultsScanBtn) resultsScanBtn.disabled = isBusy;
        const openResultsBtn = byId("mergerOpenResultsBtn");
        if (openResultsBtn) openResultsBtn.disabled = isBusy;
        const autoBtn = byId("mergerAutoBtn");
        if (autoBtn) autoBtn.disabled = !hasPlan || isBusy || automation.safeCount <= 0;
        const resultsAutoBtn = byId("mergerResultsAutoBtn");
        if (resultsAutoBtn) resultsAutoBtn.disabled = !hasPlan || isBusy || automation.safeCount <= 0;
        const openBtn = byId("mergerOpenOutputBtn");
        if (openBtn) openBtn.disabled = !hasOutputPath || isBusy;
        const exportBtn = byId("mergerExportReportBtn");
        if (exportBtn) exportBtn.disabled = !hasPlan || isBusy;
    }

    function renderMergerSummary() {
        const plan = state.merger.plan;
        const summary = getMergerSummary();
        const automation = getMergerAutomationSummary();
        setMergerMetric("mergerMetricEnabledMods", summary.enabledModCount);
        setMergerMetric("mergerMetricFilesScanned", summary.scannedFileCount);
        setMergerMetric("mergerMetricFileConflicts", summary.conflictingFileCount);
        setMergerMetric("mergerMetricScriptConflicts", summary.scriptConflictCount);
        setMergerMetric("mergerMetricLocalisationConflicts", summary.localisationConflictCount);
        setMergerMetric("mergerMetricAssetConflicts", summary.assetConflictCount);
        setMergerMetric("mergerMetricAutoResolved", summary.autoResolvedCount);
        setMergerMetric("mergerMetricSafeAuto", automation.safeCount);
        setMergerMetric("mergerMetricNeedsReview", automation.manualCount + automation.reviewCount);
        setMergerMetric("mergerMetricGenerated", automation.generatedCount);
        setMergerMetric("mergerMetricUnresolved", summary.unresolvedCount);

        const profileLabel = plan?.profileName ? `Profile: ${plan.profileName}` : "Profile: --";
        const enabledModsLabel = `Enabled mods: ${formatInteger(summary.enabledModCount)}`;
        const analysisLabel = plan?.createdAtUtc ? `Last analysis: ${formatUtc(plan.createdAtUtc)}` : "Last analysis: Never";
        setText("mergerProfileChip", profileLabel);
        setText("mergerEnabledChip", enabledModsLabel);
        setText("mergerAnalysisChip", analysisLabel);
        setText("mergerLastOutputPath", state.merger.lastBuildOutputPath || plan?.outputModPath || "Not built yet.");
        setText("mergerResultsOutputPath", `Output: ${state.merger.lastBuildOutputPath || plan?.outputModPath || "not built"}`);

        syncMergerButtons();
    }

    function renderMergerConflictTree() {
        const tree = byId("mergerConflictTree");
        if (!tree) return;

        const candidates = getMergerConflictCandidates();
        const mergerBusy = state.merger.progress.active === true;
        setText("mergerConflictTreeCount", `${formatInteger(candidates.length)} entries`);

        if (candidates.length <= 0) {
            tree.innerHTML = '<div class="merger-empty muted">Run an analysis to populate the merger tree.</div>';
            return;
        }

        const groups = new Map();
        for (const filePlan of candidates) {
            const groupKey = getMergerGroupKey(filePlan);
            const current = groups.get(groupKey) || [];
            current.push(filePlan);
            groups.set(groupKey, current);
        }

        const orderedGroupKeys = ["script", "localisation", "asset", "plain"].filter((key) => groups.has(key));
        tree.innerHTML = orderedGroupKeys.map((groupKey) => {
            const items = (groups.get(groupKey) || [])
                .slice()
                .sort((left, right) => left.virtualPath.localeCompare(right.virtualPath))
                .map((filePlan) => {
                    const winnerLabel = filePlan.winner?.modName || "None";
                    const isSelected = filePlan.virtualPath === state.merger.selectedVirtualPath;
                    return `
                        <button type="button" class="merger-tree-row${isSelected ? " is-selected" : ""}" data-virtual-path="${escapeHtml(filePlan.virtualPath)}"${mergerBusy ? " disabled" : ""}>
                            <span class="merger-tree-row-main">
                                <strong>${escapeHtml(filePlan.virtualPath)}</strong>
                                <span class="muted">${escapeHtml(formatMergerFileType(filePlan.fileType))} Ã¢â‚¬Â¢ ${formatInteger((filePlan.entries || []).length)} mods</span>
                            </span>
                            <span class="merger-tree-row-meta">
                                <span class="status-chip status-chip-muted">${escapeHtml(formatMergerResolutionState(filePlan.resolutionState))}</span>
                                <span class="status-chip status-chip-muted">${escapeHtml(formatMergerSeverity(filePlan.severity))}</span>
                                <span class="status-chip status-chip-muted">${escapeHtml(winnerLabel)}</span>
                            </span>
                        </button>
                    `;
                }).join("");

            return `
                <section class="merger-tree-group">
                    <header class="merger-tree-group-header">
                        <h4>${escapeHtml(formatMergerGroupLabel(groupKey))}</h4>
                    </header>
                    <div class="merger-tree-group-body">${items}</div>
                </section>
            `;
        }).join("");

        for (const button of tree.querySelectorAll("[data-virtual-path]")) {
            button.addEventListener("click", () => {
                state.merger.selectedVirtualPath = button.getAttribute("data-virtual-path");
                renderMergerConflictTree();
                renderMergerDetailPanel();
            });
        }
    }

    function renderMergerDetailPanel() {
        const panel = byId("mergerDetailPanel");
        if (!panel) return;

        const filePlan = ensureMergerSelection();
        const mergerBusy = state.merger.progress.active === true;
        if (!filePlan) {
            panel.innerHTML = '<div class="merger-empty muted">Select a merged file entry to inspect the winner, source mods, and resolution options.</div>';
            return;
        }

        const entries = (filePlan.entries || [])
            .slice()
            .sort((left, right) => left.loadOrder - right.loadOrder || left.modId - right.modId);
        const recommendation = filePlan.autoRecommendation || {};
        const recommendationLabel = recommendation.reason
            || "No automation criteria matched this file.";
        const generatedPreview = String(filePlan.generatedOutput || filePlan.outputPreview || "").trim();
        const detailKeys = [
            ...(Array.isArray(filePlan.mergeDetails?.objectKeys) ? filePlan.mergeDetails.objectKeys : []),
            ...(Array.isArray(filePlan.mergeDetails?.localisationKeys) ? filePlan.mergeDetails.localisationKeys : [])
        ].slice(0, 8);

        panel.innerHTML = `
            <header class="merger-detail-header">
                <div>
                    <p class="eyebrow">Selected File</p>
                    <h3>${escapeHtml(filePlan.virtualPath)}</h3>
                </div>
                <div class="merger-detail-chips">
                    <span class="status-chip status-chip-muted">${escapeHtml(formatMergerFileType(filePlan.fileType))}</span>
                    <span class="status-chip status-chip-muted">${escapeHtml(formatMergerResolutionState(filePlan.resolutionState))}</span>
                    <span class="status-chip status-chip-muted">${escapeHtml(formatMergerSeverity(filePlan.severity))}</span>
                </div>
            </header>
            <div class="merger-detail-grid">
                <div class="merger-detail-card">
                    <p class="settings-key">Current winner</p>
                    <p class="settings-value">${escapeHtml(filePlan.winner?.modName || "No winner selected")}</p>
                    <p class="muted">Strategy: ${escapeHtml(filePlan.strategy)} | Decision: ${escapeHtml(filePlan.decisionType || "file-winner")}</p>
                    <div class="merger-detail-actions">
                        <button id="mergerApplyAutoFromDetail" type="button" class="button-secondary"${mergerBusy || !recommendation.canApply ? " disabled" : ""}>Auto Control</button>
                        <button id="mergerUseLoadOrderWinner" type="button" class="button-secondary"${mergerBusy ? " disabled" : ""}>Use load-order winner</button>
                        <button id="mergerIgnoreFile" type="button" class="button-secondary"${mergerBusy ? " disabled" : ""}>Ignore file</button>
                    </div>
                </div>
                <div class="merger-detail-card">
                    <p class="settings-key">Source mods</p>
                    <div class="merger-source-list">
                        ${entries.map((entry) => `
                            <button type="button" class="merger-source-row${filePlan.winner?.modId === entry.modId ? " is-current" : ""}" data-merger-mod-id="${entry.modId}"${mergerBusy ? " disabled" : ""}>
                                <span class="merger-source-main">
                                    <strong>[${entry.loadOrder}] ${escapeHtml(entry.modName)}</strong>
                                    <span class="muted">${escapeHtml(entry.virtualPath)}</span>
                                </span>
                                <span class="merger-source-meta">
                                    <span class="status-chip status-chip-muted">${formatInteger(entry.sizeBytes)} bytes</span>
                                </span>
                            </button>
                        `).join("")}
                    </div>
                </div>
            </div>
            <div class="merger-detail-card">
                <p class="settings-key">Auto Control</p>
                <p class="settings-value">${escapeHtml(recommendation.reasonCode || "manual-review")}</p>
                <p class="muted">${escapeHtml(recommendationLabel)}</p>
                ${detailKeys.length > 0 ? `<p class="muted">Keys: ${escapeHtml(detailKeys.join(", "))}${detailKeys.length >= 8 ? ", ..." : ""}</p>` : ""}
                ${filePlan.mergeDetails?.parseError ? `<p class="muted">Parse issue: ${escapeHtml(filePlan.mergeDetails.parseError)}</p>` : ""}
                ${generatedPreview ? `<pre class="merger-generated-preview">${escapeHtml(generatedPreview.slice(0, 1200))}</pre>` : ""}
            </div>
        `;

        byId("mergerApplyAutoFromDetail")?.addEventListener("click", () => {
            void runMergerApplyAuto();
        });
        byId("mergerUseLoadOrderWinner")?.addEventListener("click", () => {
            void runMergerSetResolution({
                virtualPath: filePlan.virtualPath,
                strategy: "copy-load-order-winner"
            });
        });
        byId("mergerIgnoreFile")?.addEventListener("click", () => {
            void runMergerSetResolution({
                virtualPath: filePlan.virtualPath,
                strategy: "ignore"
            });
        });

        for (const button of panel.querySelectorAll("[data-merger-mod-id]")) {
            button.addEventListener("click", () => {
                const selectedModId = Number.parseInt(button.getAttribute("data-merger-mod-id") || "", 10);
                if (!Number.isFinite(selectedModId)) return;
                void runMergerSetResolution({
                    virtualPath: filePlan.virtualPath,
                    strategy: "copy-load-order-winner",
                    selectedModId
                });
            });
        }
    }

    function getFilteredMergerResults() {
        const candidates = getMergerConflictCandidates()
            .slice()
            .sort((left, right) => {
                const leftSafe = left.autoRecommendation?.canApply === true && left.resolutionState === "unresolved" ? 0 : 1;
                const rightSafe = right.autoRecommendation?.canApply === true && right.resolutionState === "unresolved" ? 0 : 1;
                return leftSafe - rightSafe || left.virtualPath.localeCompare(right.virtualPath);
            });

        switch (state.merger.resultsFilter) {
            case "needs-action":
                return candidates.filter((filePlan) => filePlan.resolutionState === "unresolved");
            case "safe":
                return candidates.filter((filePlan) =>
                    filePlan.resolutionState === "unresolved"
                    && filePlan.autoRecommendation?.canApply === true
                    && filePlan.autoRecommendation?.confidence === "safe"
                );
            case "manual":
                return candidates.filter((filePlan) =>
                    filePlan.resolutionState === "unresolved"
                    && !(filePlan.autoRecommendation?.canApply === true && filePlan.autoRecommendation?.confidence === "safe")
                );
            case "resolved":
                return candidates.filter((filePlan) => filePlan.resolutionState !== "unresolved");
            default:
                return candidates.filter((filePlan) => filePlan.resolutionState === "unresolved");
        }
    }

    function renderMergerResultsDetail(filePlan) {
        const detail = byId("mergerResultsDetail");
        if (!detail) return;

        if (!filePlan) {
            detail.innerHTML = '<div class="merger-empty muted">Select a result to inspect recommendations, source files, and code-level changes.</div>';
            return;
        }

        const entries = (filePlan.entries || [])
            .slice()
            .sort((left, right) => left.loadOrder - right.loadOrder || left.modId - right.modId);
        const recommendation = filePlan.autoRecommendation || {};
        const generatedPreview = String(filePlan.generatedOutput || filePlan.outputPreview || "").trim();
        const duplicateKeys = Array.isArray(filePlan.mergeDetails?.duplicateKeys)
            ? filePlan.mergeDetails.duplicateKeys
            : [];
        const keys = [
            ...(Array.isArray(filePlan.mergeDetails?.objectKeys) ? filePlan.mergeDetails.objectKeys : []),
            ...(Array.isArray(filePlan.mergeDetails?.localisationKeys) ? filePlan.mergeDetails.localisationKeys : [])
        ].slice(0, 20);
        const mergerBusy = state.merger.progress.active === true;
        const stateLabel = formatMergerResultStateLabel(filePlan);
        const selectedPreviewModId = getActiveMergerPreviewModId(filePlan, entries);

        detail.innerHTML = `
            <header class="merger-detail-header">
                <div>
                    <p class="eyebrow">Selected Result</p>
                    <h3>${escapeHtml(filePlan.virtualPath)}</h3>
                    <p class="muted">Winner: ${escapeHtml(filePlan.winner?.modName || "No winner selected")}</p>
                </div>
                <div class="merger-detail-chips">
                    <span class="status-chip status-chip-muted">${escapeHtml(formatMergerFileType(filePlan.fileType))}</span>
                    <span class="status-chip status-chip-muted">${escapeHtml(stateLabel)}</span>
                    <span class="status-chip status-chip-muted">${escapeHtml(filePlan.decisionType || "file-winner")}</span>
                </div>
            </header>
            <section class="merger-review-summary">
                <article class="merger-detail-card merger-next-action-card">
                    <p class="settings-key">Recommended action</p>
                    <p class="settings-value">${escapeHtml(formatMergerReasonCode(recommendation.reasonCode || filePlan.decisionType || "winner-required"))}</p>
                    <p class="muted">${escapeHtml(recommendation.reason || "Choose a source winner or inspect the file in Advanced mode before building.")}</p>
                    <div class="merger-detail-actions">
                        <button id="mergerResultsApplyAutoForFile" type="button" class="button-secondary"${mergerBusy || !recommendation.canApply ? " disabled" : ""}>Apply safe auto</button>
                        <button id="mergerResultsUseWinner" type="button" class="button-secondary"${mergerBusy ? " disabled" : ""}>Use load-order winner</button>
                        <button id="mergerResultsIgnoreFile" type="button" class="button-secondary"${mergerBusy ? " disabled" : ""}>Ignore</button>
                    </div>
                </article>
                <article class="merger-detail-card">
                    <p class="settings-key">Why it needs review</p>
                    ${filePlan.mergeDetails?.parseError ? `<p class="muted">Parse issue: ${escapeHtml(filePlan.mergeDetails.parseError)}</p>` : ""}
                    ${duplicateKeys.length > 0 ? `<p class="muted">Duplicate keys: ${escapeHtml(duplicateKeys.join(", "))}</p>` : ""}
                    ${keys.length > 0 ? `<p class="muted">Detected keys: ${escapeHtml(keys.join(", "))}${keys.length >= 20 ? ", ..." : ""}</p>` : ""}
                    ${!filePlan.mergeDetails?.parseError && duplicateKeys.length <= 0 && keys.length <= 0 ? '<p class="muted">This file overlaps between mods. Review the source list and pick the intended winner.</p>' : ""}
                </article>
            </section>
            <section class="merger-results-detail-grid">
                <article class="merger-detail-card">
                    <p class="settings-key">Source mods</p>
                    <div class="merger-source-list">
                        ${entries.map((entry) => `
                            <button type="button" class="merger-source-row${filePlan.winner?.modId === entry.modId ? " is-current" : ""}" data-merger-results-mod-id="${entry.modId}"${mergerBusy ? " disabled" : ""}>
                                <span class="merger-source-main">
                                    <strong>[${entry.loadOrder}] ${escapeHtml(entry.modName)}</strong>
                                    <span class="muted">${escapeHtml(entry.realPath || entry.virtualPath)}</span>
                                </span>
                                <span class="merger-source-meta">
                                    <span class="status-chip status-chip-muted">${filePlan.winner?.modId === entry.modId ? "Winner" : "Use"}</span>
                                    <span class="status-chip status-chip-muted">${formatInteger(entry.sizeBytes)} bytes</span>
                                </span>
                            </button>
                        `).join("")}
                    </div>
                </article>
                <article class="merger-detail-card">
                    <p class="settings-key">Output preview</p>
                    ${generatedPreview
                        ? `<pre class="merger-generated-preview">${escapeHtml(generatedPreview.slice(0, 3000))}</pre>`
                        : `<p class="muted">${escapeHtml(filePlan.winner?.modName ? `The build will copy the selected winner from ${filePlan.winner.modName}.` : "No generated output or winner is selected yet.")}</p>`}
                </article>
            </section>
            ${state.merger.resultsMode === "advanced" ? renderMergerResultsAdvancedPanel(filePlan, entries, generatedPreview) : ""}
        `;

        byId("mergerResultsApplyAutoForFile")?.addEventListener("click", () => {
            void runMergerApplyAuto();
        });
        byId("mergerResultsUseWinner")?.addEventListener("click", () => {
            void runMergerSetResolution({
                virtualPath: filePlan.virtualPath,
                strategy: "copy-load-order-winner"
            });
        });
        byId("mergerResultsIgnoreFile")?.addEventListener("click", () => {
            void runMergerSetResolution({
                virtualPath: filePlan.virtualPath,
                strategy: "ignore"
            });
        });

        for (const button of detail.querySelectorAll("[data-merger-results-mod-id]")) {
            button.addEventListener("click", () => {
                const selectedModId = Number.parseInt(button.getAttribute("data-merger-results-mod-id") || "", 10);
                if (!Number.isFinite(selectedModId)) return;
                void runMergerSetResolution({
                    virtualPath: filePlan.virtualPath,
                    strategy: "copy-load-order-winner",
                    selectedModId
                });
            });
        }

        for (const button of detail.querySelectorAll("[data-merger-preview-mod-id]")) {
            button.addEventListener("click", () => {
                const selectedModId = Number.parseInt(button.getAttribute("data-merger-preview-mod-id") || "", 10);
                if (!Number.isFinite(selectedModId)) return;
                state.merger.previewSelectedModId = selectedModId;
                if (getMergerPreviewRecord(filePlan, selectedModId)) {
                    renderMergerResultsDetail(filePlan);
                    return;
                }
                void loadMergerFilePreview(filePlan, selectedModId);
            });
        }

        if (
            state.merger.resultsMode === "advanced"
            && selectedPreviewModId !== null
            && !getMergerPreviewRecord(filePlan, selectedPreviewModId)
            && state.merger.previewLoadingKey !== getMergerPreviewKey(filePlan, selectedPreviewModId)
        ) {
            void loadMergerFilePreview(filePlan, selectedPreviewModId);
        }
    }

    function renderMergerResultsWorkspace() {
        const workspace = byId("mergerResultsWorkspace");
        if (!workspace) return;

        const summary = getMergerSummary();
        const automation = getMergerAutomationSummary();
        const candidates = getMergerConflictCandidates();
        const filtered = getFilteredMergerResults();
        const needsActionCount = candidates.filter((filePlan) => filePlan.resolutionState === "unresolved").length;
        const handledCount = candidates.filter((filePlan) => filePlan.resolutionState !== "unresolved").length;
        setMergerMetric("mergerResultsMetricFiles", summary.scannedFileCount);
        setMergerMetric("mergerResultsMetricConflicts", summary.conflictingFileCount);
        setMergerMetric("mergerResultsMetricSafeAuto", automation.safeCount);
        setMergerMetric("mergerResultsMetricManual", automation.manualCount + automation.reviewCount);
        setMergerMetric("mergerResultsMetricNeedsAction", needsActionCount);
        setMergerMetric("mergerResultsMetricHandled", handledCount);
        setText("mergerResultsCount", `${formatInteger(filtered.length)} entries`);
        setText("mergerResultsOutputPath", `Output: ${state.merger.lastBuildOutputPath || state.merger.plan?.outputModPath || "not built"}`);

        if (!state.merger.plan) {
            setMergerResultsNextStep(
                "Run a scan",
                "Analyze enabled mods to see what can be handled automatically and what needs a manual choice."
            );
        } else if (automation.safeCount > 0) {
            setMergerResultsNextStep(
                "Apply safe auto",
                `${formatInteger(automation.safeCount)} file(s) can be resolved automatically without changing source mods.`
            );
        } else if (needsActionCount > 0) {
            setMergerResultsNextStep(
                "Review choices",
                `${formatInteger(needsActionCount)} file(s) still need a winner, ignore decision, or Advanced inspection.`
            );
        } else {
            setMergerResultsNextStep(
                "Build merged mod",
                "All detected conflicts are handled. Build the output mod when ready."
            );
        }

        for (const button of workspace.querySelectorAll("[data-merger-results-filter]")) {
            const filter = button.getAttribute("data-merger-results-filter") || "needs-action";
            button.classList.toggle("is-active", filter === state.merger.resultsFilter);
            button.setAttribute("aria-pressed", filter === state.merger.resultsFilter ? "true" : "false");
        }
        renderMergerResultsModeControls(workspace);

        const list = byId("mergerResultsList");
        if (!list) return;

        if (!state.merger.plan) {
            list.innerHTML = '<div class="merger-empty muted">Run a scan to populate merger results.</div>';
            renderMergerResultsDetail(null);
            syncMergerButtons();
            return;
        }

        if (!filtered.some((filePlan) => filePlan.virtualPath === state.merger.selectedVirtualPath)) {
            state.merger.selectedVirtualPath = filtered[0]?.virtualPath || null;
            state.merger.previewSelectedModId = null;
        }

        if (filtered.length <= 0) {
            list.innerHTML = '<div class="merger-empty muted">No entries match this filter.</div>';
            renderMergerResultsDetail(null);
            syncMergerButtons();
            return;
        }

        list.innerHTML = filtered.map((filePlan) => {
            const recommendation = filePlan.autoRecommendation || {};
            const isSelected = filePlan.virtualPath === state.merger.selectedVirtualPath;
            const stateLabel = formatMergerResultStateLabel(filePlan);
            const reasonLabel = formatMergerReasonCode(recommendation.reasonCode || filePlan.decisionType || "winner-required");
            return `
                <button type="button" class="merger-results-row${isSelected ? " is-selected" : ""}" data-virtual-path="${escapeHtml(filePlan.virtualPath)}">
                    <span class="merger-results-row-main">
                        <strong>${escapeHtml(filePlan.virtualPath)}</strong>
                        <span class="merger-results-row-reason">${escapeHtml(reasonLabel)}</span>
                    </span>
                    <span class="merger-results-row-meta">
                        <span class="status-chip status-chip-muted">${escapeHtml(stateLabel)}</span>
                        <span class="status-chip status-chip-muted">${formatInteger((filePlan.entries || []).length)} mods</span>
                    </span>
                </button>
            `;
        }).join("");

        for (const button of list.querySelectorAll("[data-virtual-path]")) {
            button.addEventListener("click", () => {
                const nextVirtualPath = button.getAttribute("data-virtual-path");
                if (nextVirtualPath !== state.merger.selectedVirtualPath) {
                    state.merger.previewSelectedModId = null;
                }
                state.merger.selectedVirtualPath = nextVirtualPath;
                renderMergerResultsWorkspace();
            });
        }

        renderMergerResultsDetail(getSelectedMergerFilePlan());
        syncMergerButtons();
    }

    function renderMergerPage() {
        renderMergerSummary();
        renderMergerConflictTree();
        renderMergerDetailPanel();
        renderMergerResultsWorkspace();
    }

    async function refreshMergerPlan() {
        try {
            const plan = await window.spikeApi.modMergerGetPlan();
            state.merger.plan = plan;
            state.merger.summary = buildMergerSummaryFromPlan(plan);
            resetMergerPreviewState();
            ensureMergerSelection();
            renderMergerPage();
        } catch {
            state.merger.plan = null;
            state.merger.summary = buildMergerSummaryFromPlan(null);
            resetMergerPreviewState();
            renderMergerPage();
        }
    }

    async function runMergerAnalysis() {
        beginMergerProgress("analyze", "Analyzing enabled mods...");
        setMergerStatus("Analyzing enabled mods...");
        try {
            const result = await window.spikeApi.modMergerAnalyze({ openResults: true });
            await refreshMergerProgressStatus();
            state.merger.plan = result.plan;
            state.merger.summary = result.summary;
            state.merger.selectedVirtualPath = null;
            resetMergerPreviewState();
            if (result.plan) {
                state.merger.lastBuildOutputPath = state.merger.lastBuildOutputPath || result.plan.outputModPath;
            }
            ensureMergerSelection();
            renderMergerPage();
            setMergerStatus(result.message);
        } catch (error) {
            await refreshMergerProgressStatus();
            const message = error instanceof Error ? error.message : String(error || "Unknown merger analysis error");
            setMergerStatus(message);
        }
    }

    async function runMergerSetResolution(request) {
        const result = await window.spikeApi.modMergerSetResolution(request);
        if (result.plan) {
            state.merger.plan = result.plan;
        }
        state.merger.summary = result.summary;
        renderMergerPage();
        setMergerStatus(result.message);
    }

    async function runMergerApplyAuto() {
        if (!state.merger.plan) {
            setMergerStatus("Scan mods before running Auto Control.");
            return;
        }

        setMergerStatus("Applying safe Auto Control recommendations...");
        try {
            const result = await window.spikeApi.modMergerApplyAuto({ scope: "safe" });
            if (result.plan) {
                state.merger.plan = result.plan;
            }
            state.merger.summary = result.summary;
            ensureMergerSelection();
            renderMergerPage();
            setMergerStatus(result.message);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Unknown Auto Control error");
            setMergerStatus(message);
        }
    }

    async function openMergerResultsWindow() {
        try {
            const result = await window.spikeApi.modMergerOpenResults();
            setMergerStatus(result.message);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Could not open merger results.");
            setMergerStatus(message);
        }
    }

    async function runMergerBuild() {
        if (!state.merger.plan) {
            setMergerStatus("Analyze mods before building the merged output.");
            return;
        }

        const summary = getMergerSummary();
        if (summary.unresolvedCount > 0) {
            const confirmed = await showModal(
                "Build With Unresolved Conflicts",
                "The merged mod currently includes unresolved conflicts. The build will still use the current winners for those files. Continue?",
                "Build anyway",
                "Cancel"
            );
            if (!confirmed) {
                setMergerStatus("Build cancelled.");
                return;
            }
        }

        beginMergerProgress("build", "Building merged mod...");
        setMergerStatus("Building merged mod...");
        try {
            const result = await window.spikeApi.modMergerBuild({ cleanOutputFolder: true });
            await refreshMergerProgressStatus();
            if (result.ok) {
                state.merger.lastBuildOutputPath = result.outputModPath;
                state.merger.lastReportPath = result.reportPath;
            }
            renderMergerPage();
            setMergerStatus(result.message);
        } catch (error) {
            await refreshMergerProgressStatus();
            const message = error instanceof Error ? error.message : String(error || "Unknown merger build error");
            setMergerStatus(message);
        }
    }

    async function runMergerExportReport() {
        if (!state.merger.plan) {
            setMergerStatus("Analyze mods before exporting a report.");
            return;
        }

        beginMergerProgress("export-report", "Exporting merge report...");
        setMergerStatus("Exporting merge report...");
        try {
            const result = await window.spikeApi.modMergerExportReport();
            await refreshMergerProgressStatus();
            if (result.ok) {
                state.merger.lastReportPath = result.reportPath;
            }
            setMergerStatus(result.message);
        } catch (error) {
            await refreshMergerProgressStatus();
            const message = error instanceof Error ? error.message : String(error || "Unknown merger export error");
            setMergerStatus(message);
        }
    }

    async function openMergerOutputFolder() {
        const targetPath = state.merger.lastBuildOutputPath || state.merger.plan?.outputModPath;
        if (!targetPath) {
            setMergerStatus("No merger output path is available yet.");
            return;
        }

        const opened = await window.spikeApi.openPathInFileExplorer(targetPath);
        setMergerStatus(opened ? "Opened merger output folder." : "Could not open merger output folder.");
    }

    function hookMergerControls() {
        byId("mergerAnalyzeBtn")?.addEventListener("click", () => void runMergerAnalysis());
        byId("mergerResultsScanBtn")?.addEventListener("click", () => void runMergerAnalysis());
        byId("mergerOpenResultsBtn")?.addEventListener("click", () => void openMergerResultsWindow());
        byId("mergerAutoBtn")?.addEventListener("click", () => void runMergerApplyAuto());
        byId("mergerResultsAutoBtn")?.addEventListener("click", () => void runMergerApplyAuto());
        byId("mergerBuildBtn")?.addEventListener("click", () => void runMergerBuild());
        byId("mergerResultsBuildBtn")?.addEventListener("click", () => void runMergerBuild());
        byId("mergerOpenOutputBtn")?.addEventListener("click", () => void openMergerOutputFolder());
        byId("mergerExportReportBtn")?.addEventListener("click", () => void runMergerExportReport());
        for (const button of document.querySelectorAll("[data-merger-results-filter]")) {
            button.addEventListener("click", () => {
                state.merger.resultsFilter = button.getAttribute("data-merger-results-filter") || "needs-action";
                renderMergerResultsWorkspace();
            });
        }
        for (const button of document.querySelectorAll("[data-merger-results-mode]")) {
            button.addEventListener("click", () => {
                state.merger.resultsMode = button.getAttribute("data-merger-results-mode") || "review";
                renderMergerResultsWorkspace();
            });
        }
    }

    return {
        hookMergerControls,
        refreshMergerPlan,
        renderMergerResultsWorkspace,
        syncMergerButtons
    };
}
