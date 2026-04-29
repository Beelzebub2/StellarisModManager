import { byId, escapeHtml, formatInteger, formatUtc, setText, toDisplayValue } from "../runtime/dom.js";
import { iconSvg } from "../runtime/icons.js";
import { showChoiceModal, showModal, showPrompt } from "../runtime/modal.js";
import { getDefaultSettingsModel } from "../runtime/settingsModel.js";
import { state } from "../runtime/state.js";
import { setGlobalStatus, setLibraryStatus } from "../runtime/status.js";
import { formatVersionBadgeValue } from "../runtime/versionLoading.js";
import { parseSharedProfileSyncInput } from "../runtime/workshopInput.js";

const libraryVisibility = globalThis.libraryVisibility || {};

export function createLibraryWorkspaceController({
    activateTab,
    activateTabGuarded,
    ensurePublicUsernameConfigured,
    queueAction,
    queueDownloadAction,
    refreshQueueSnapshot,
    syncVisibleVersionCardActionStates
}) {
    function getActiveLibraryProfile() {
        const s = state.library.snapshot;
        return s ? s.profiles.find((p) => p.id === s.activeProfileId) || null : null;
    }

    function getSelectedLibraryMod() {
        const s = state.library.snapshot;
        return s ? s.mods.find((m) => m.id === state.library.selectedModId) || null : null;
    }

    function getLibraryModById(modId) {
        const s = state.library.snapshot;
        return s ? s.mods.find((m) => m.id === modId) || null : null;
    }

    function getEnabledLibraryModsOrdered() {
        const s = state.library.snapshot;
        if (!s) return [];
        return s.mods
            .filter((m) => m.isEnabled)
            .sort((a, b) => a.loadOrder - b.loadOrder || a.name.localeCompare(b.name));
    }

    function buildManualLoadOrderPreview(modId, targetIndex) {
        const enabledMods = getEnabledLibraryModsOrdered();
        const sourceIndex = enabledMods.findIndex((m) => m.id === modId);
        if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= enabledMods.length || sourceIndex === targetIndex) {
            return null;
        }

        const proposedMods = enabledMods.slice();
        const [moved] = proposedMods.splice(sourceIndex, 1);
        proposedMods.splice(targetIndex, 0, moved);
        const changes = [];
        for (let i = 0; i < proposedMods.length; i++) {
            const mod = proposedMods[i];
            const fromIndex = enabledMods.findIndex((entry) => entry.id === mod.id);
            if (fromIndex !== i) {
                changes.push({
                    modId: mod.id,
                    workshopId: mod.workshopId,
                    name: mod.name,
                    fromIndex,
                    toIndex: i
                });
            }
        }

        return {
            ok: true,
            message: "Review the manual load-order change before applying it.",
            orderedWorkshopIds: proposedMods.map((mod) => mod.workshopId).filter(Boolean),
            changes,
            appliedRules: [],
            appliedEdges: [],
            warnings: [],
            confidence: "high"
        };
    }

    function formatLoadOrderPosition(index) {
        return index >= 0 ? `#${index + 1}` : "Disabled";
    }

    function buildLoadOrderPreviewHtml(preview, extraHtml = "") {
        const changes = Array.isArray(preview?.changes) ? preview.changes : [];
        const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
        const rules = Array.isArray(preview?.appliedRules) ? preview.appliedRules : [];
        const edges = Array.isArray(preview?.appliedEdges) ? preview.appliedEdges : [];
        const changesHtml = changes.length > 0
            ? changes.slice(0, 18).map((change) => `
                <li class="load-order-preview-row">
                    <span class="load-order-preview-position">${escapeHtml(formatLoadOrderPosition(change.fromIndex))}</span>
                    <strong class="load-order-preview-title">${escapeHtml(change.name || change.workshopId || `Mod ${change.modId}`)}</strong>
                    <span class="load-order-preview-direction">${escapeHtml(formatLoadOrderPosition(change.toIndex))}</span>
                </li>
            `).join("")
            : `
                <li class="load-order-preview-empty">
                    <strong class="load-order-preview-empty-title">No order moves</strong>
                    <p class="load-order-preview-empty-copy">The current order already matches this preview.</p>
                </li>
            `;
        const warningHtml = warnings.length > 0
            ? `<div class="load-order-preview-warnings">${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>`
            : "";

        return `
            <div class="modal-extra-load-order">
                <div class="load-order-preview-metrics">
                    <span class="status-chip">${changes.length} move${changes.length === 1 ? "" : "s"}</span>
                    <span class="status-chip status-chip-muted">Confidence: ${escapeHtml(preview?.confidence || "unknown")}</span>
                    <span class="status-chip status-chip-muted">${rules.length} rule${rules.length === 1 ? "" : "s"}</span>
                    <span class="status-chip status-chip-muted">${edges.length} edge${edges.length === 1 ? "" : "s"}</span>
                </div>
                ${extraHtml}
                ${warningHtml}
                <ol class="load-order-preview-list">${changesHtml}</ol>
            </div>
        `;
    }

    async function showLoadOrderPreviewModal(title, preview, confirmLabel = "Apply order", extraHtml = "") {
        const choice = await showChoiceModal(
            title,
            preview?.message || "Review the proposed load-order changes before applying them.",
            {
                confirmLabel,
                cancelLabel: "Cancel",
                alternateLabel: "Keep current order",
                detailHtml: buildLoadOrderPreviewHtml(preview, extraHtml)
            }
        );

        return choice === "confirm";
    }

    async function confirmManualLoadOrderChange(modId, targetIndex, title = "Confirm Load-Order Change") {
        const preview = buildManualLoadOrderPreview(modId, targetIndex);
        if (!preview) {
            setLibraryStatus("No load-order change needed.");
            return false;
        }

        return showLoadOrderPreviewModal(title, preview, "Move mod");
    }

    async function confirmEnableStateChange(mod, willEnable) {
        if (!mod) {
            return false;
        }

        const action = willEnable ? "Enable" : "Disable";
        const preview = {
            ok: true,
            message: `${action} '${mod.name}'? This updates the enabled set and may renumber load order.`,
            orderedWorkshopIds: getEnabledLibraryModsOrdered().map((entry) => entry.workshopId).filter(Boolean),
            changes: [],
            appliedRules: [],
            appliedEdges: [],
            warnings: [],
            confidence: "medium"
        };
        const extraHtml = `<p class="load-order-preview-note">${escapeHtml(action)} ${escapeHtml(mod.name)} (${escapeHtml(mod.workshopId || "local mod")}).</p>`;
        return showLoadOrderPreviewModal(`${action} Mod`, preview, action, extraHtml);
    }

    async function showSharedProfileSyncPreview(preview) {
        const enableNames = Array.isArray(preview?.enableModNames) ? preview.enableModNames : [];
        const disableNames = Array.isArray(preview?.disableModNames) ? preview.disableModNames : [];
        const missingIds = Array.isArray(preview?.missingWorkshopIds) ? preview.missingWorkshopIds : [];
        const extraHtml = `
            <div class="shared-sync-preview-grid">
                <div class="shared-sync-preview-card"><span>Enable</span><strong>${enableNames.length}</strong></div>
                <div class="shared-sync-preview-card"><span>Disable</span><strong>${disableNames.length}</strong></div>
                <div class="shared-sync-preview-card"><span>Missing locally</span><strong>${missingIds.length}</strong></div>
            </div>
            ${enableNames.length > 0 ? `<p class="load-order-preview-note">Will enable: ${escapeHtml(enableNames.slice(0, 6).join(", "))}${enableNames.length > 6 ? "..." : ""}</p>` : ""}
            ${disableNames.length > 0 ? `<p class="load-order-preview-note">Will disable: ${escapeHtml(disableNames.slice(0, 6).join(", "))}${disableNames.length > 6 ? "..." : ""}</p>` : ""}
            ${missingIds.length > 0 ? `<p class="load-order-preview-note">Missing workshop IDs: ${escapeHtml(missingIds.slice(0, 8).join(", "))}${missingIds.length > 8 ? "..." : ""}</p>` : ""}
        `;

        return showLoadOrderPreviewModal("Confirm Shared Profile Sync", preview, "Sync profile", extraHtml);
    }

    async function showProfileActivationPreview(preview) {
        const enableNames = Array.isArray(preview?.enableModNames) ? preview.enableModNames : [];
        const disableNames = Array.isArray(preview?.disableModNames) ? preview.disableModNames : [];
        const extraHtml = `
            <div class="shared-sync-preview-grid">
                <div class="shared-sync-preview-card"><span>Enable</span><strong>${enableNames.length}</strong></div>
                <div class="shared-sync-preview-card"><span>Disable</span><strong>${disableNames.length}</strong></div>
                <div class="shared-sync-preview-card"><span>Moves</span><strong>${Array.isArray(preview?.changes) ? preview.changes.length : 0}</strong></div>
                <div class="shared-sync-preview-card"><span>Profile</span><strong>${escapeHtml(preview?.profileName || "Selected profile")}</strong></div>
            </div>
            ${enableNames.length > 0 ? `<p class="load-order-preview-note">Will enable: ${escapeHtml(enableNames.slice(0, 6).join(", "))}${enableNames.length > 6 ? "..." : ""}</p>` : ""}
            ${disableNames.length > 0 ? `<p class="load-order-preview-note">Will disable: ${escapeHtml(disableNames.slice(0, 6).join(", "))}${disableNames.length > 6 ? "..." : ""}</p>` : ""}
        `;

        return showLoadOrderPreviewModal("Activate Library Profile", preview, "Activate profile", extraHtml);
    }

    async function activateLibraryProfileWithPreview(profileId) {
        if (state.library.snapshot?.activeProfileId === profileId) {
            return true;
        }

        const preview = await window.spikeApi.previewLibraryProfileActivation(profileId);
        if (!preview.ok) {
            setLibraryStatus(preview.message);
            return false;
        }

        if (!await showProfileActivationPreview(preview)) {
            setLibraryStatus("Profile activation cancelled.");
            return false;
        }

        const result = await window.spikeApi.activateLibraryProfile(profileId);
        setLibraryStatus(result.message);
        await refreshLibrarySnapshot();
        return result.ok === true;
    }

    function buildRemoveModLoadOrderPreview(mod) {
        const enabledMods = getEnabledLibraryModsOrdered();
        const sourceIndex = enabledMods.findIndex((entry) => entry.id === mod.id);
        const proposedMods = enabledMods.filter((entry) => entry.id !== mod.id);
        const changes = [];

        for (let i = 0; i < proposedMods.length; i++) {
            const entry = proposedMods[i];
            const fromIndex = enabledMods.findIndex((candidate) => candidate.id === entry.id);
            if (fromIndex !== i) {
                changes.push({
                    modId: entry.id,
                    workshopId: entry.workshopId,
                    name: entry.name,
                    fromIndex,
                    toIndex: i
                });
            }
        }

        return {
            ok: true,
            message: sourceIndex >= 0
                ? `Remove '${mod.name}'? This will uninstall the mod and renumber the enabled load order.`
                : `Remove '${mod.name}'? This mod is disabled, so the enabled load order will not change.`,
            orderedWorkshopIds: proposedMods.map((entry) => entry.workshopId).filter(Boolean),
            changes,
            appliedRules: [],
            appliedEdges: [],
            warnings: [],
            confidence: "high"
        };
    }

    async function confirmRemoveLibraryMod(mod) {
        if (!mod) {
            return false;
        }

        const enabledMods = getEnabledLibraryModsOrdered();
        const sourceIndex = enabledMods.findIndex((entry) => entry.id === mod.id);
        const extraHtml = `<p class="load-order-preview-note">Will uninstall ${escapeHtml(mod.name)} (${escapeHtml(mod.workshopId || "local mod")}). Current enabled position: ${escapeHtml(formatLoadOrderPosition(sourceIndex))}.</p>`;
        return showLoadOrderPreviewModal("Remove Mod", buildRemoveModLoadOrderPreview(mod), "Remove", extraHtml);
    }

    function selectLibraryMod(modId) {
        if (!Number.isFinite(modId) || modId <= 0 || state.library.selectedModId === modId) {
            return false;
        }

        state.library.selectedModId = modId;
        state.library.descriptorTagsExpanded = false;
        restoreLibraryTagDraftForSelectedMod();
        renderLibraryList();
        return true;
    }

    function openLibraryModWorkshop(mod) {
        if (!mod?.workshopId) {
            return;
        }

        const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`;
        state.workshopReturnContext = null;
        activateTab("workshop");
        const webview = byId("workshopWebview");
        if (webview) webview.loadURL(url);
        const urlInput = byId("workshopUrl");
        if (urlInput) urlInput.value = url;
    }

    async function openLibraryModLocation(mod) {
        if (!mod) {
            return;
        }

        const ok = await window.spikeApi.openPathInFileExplorer(mod.installedPath || mod.descriptorPath);
        setLibraryStatus(ok ? "Opened file location." : "Could not open file location.");
    }

    async function runLibraryModContextMenuCommand(command, modId) {
        const mod = getLibraryModById(modId);
        if (!mod) {
            return;
        }

        if (state.selectedTab !== "library") {
            await activateTabGuarded("library");
        }
        selectLibraryMod(modId);

        if (command === "view-details") {
            return;
        }

        if (command === "update-mod" || command === "reinstall-mod") {
            await queueAction(mod.workshopId, "install", "library");
            return;
        }

        if (command === "open-workshop") {
            openLibraryModWorkshop(mod);
            return;
        }

        if (command === "open-location") {
            await openLibraryModLocation(mod);
            return;
        }

        if (command === "remove-mod") {
            await removeLibraryModWithFeedback(mod);
        }
    }

    async function persistHideDisabledMods(hide) {
        if (!state.settingsModel) {
            state.settingsModel = getDefaultSettingsModel();
        }

        if (state.settingsModel.hideDisabledMods === hide) {
            return;
        }

        state.settingsModel.hideDisabledMods = hide;
        try {
            const result = await window.spikeApi.saveSettings({ ...state.settingsModel });
            if (result?.ok && result.settings) {
                state.settingsModel = result.settings;
            }
        } catch {
            // non-fatal; the in-memory toggle still works for this session
        }
    }

    function getFilteredLibraryMods() {
        const s = state.library.snapshot;
        if (!s) return [];
        const search = state.library.searchText.trim().toLowerCase();
        return s.mods
            .filter((m) => {
                if (state.library.showEnabledOnly && !m.isEnabled) return false;
                if (!search) return true;
                return m.name.toLowerCase().includes(search) || m.workshopId.includes(search);
            })
            .sort((a, b) => {
                if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
                if (a.loadOrder !== b.loadOrder) return a.loadOrder - b.loadOrder;
                return a.name.localeCompare(b.name);
            });
    }

    function normalizeTagKey(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    function normalizeTagList(values) {
        if (!Array.isArray(values)) {
            return [];
        }

        const deduped = [];
        const seen = new Set();
        for (const value of values) {
            const key = normalizeTagKey(value);
            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            deduped.push(key);
        }

        return deduped;
    }

    function getLibraryReportVersionForMod(mod) {
        if (!mod) {
            return "";
        }

        const snapshotVersion = String(state.library.snapshot?.lastDetectedGameVersion || "").trim();
        const modVersion = String(mod.gameVersion || "").trim();
        return snapshotVersion || modVersion;
    }

    function getLibraryTagDraftKey(mod) {
        if (!mod || !mod.workshopId) {
            return "";
        }

        const version = getLibraryReportVersionForMod(mod);
        return `${mod.workshopId}::${version || "unknown"}`;
    }

    function persistLibraryTagDraftForSelectedMod() {
        const mod = getSelectedLibraryMod();
        const key = getLibraryTagDraftKey(mod);
        if (!key) {
            return;
        }

        state.library.savedReportTagsByModVersion[key] = normalizeTagList(state.library.selectedReportTags);
    }

    function restoreLibraryTagDraftForSelectedMod() {
        const mod = getSelectedLibraryMod();
        const key = getLibraryTagDraftKey(mod);
        if (!key) {
            state.library.selectedReportTags = [];
            return;
        }

        const draft = state.library.savedReportTagsByModVersion[key];
        state.library.selectedReportTags = normalizeTagList(draft);
    }

    function renderLibraryReportTagList() {
        const list = byId("libraryReportTagList");
        if (!list) return;

        const tags = state.library.availableTags || [];
        if (tags.length <= 0) {
            list.innerHTML = "<p class='muted'>No tags loaded from Stellarisync.</p>";
            return;
        }

        const selected = new Set(state.library.selectedReportTags || []);
        list.innerHTML = tags.map((tag) => {
            const key = normalizeTagKey(tag.key);
            const activeClass = selected.has(key) ? " is-selected" : "";
            const title = tag.description ? ` title="${escapeHtml(tag.description)}"` : "";
            return `<button type=\"button\" class=\"library-report-tag${activeClass}\" data-tag-key=\"${escapeHtml(key)}\"${title}>${escapeHtml(tag.label)}</button>`;
        }).join("\n");

        for (const button of list.querySelectorAll("button[data-tag-key]")) {
            button.addEventListener("click", () => {
                const key = normalizeTagKey(button.getAttribute("data-tag-key") || "");
                if (!key) return;

                if (state.library.selectedReportTags.includes(key)) {
                    state.library.selectedReportTags = state.library.selectedReportTags.filter((value) => value !== key);
                } else {
                    state.library.selectedReportTags = [...state.library.selectedReportTags, key];
                }

                state.library.selectedReportTags = normalizeTagList(state.library.selectedReportTags);

                renderLibraryReportTagList();
                renderSelectedTagsInfo();
            });
        }
    }

    function renderSelectedTagsInfo() {
        if (!state.library.selectedReportTags || state.library.selectedReportTags.length <= 0) {
            setText("librarySelectedTagsInfo", "No tags selected.");
            return;
        }

        const count = state.library.selectedReportTags.length;
        const noun = count === 1 ? "tag" : "tags";
        setText("librarySelectedTagsInfo", `${count} ${noun} selected.`);
    }

    function formatConsensusLabel(value) {
        const normalized = String(value || "")
            .replaceAll("_", " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!normalized) {
            return "Unknown";
        }

        return normalized
            .split(" ")
            .map((word) => (word ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : ""))
            .join(" ");
    }

    function getDescriptorTagEntries(mod) {
        const entries = [];
        const seen = new Set();

        for (const rawTag of mod?.tags || []) {
            const label = String(rawTag || "").trim();
            const key = normalizeTagKey(label);
            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            entries.push({ key, label });
        }

        return entries;
    }

    function getDescriptorTagKeySet(mod) {
        const keys = new Set();
        for (const entry of getDescriptorTagEntries(mod)) {
            keys.add(entry.key);
        }
        return keys;
    }

    function updateDescriptorTagsToggle() {
        const list = byId("libraryDetailTags");
        const toggle = byId("libraryDetailTagsToggle");
        if (!list || !toggle) {
            return;
        }

        const hasChips = list.querySelector(".tag") !== null;
        if (!hasChips) {
            toggle.hidden = true;
            return;
        }

        const overflowed = list.scrollHeight > (list.clientHeight + 1);
        const shouldShowToggle = state.library.descriptorTagsExpanded || overflowed;
        toggle.hidden = !shouldShowToggle;
        toggle.textContent = state.library.descriptorTagsExpanded ? "Show less" : "Show all";
    }

    function renderDescriptorTags(mod) {
        const tagsEl = byId("libraryDetailTags");
        if (!tagsEl) {
            return;
        }

        const descriptorTags = getDescriptorTagEntries(mod);
        const trustedKeys = new Set(
            (mod?.communityCompatibility?.tagConsensus || [])
                .filter((entry) => entry.state === "trusted")
                .map((entry) => normalizeTagKey(entry.tagKey || entry.tagLabel || ""))
                .filter(Boolean)
        );

        if (descriptorTags.length === 0) {
            tagsEl.innerHTML = "<span class='muted'>No tags.</span>";
            tagsEl.classList.remove("is-clamped", "is-expanded");
            updateDescriptorTagsToggle();
            return;
        }

        tagsEl.innerHTML = descriptorTags.map((entry) => {
            const overlapClass = trustedKeys.has(entry.key) ? " tag-overlap" : "";
            const overlapTitle = trustedKeys.has(entry.key) ? " title=\"Also trusted by community\"" : "";
            return `<span class=\"tag${overlapClass}\"${overlapTitle}>${escapeHtml(entry.label)}</span>`;
        }).join("");

        tagsEl.classList.toggle("is-expanded", state.library.descriptorTagsExpanded);
        tagsEl.classList.toggle("is-clamped", !state.library.descriptorTagsExpanded);
        updateDescriptorTagsToggle();
    }

    function renderCommunityConsensus(mod, descriptorTagKeys = new Set()) {
        const summary = mod?.communityCompatibility || null;
        const stateBadge = byId("feedbackStateBadge");
        const barWorks = byId("consensusBarWorks");
        const barBroken = byId("consensusBarBroken");
        const trustedSection = byId("feedbackTrustedTags");
        const trustedList = byId("feedbackTrustedTagList");
        const disputedSection = byId("feedbackDisputedGroups");
        const disputedText = byId("feedbackDisputedText");
        const worksBtn = byId("libraryActionWorks");
        const brokenBtn = byId("libraryActionBroken");

        if (worksBtn) worksBtn.classList.remove("is-voted");
        if (brokenBtn) brokenBtn.classList.remove("is-voted");

        if (!summary) {
            if (stateBadge) {
                stateBadge.textContent = "No data";
                stateBadge.className = "feedback-state-badge feedback-state-nodata";
            }
            if (barWorks) barWorks.style.width = "0%";
            if (barBroken) barBroken.style.width = "0%";
            setText("consensusWorksLabel", "0 works");
            setText("consensusTotalLabel", "0 reports");
            setText("consensusBrokenLabel", "0 broken");
            if (trustedSection) trustedSection.classList.add("hidden");
            if (disputedSection) disputedSection.classList.add("hidden");
            return;
        }

        const total = Number(summary.totalReports || 0);
        const works = Number(summary.workedCount || 0);
        const broken = Number(summary.notWorkedCount || 0);
        const worksPercent = total > 0 ? Math.round((works * 100) / total) : 0;
        const brokenPercent = total > 0 ? 100 - worksPercent : 0;

        // State badge
        const rawState = String(summary.state || "no_data");
        const stateLabel = formatConsensusLabel(rawState);
        if (stateBadge) {
            stateBadge.textContent = stateLabel;
            if (rawState === "trusted") {
                stateBadge.className = "feedback-state-badge feedback-state-trusted";
            } else if (rawState === "disputed") {
                stateBadge.className = "feedback-state-badge feedback-state-disputed";
            } else if (rawState === "insufficient_votes") {
                stateBadge.className = "feedback-state-badge feedback-state-insufficient";
            } else {
                stateBadge.className = "feedback-state-badge feedback-state-nodata";
            }
        }

        // Consensus bar
        if (barWorks) barWorks.style.width = `${worksPercent}%`;
        if (barBroken) barBroken.style.width = `${brokenPercent}%`;

        // Stats
        setText("consensusWorksLabel", `${works} works`);
        setText("consensusTotalLabel", `${total} report${total !== 1 ? "s" : ""}`);
        setText("consensusBrokenLabel", `${broken} broken`);

        // Highlight the user's current vote
        const reporterId = state.settingsModel?.compatibilityReporterId || "";
        if (reporterId && summary.userVotes) {
            const myVote = summary.userVotes[reporterId.toLowerCase()] || "";
            if (myVote === "worked" && worksBtn) worksBtn.classList.add("is-voted");
            if (myVote === "not_worked" && brokenBtn) brokenBtn.classList.add("is-voted");
        }

        // Trusted community tags
        const trustedTags = (summary.tagConsensus || [])
            .filter((entry) => entry.state === "trusted")
            .sort((a, b) => b.votes - a.votes)
            .slice(0, 5);

        if (trustedTags.length > 0 && trustedSection && trustedList) {
            trustedSection.classList.remove("hidden");
            trustedList.innerHTML = trustedTags.map((entry) => {
                const entryKey = normalizeTagKey(entry.tagKey || entry.tagLabel || "");
                const overlapClass = descriptorTagKeys.has(entryKey) ? " is-overlap" : "";
                const overlapBadge = descriptorTagKeys.has(entryKey)
                    ? "<span class=\"feedback-trusted-tag-overlap\">match</span>"
                    : "";
                return `<span class=\"feedback-trusted-tag${overlapClass}\">${escapeHtml(entry.tagLabel)} <span class=\"feedback-trusted-tag-confidence\">${entry.confidencePercent}%</span>${overlapBadge}</span>`;
            }).join("");
        } else if (trustedSection) {
            trustedSection.classList.add("hidden");
        }

        // Disputed groups
        const disputedGroups = (summary.groupConsensus || [])
            .filter((entry) => entry.state === "disputed");

        if (disputedGroups.length > 0 && disputedSection && disputedText) {
            disputedSection.classList.remove("hidden");
            const lines = disputedGroups.map((entry) => {
                const options = (entry.options || [])
                    .map((option) => `${option.tagLabel} (${option.votes})`)
                    .join(" vs ");
                const groupLabel = formatConsensusLabel(entry.groupLabel || entry.groupKey || "group");
                return `${groupLabel}: ${options}`;
            });
            disputedText.textContent = `Disputed: ${lines.join("; ")}`;
        } else if (disputedSection) {
            disputedSection.classList.add("hidden");
        }
    }

    function renderLibraryDetail(mod) {
        const empty = byId("libraryDetailEmpty");
        const detail = byId("libraryDetail");
        const mpSafe = byId("libraryDetailMpSafe");
        const hasUpdate = byId("libraryDetailHasUpdate");

        if (!mod) {
            if (empty) empty.classList.remove("hidden");
            if (detail) detail.classList.add("hidden");
            renderDescriptorTags(null);
            renderCommunityConsensus(null, new Set());
            renderLibraryReportTagList();
            renderSelectedTagsInfo();
            return;
        }

        if (empty) empty.classList.add("hidden");
        if (detail) detail.classList.remove("hidden");

        setText("libraryDetailName", mod.name);
        setText("libraryDetailWorkshopId", mod.workshopId || "Ã¢â‚¬â€");
        setText("libraryDetailVersion", toDisplayValue(mod.version));
        setText("libraryDetailGameVersion", toDisplayValue(mod.gameVersion));
        setText("libraryDetailInstalledAt", formatUtc(mod.lastUpdatedAtUtc || mod.installedAtUtc));

        // Subscriber chip
        const subChip = byId("libraryDetailSubscribersChip");
        if (subChip) {
            if (mod.totalSubscribers > 0) {
                subChip.textContent = `${formatInteger(mod.totalSubscribers)} subscribers`;
                subChip.classList.remove("hidden");
            } else {
                subChip.classList.add("hidden");
            }
        }

        // Thumbnail
        const thumb = byId("libraryDetailThumb");
        const thumbFallback = byId("libraryDetailThumbFallback");
        if (mod.thumbnailUrl) {
            if (thumb) { thumb.src = mod.thumbnailUrl; thumb.classList.remove("hidden"); }
            if (thumbFallback) thumbFallback.classList.add("hidden");
        } else {
            if (thumb) { thumb.src = ""; thumb.classList.add("hidden"); }
            if (thumbFallback) {
                thumbFallback.textContent = (mod.name || "?").slice(0, 1).toUpperCase();
                thumbFallback.classList.remove("hidden");
            }
        }

        if (mpSafe) mpSafe.classList.toggle("hidden", !mod.isMultiplayerSafe);
        if (hasUpdate) hasUpdate.classList.toggle("hidden", !mod.hasUpdate);

        renderDescriptorTags(mod);
        renderCommunityConsensus(mod, getDescriptorTagKeySet(mod));
        renderLibraryReportTagList();
        renderSelectedTagsInfo();
    }

    function renderLibraryList() {
        const list = byId("libraryList");
        if (!list) return;
        const mods = getFilteredLibraryMods();
        const previousSelectedModId = state.library.selectedModId;

        if (mods.length === 0) {
            list.innerHTML = "<div class='library-empty muted'>No installed mods match the current filter.</div>";
            renderLibraryDetail(null);
            return;
        }

        if (!mods.some((m) => m.id === state.library.selectedModId)) {
            state.library.selectedModId = mods[0].id;
        }

        if (previousSelectedModId !== state.library.selectedModId) {
            restoreLibraryTagDraftForSelectedMod();
            state.library.descriptorTagsExpanded = false;
        }

        function renderLibraryAchievementIndicator(mod) {
            if (!mod || mod.achievementStatus === "unknown") {
                return "";
            }

            const isCompatible = mod.achievementStatus === "compatible";
            const title = isCompatible ? "Achievement compatible" : "Disables achievements";
            const indicatorClass = isCompatible
                ? "library-achievement-indicator library-achievement-compatible"
                : "library-achievement-indicator library-achievement-not-compatible";
            const iconName = isCompatible ? "achievement" : "achievementBroken";

            return `<span class="${indicatorClass}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${iconSvg(iconName)}</span>`;
        }

        list.innerHTML = mods.map((mod) => {
            const sel = mod.id === state.library.selectedModId ? " is-selected" : "";
            const isRemoving = state.library.removingModIds.has(mod.id);
            const updateBadge = mod.hasUpdate ? "<span class='badge badge-version'>Update</span>" : "";
            const mpBadge = mod.isMultiplayerSafe ? "<span class='badge badge-community'>MP safe</span>" : "";
            const removingBadge = isRemoving ? "<span class='badge badge-danger'>Removing...</span>" : "";
            const achievementIndicator = renderLibraryAchievementIndicator(mod);
            const versionLabel = formatVersionBadgeValue(mod.version);
            const loadOrderLabel = mod.isEnabled ? formatLoadOrderPosition(mod.loadOrder) : "Disabled";
            return `
                <article class="library-row${sel}${isRemoving ? " is-removing" : ""}" data-mod-id="${mod.id}" draggable="${mod.isEnabled && !isRemoving ? "true" : "false"}">
                    <div class="library-cell library-enabled">
                        <input type="checkbox" data-action="toggle-enabled" data-mod-id="${mod.id}" ${mod.isEnabled ? "checked" : ""} ${isRemoving ? "disabled" : ""} />
                    </div>
                    <div class="library-cell library-name">
                        <p class="library-row-title">${escapeHtml(mod.name)}</p>
                        <div class="library-row-badges">
                            ${achievementIndicator}
                            <span class="badge">${escapeHtml(versionLabel)}</span>
                            ${mpBadge}${updateBadge}${removingBadge}
                        </div>
                    </div>
                    <div class="library-cell library-order">
                        <span class="badge">${escapeHtml(loadOrderLabel)}</span>
                    </div>
                    <div class="library-cell library-actions">
                        <button type="button" class="button-icon" data-action="move-up" data-mod-id="${mod.id}" ${!mod.isEnabled || isRemoving ? "disabled" : ""} title="Move up">${iconSvg("chevronUp")}</button>
                        <button type="button" class="button-icon" data-action="move-down" data-mod-id="${mod.id}" ${!mod.isEnabled || isRemoving ? "disabled" : ""} title="Move down">${iconSvg("chevronDown")}</button>
                        <button type="button" class="button-icon button-danger${isRemoving ? " is-spinning" : ""}" data-action="remove-mod" data-mod-id="${mod.id}" ${isRemoving ? "disabled" : ""} title="${isRemoving ? "Removing" : "Remove"}">${iconSvg(isRemoving ? "refresh" : "trash")}</button>
                    </div>
                </article>`;
        }).join("\n");

        renderLibraryDetail(getSelectedLibraryMod());
    }

    function clearLibraryDragDecorations(list) {
        for (const row of list.querySelectorAll(".library-row")) {
            row.classList.remove("drag-over-top", "drag-over-bottom", "is-dragging");
        }
        list.classList.remove("is-drag-active");
    }

    function syncLibraryEnabledOnlyToggle() {
        const toggle = byId("libraryEnabledOnly");
        if (toggle) {
            toggle.checked = state.library.showEnabledOnly === true;
        }
    }

    async function revealNewlyAddedDisabledMods(previousSnapshot) {
        const previousMods = previousSnapshot?.mods || [];
        const nextMods = state.library.snapshot?.mods || [];
        const helper = libraryVisibility.getNewlyAddedDisabledMods;
        if (typeof helper !== "function") {
            return false;
        }

        const hiddenMods = helper(previousMods, nextMods, state.library.showEnabledOnly);
        if (hiddenMods.length <= 0) {
            return false;
        }

        state.library.showEnabledOnly = false;
        syncLibraryEnabledOnlyToggle();
        renderLibraryList();
        await persistHideDisabledMods(false);

        const formatMessage = libraryVisibility.getRevealDisabledModsMessage;
        const message = typeof formatMessage === "function"
            ? formatMessage(hiddenMods.length)
            : "Newly added mods were hidden by Enabled only. Showing all mods.";
        setLibraryStatus(message);
        return true;
    }

    async function removeLibraryModWithFeedback(mod) {
        if (!mod || state.library.removingModIds.has(mod.id)) {
            return;
        }

        if (!await confirmRemoveLibraryMod(mod)) {
            setLibraryStatus("Remove cancelled.");
            return;
        }

        state.library.removingModIds.add(mod.id);
        renderLibraryList();
        setLibraryStatus(`Removing ${mod.name}...`);

        try {
            const result = await window.spikeApi.uninstallLibraryMod(mod.id);
            setLibraryStatus(result.message);
            await refreshLibrarySnapshot();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLibraryStatus(`Failed to remove ${mod.name}: ${message}`);
        } finally {
            state.library.removingModIds.delete(mod.id);
            renderLibraryList();
        }
    }

    async function handleLibraryDrop(list, row, clientY, sourceId) {
        if (!row || row.getAttribute("draggable") !== "true") return;

        const targetId = Number.parseInt(row.getAttribute("data-mod-id") || "0", 10);
        if (!sourceId || !targetId || sourceId === targetId || !state.library.snapshot) return;

        const enabledMods = state.library.snapshot.mods
            .filter((m) => m.isEnabled)
            .sort((a, b) => a.loadOrder - b.loadOrder);

        const rect = row.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const insertAfter = clientY >= midpoint;

        let targetIndex = enabledMods.findIndex((m) => m.id === targetId);
        if (targetIndex === -1) return;

        if (insertAfter) {
            targetIndex++;
        }

        const sourceIndex = enabledMods.findIndex((m) => m.id === sourceId);
        if (sourceIndex !== -1 && sourceIndex < targetIndex) {
            targetIndex--;
        }

        if (!await confirmManualLoadOrderChange(sourceId, targetIndex, "Confirm Drag Reorder")) {
            clearLibraryDragDecorations(list);
            return;
        }

        const result = await window.spikeApi.reorderLibraryMod({ modId: sourceId, targetIndex });
        setLibraryStatus(result.message);
        await refreshLibrarySnapshot();
        clearLibraryDragDecorations(list);
    }

    function hookLibraryListDelegation() {
        const list = byId("libraryList");
        if (!list || list.getAttribute("data-events-bound") === "1") {
            return;
        }

        list.setAttribute("data-events-bound", "1");

        list.addEventListener("click", async (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const toggleInput = target.closest("input[data-action='toggle-enabled']");
            if (toggleInput) {
                event.stopPropagation();
                return;
            }

            const button = target.closest("button[data-action]");
            if (button) {
                event.stopPropagation();
                const modId = Number.parseInt(button.getAttribute("data-mod-id") || "0", 10);
                if (!Number.isFinite(modId) || modId <= 0) {
                    return;
                }

                const action = button.getAttribute("data-action") || "";
                if (action === "move-up" || action === "move-down") {
                    const direction = action === "move-up" ? "up" : "down";
                    const enabledMods = getEnabledLibraryModsOrdered();
                    const sourceIndex = enabledMods.findIndex((mod) => mod.id === modId);
                    const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
                    if (!await confirmManualLoadOrderChange(modId, targetIndex, "Confirm Load-Order Move")) {
                        return;
                    }
                    const result = await window.spikeApi.moveLibraryMod({ modId, direction });
                    setLibraryStatus(result.message);
                    await refreshLibrarySnapshot();
                    return;
                }

                if (action === "remove-mod") {
                    const mod = getLibraryModById(modId);
                    if (!mod) {
                        return;
                    }

                    await removeLibraryModWithFeedback(mod);
                }

                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row)) {
                return;
            }

            const id = Number.parseInt(row.getAttribute("data-mod-id") || "0", 10);
            if (!Number.isFinite(id) || id <= 0) {
                return;
            }
            selectLibraryMod(id);
        });

        list.addEventListener("change", async (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }

            if (target.getAttribute("data-action") !== "toggle-enabled") {
                return;
            }

            const id = Number.parseInt(target.getAttribute("data-mod-id") || "0", 10);
            if (!Number.isFinite(id) || id <= 0) return;

            const mod = getLibraryModById(id);
            const nextChecked = target.checked === true;
            if (!await confirmEnableStateChange(mod, nextChecked)) {
                target.checked = !nextChecked;
                return;
            }

            const result = await window.spikeApi.setLibraryModEnabled({ modId: id, isEnabled: target.checked === true });
            setLibraryStatus(result.message);
            await refreshLibrarySnapshot();
        });

        list.addEventListener("contextmenu", async (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row)) {
                return;
            }

            const modId = Number.parseInt(row.getAttribute("data-mod-id") || "0", 10);
            if (!Number.isFinite(modId) || modId <= 0) {
                return;
            }

            event.preventDefault();
            selectLibraryMod(modId);
            await window.spikeApi.showLibraryModContextMenu({
                modId,
                x: event.clientX,
                y: event.clientY
            });
        });

        list.addEventListener("dragstart", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row)) {
                return;
            }

            if (row.getAttribute("draggable") !== "true") {
                event.preventDefault();
                return;
            }

            const modId = Number.parseInt(row.getAttribute("data-mod-id") || "0", 10);
            if (!Number.isFinite(modId) || modId <= 0) {
                event.preventDefault();
                return;
            }

            state.library.dragSourceModId = modId;
            row.classList.add("is-dragging");
            list.classList.add("is-drag-active");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(modId));
            }
        });

        list.addEventListener("dragend", () => {
            state.library.dragSourceModId = null;
            clearLibraryDragDecorations(list);
        });

        list.addEventListener("dragover", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row) || row.getAttribute("draggable") !== "true") {
                return;
            }

            event.preventDefault();
            clearLibraryDragDecorations(list);

            const rect = row.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (event.clientY < midpoint) {
                row.classList.add("drag-over-top");
            } else {
                row.classList.add("drag-over-bottom");
            }
        });

        list.addEventListener("dragleave", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row)) {
                return;
            }

            const related = event.relatedTarget;
            if (related instanceof Element && row.contains(related)) {
                return;
            }

            row.classList.remove("drag-over-top", "drag-over-bottom");
        });

        list.addEventListener("drop", async (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const row = target.closest(".library-row");
            if (!row || !list.contains(row)) {
                return;
            }

            event.preventDefault();
            const sourceIdRaw = event.dataTransfer?.getData("text/plain") || "";
            const sourceId = Number.parseInt(sourceIdRaw || String(state.library.dragSourceModId || "0"), 10);
            await handleLibraryDrop(list, row, event.clientY, sourceId);
            state.library.dragSourceModId = null;
        });

        list.addEventListener("wheel", (event) => {
            if (!state.library.dragSourceModId) {
                return;
            }

            event.preventDefault();
            list.scrollTop += event.deltaY;
        }, { passive: false });
    }

    function renderLibraryProfiles() {
        const snapshot = state.library.snapshot;
        const select = byId("libraryProfileSelect");
        const sharedValue = byId("librarySharedProfileValue");
        const sharedOwnership = byId("librarySharedProfileOwnership");
        if (!snapshot || !select) return;

        select.innerHTML = snapshot.profiles
            .map((p) => `<option value="${p.id}" ${p.id === snapshot.activeProfileId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
            .join("");

        const active = getActiveLibraryProfile();
        const currentSharedId = (active?.sharedProfileId || "").trim();
        const sharedProfileCreator = String(active?.sharedProfileCreator || "").trim();
        const canUpdateSharedProfile = active?.sharedProfileCanUpdate === true;
        if (sharedValue) {
            const sharedValueTitle = currentSharedId || "No shared profile ID set";
            sharedValue.textContent = currentSharedId || "No shared profile ID set";
            sharedValue.classList.toggle("is-empty", !currentSharedId);
            sharedValue.title = sharedValueTitle;
            sharedValue.dataset.tooltip = sharedValueTitle;
        }

        if (sharedOwnership) {
            if (!active) {
                sharedOwnership.textContent = "No active profile";
            } else if (!currentSharedId) {
                sharedOwnership.textContent = "Not shared yet";
            } else if (canUpdateSharedProfile) {
                sharedOwnership.textContent = sharedProfileCreator
                    ? `Owned by you as ${sharedProfileCreator}`
                    : "Owned by you";
            } else {
                sharedOwnership.textContent = sharedProfileCreator
                    ? `Owned by ${sharedProfileCreator}`
                    : "Owned by another creator";
            }
        }

        const syncButton = byId("librarySyncSharedProfile");
        if (syncButton) {
            syncButton.disabled = !currentSharedId;
            syncButton.title = currentSharedId
                ? "Sync this profile with the saved shared profile ID"
                : "No shared profile ID set";
        }

        const updateButton = byId("libraryUpdateSharedProfile");
        const updateButtonLabel = byId("libraryUpdateSharedProfileLabel");
        if (updateButton) {
            const updateTitle = !active
                ? "No active profile"
                : currentSharedId && !canUpdateSharedProfile
                    ? "Only the profile creator can update this shared profile."
                    : currentSharedId
                        ? "Send this profile's current enabled mods and load order to Stellarisync"
                        : "Publish this profile to Stellarisync and create a shared profile ID";
            updateButton.disabled = !active || (Boolean(currentSharedId) && !canUpdateSharedProfile);
            updateButton.title = updateTitle;
            updateButton.dataset.tooltip = updateTitle;
        }
        if (updateButtonLabel) {
            updateButtonLabel.textContent = currentSharedId ? "Update" : "Publish";
        }

        const shareButton = byId("libraryShareProfile");
        if (shareButton) {
            shareButton.disabled = !currentSharedId;
            shareButton.title = currentSharedId
                ? "Copy the saved shared profile ID"
                : "No shared profile ID set";
        }

        // Disable delete button when only one profile remains
        const deleteBtn = byId("libraryDeleteProfile");
        if (deleteBtn) deleteBtn.disabled = snapshot.profiles.length <= 1;
    }

    function renderLibrarySummary() {
        const s = state.library.snapshot;
        if (!s) return;
        setText("libraryUpdatesChip", `${s.updatesAvailable} updates`);
        setText("libraryTotalsChip", `${s.totalMods} mods`);
        setText("libraryTotalModsChip", `Total: ${s.totalMods}`);
        setText("libraryEnabledModsChip", `Enabled: ${s.enabledMods}`);
        setText("libraryUpdatesFooter", `Updates: ${s.updatesAvailable}`);
    }

    async function loadCompatibilityTags() {
        const result = await window.spikeApi.getCompatibilityTags();
        if (result.ok) {
            state.library.availableTags = Array.isArray(result.tags) ? result.tags : [];
        } else if (!Array.isArray(state.library.availableTags) || state.library.availableTags.length === 0) {
            state.library.availableTags = Array.isArray(result.tags) ? result.tags : [];
        }

        const validTagKeys = new Set((state.library.availableTags || []).map((tag) => normalizeTagKey(tag.key)));
        state.library.selectedReportTags = normalizeTagList(
            (state.library.selectedReportTags || []).filter((tagKey) => validTagKeys.has(tagKey))
        );

        const nextSavedSelections = {};
        for (const [key, tags] of Object.entries(state.library.savedReportTagsByModVersion || {})) {
            nextSavedSelections[key] = normalizeTagList(tags).filter((tagKey) => validTagKeys.has(tagKey));
        }
        state.library.savedReportTagsByModVersion = nextSavedSelections;

        renderLibraryReportTagList();
        renderSelectedTagsInfo();

        if (!result.ok) {
            setLibraryStatus(result.message);
        }
    }

    async function refreshLibrarySnapshot() {
        try {
            await loadCompatibilityTags();
            const snapshot = await window.spikeApi.getLibrarySnapshot();
            state.library.snapshot = snapshot;
            syncVisibleVersionCardActionStates();
            if (state.library.selectedModId && !snapshot.mods.some((m) => m.id === state.library.selectedModId)) {
                state.library.selectedModId = null;
            }
            renderLibrarySummary();
            renderLibraryProfiles();
            renderLibraryList();
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown library error";
            setLibraryStatus(`Failed to load library: ${msg}`);
        }
    }

    async function reinstallAllLibraryMods() {
        const snapshot = state.library.snapshot;
        if (!snapshot || snapshot.mods.length === 0) { setLibraryStatus("No installed mods to reinstall."); return; }
        let queued = 0;
        for (const mod of snapshot.mods) {
            const result = await queueDownloadAction({ workshopId: mod.workshopId, modName: mod.name, action: "install" });
            if (result.blockedBySettings) {
                setLibraryStatus(result.message);
                return;
            }
            if (result.ok) queued += 1;
        }
        setLibraryStatus(`Queued ${queued} mod(s) for reinstall.`);
        await refreshQueueSnapshot();
    }

    async function runLibraryCompatibilityReport(worked) {
        const mod = getSelectedLibraryMod();
        if (!mod) { setLibraryStatus("Select a mod first."); return; }
        const snapshot = state.library.snapshot;
        const gv = (snapshot?.lastDetectedGameVersion || mod.gameVersion || "").trim();
        if (!gv) { setLibraryStatus("Game version is required to report compatibility."); return; }
        const result = await window.spikeApi.reportLibraryCompatibility({
            workshopId: mod.workshopId,
            gameVersion: gv,
            worked,
            outcome: worked ? "worked" : "not_worked",
            selectedTags: state.library.selectedReportTags || []
        });
        setLibraryStatus(result.message);
        if (result.ok) {
            persistLibraryTagDraftForSelectedMod();
        }
        await refreshLibrarySnapshot();
    }

    async function runLibraryTagOnlySubmission() {
        const mod = getSelectedLibraryMod();
        if (!mod) { setLibraryStatus("Select a mod first."); return; }

        const selectedTags = normalizeTagList(state.library.selectedReportTags || []);

        const snapshot = state.library.snapshot;
        const gv = (snapshot?.lastDetectedGameVersion || mod.gameVersion || "").trim();
        if (!gv) { setLibraryStatus("Game version is required to submit tags."); return; }

        if (selectedTags.length <= 0) {
            const confirmed = await showModal(
                "Clear Submitted Tags",
                "This will remove all tags from your existing vote for this mod/version. Continue?",
                "Remove Tags",
                "Cancel"
            );
            if (!confirmed) {
                return;
            }
        }

        const result = await window.spikeApi.reportLibraryCompatibility({
            workshopId: mod.workshopId,
            gameVersion: gv,
            selectedTags,
            tagsOnly: true
        });

        setLibraryStatus(result.message);
        if (result.ok) {
            state.library.selectedReportTags = selectedTags;
            persistLibraryTagDraftForSelectedMod();
            renderLibraryReportTagList();
            renderSelectedTagsInfo();
        }
        await refreshLibrarySnapshot();
    }

    /* ============================================================
       EVENT HOOKS
       ============================================================ */
    function hookLibraryControls() {
        hookLibraryListDelegation();

        const closeOpenLibraryMenus = (exceptMenu = null) => {
            for (const menuEl of document.querySelectorAll("details.library-menu[open]")) {
                if (!(menuEl instanceof HTMLDetailsElement)) continue;
                if (exceptMenu && menuEl === exceptMenu) continue;
                menuEl.removeAttribute("open");
            }
        };

        for (const menuEl of document.querySelectorAll("details.library-menu")) {
            if (!(menuEl instanceof HTMLDetailsElement)) continue;
            menuEl.addEventListener("toggle", () => {
                if (menuEl.open) {
                    closeOpenLibraryMenus(menuEl);
                }
            });
        }

        document.addEventListener("click", (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest("details.library-menu")) return;
            closeOpenLibraryMenus();
        });

        for (const button of document.querySelectorAll(".library-menu-panel button")) {
            button.addEventListener("click", () => {
                const menu = button.closest("details.library-menu");
                if (menu instanceof HTMLDetailsElement) {
                    menu.removeAttribute("open");
                }
            });
        }

        byId("librarySearchInput")?.addEventListener("input", (e) => {
            state.library.searchText = e.target.value || "";
            renderLibraryList();
        });
        byId("libraryEnabledOnly")?.addEventListener("change", (e) => {
            state.library.showEnabledOnly = e.target.checked === true;
            renderLibraryList();
            void persistHideDisabledMods(state.library.showEnabledOnly);
        });

        byId("libraryDetailTagsToggle")?.addEventListener("click", () => {
            state.library.descriptorTagsExpanded = !state.library.descriptorTagsExpanded;
            renderDescriptorTags(getSelectedLibraryMod());
        });

        byId("libraryProfileSelect")?.addEventListener("change", async (e) => {
            const id = Number.parseInt(e.target.value || "0", 10);
            if (!Number.isFinite(id) || id <= 0) return;
            const activated = await activateLibraryProfileWithPreview(id);
            if (!activated && state.library.snapshot?.activeProfileId) {
                e.target.value = String(state.library.snapshot.activeProfileId);
            }
        });

        byId("libraryNewProfile")?.addEventListener("click", async () => {
            const name = await showPrompt("New Profile", "Enter a name for the new profile:", "New Profile");
            if (!name) return;
            setLibraryStatus(`Creating profile '${name}'...`);
            try {
                const result = await window.spikeApi.createLibraryProfile(name);
                setLibraryStatus(result.message);
                if (result.ok) {
                    await refreshLibrarySnapshot();
                    // Find and activate the new profile so it actually switches in the UI
                    const p = state.library.snapshot.profiles.find(x => x.name.toLowerCase() === name.toLowerCase());
                    if (p) {
                        const activated = await activateLibraryProfileWithPreview(p.id);
                        if (!activated) {
                            return;
                        }
                    }

                    // Fresh profile has no enabled mods; hide disabled ones so the view isn't cluttered.
                    if (!state.library.showEnabledOnly) {
                        state.library.showEnabledOnly = true;
                        syncLibraryEnabledOnlyToggle();
                        renderLibraryList();
                        void persistHideDisabledMods(true);
                    }
                }
            } catch (e) {
                setLibraryStatus(`Error creating profile: ${e.message}`);
            }
        });

        byId("libraryRenameProfile")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }
            const name = await showPrompt("Rename Profile", "Enter new name:", active.name);
            if (!name) return;
            const result = await window.spikeApi.renameLibraryProfile({ profileId: active.id, name });
            setLibraryStatus(result.message);
            await refreshLibrarySnapshot();
        });

        byId("libraryDeleteProfile")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }
            const confirmed = await showModal("Delete Profile", `Delete profile '${active.name}'?`, "Delete", "Cancel");
            if (!confirmed) return;
            const result = await window.spikeApi.deleteLibraryProfile(active.id);
            setLibraryStatus(result.message);
            await refreshLibrarySnapshot();
        });

        async function runSharedProfileSync(active, sharedProfileId, sharedProfileSince = "") {
            const request = {
                profileId: active.id,
                sharedProfileId,
                sharedProfileSince
            };
            const preview = await window.spikeApi.previewLibrarySharedProfileSync(request);
            if (!preview.ok) {
                setLibraryStatus(preview.message);
                return;
            }

            const hasChanges = (preview.changes || []).length > 0
                || (preview.enableModNames || []).length > 0
                || (preview.disableModNames || []).length > 0
                || (preview.missingWorkshopIds || []).length > 0;
            if (!hasChanges) {
                setLibraryStatus(preview.message);
                return;
            }

            if (!await showSharedProfileSyncPreview(preview)) {
                setLibraryStatus("Shared profile sync cancelled.");
                return;
            }

            const syncResult = await window.spikeApi.syncLibrarySharedProfile(request);
            setLibraryStatus(syncResult.message);
            await refreshLibrarySnapshot();

            const missingWorkshopIds = Array.isArray(syncResult?.missingWorkshopIds)
                ? syncResult.missingWorkshopIds
                : [];
            if (!syncResult.ok || missingWorkshopIds.length <= 0) {
                return;
            }

            const profileLabel = syncResult.profileName
                ? `shared profile '${syncResult.profileName}'`
                : "the shared profile";
            const shouldInstall = await showModal(
                "Install Missing Mods",
                `${missingWorkshopIds.length} mod(s) from ${profileLabel} are missing locally. Queue them for install now?`,
                "Queue installs",
                "Not now"
            );
            if (!shouldInstall) {
                setLibraryStatus(`${missingWorkshopIds.length} missing mod(s) not queued.`);
                return;
            }

            let queuedCount = 0;
            let skippedCount = 0;
            for (const workshopId of missingWorkshopIds) {
                const queueResult = await queueDownloadAction({
                    workshopId,
                    modName: workshopId,
                    action: "install"
                });
                if (queueResult.blockedBySettings) {
                    setLibraryStatus(queueResult.message);
                    return;
                }
                if (queueResult.ok) {
                    queuedCount += 1;
                } else {
                    skippedCount += 1;
                }
            }

            if (queuedCount > 0) {
                await refreshQueueSnapshot();
            }

            if (queuedCount > 0 && skippedCount > 0) {
                setLibraryStatus(`Queued ${queuedCount} missing mod(s); skipped ${skippedCount}.`);
                return;
            }

            if (queuedCount > 0) {
                setLibraryStatus(`Queued ${queuedCount} missing mod(s) for installation.`);
                return;
            }

            setLibraryStatus("Missing mods were not queued (they may already be queued or invalid).");
        }

        byId("libraryUpdateSharedProfile")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }

            if (!await ensurePublicUsernameConfigured(true)) {
                setLibraryStatus("Public username is required for profile sharing.");
                return;
            }

            const publishResult = await window.spikeApi.publishLibrarySharedProfile({ profileId: active.id });
            if (!publishResult.ok || !publishResult.sharedProfileId) {
                setLibraryStatus(publishResult.message);
                return;
            }

            const statusSuffix = publishResult.created
                ? ` Shared ID: ${publishResult.sharedProfileId}`
                : "";
            setLibraryStatus(`${publishResult.message}${statusSuffix}`);
            await refreshLibrarySnapshot();
        });

        byId("libraryUseSharedId")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }
            try {
                const sharedId = await showPrompt(
                    "Use Shared Profile ID",
                    "Paste the shared profile ID (or ID,since) to use for this profile:",
                    active.sharedProfileId || ""
                );
                if (sharedId === null) return;
                const parsedShared = parseSharedProfileSyncInput(sharedId);
                if (!parsedShared.sharedProfileId) {
                    setLibraryStatus("Shared profile ID is required.");
                    return;
                }
                await runSharedProfileSync(active, parsedShared.sharedProfileId, parsedShared.sharedProfileSince);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setLibraryStatus(`Failed to sync shared profile: ${message}`);
            }
        });

        byId("librarySyncSharedProfile")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }

            const sharedProfileId = String(active.sharedProfileId || "").trim();
            if (!sharedProfileId) {
                setLibraryStatus("No shared profile ID set.");
                return;
            }

            try {
                await runSharedProfileSync(active, sharedProfileId, "");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setLibraryStatus(`Failed to sync shared profile: ${message}`);
            }
        });

        byId("libraryShareProfile")?.addEventListener("click", async () => {
            const active = getActiveLibraryProfile();
            if (!active) { setLibraryStatus("No active profile."); return; }

            const sharedProfileId = String(active.sharedProfileId || "").trim();
            if (!sharedProfileId) {
                setLibraryStatus("No shared profile ID set. Update this profile to Stellarisync first.");
                return;
            }

            const copied = await window.spikeApi.copyText(sharedProfileId);
            setLibraryStatus(
                copied
                    ? `Shared profile ID copied: ${sharedProfileId}`
                    : `Shared profile ID: ${sharedProfileId}`
            );
        });

        byId("libraryCheckUpdates")?.addEventListener("click", async () => {
            const result = await window.spikeApi.checkLibraryUpdates();
            setLibraryStatus(result.message);
            await refreshLibrarySnapshot();
        });

        byId("libraryReinstallAll")?.addEventListener("click", () => void reinstallAllLibraryMods());
        byId("libraryExport")?.addEventListener("click", async () => {
            const result = await window.spikeApi.exportLibraryMods();
            setLibraryStatus(result.message);
        });
        byId("libraryImport")?.addEventListener("click", async () => {
            const result = await window.spikeApi.importLibraryMods();
            setLibraryStatus(result.message);
            if (result.ok && result.queuedCount > 0) {
                await refreshQueueSnapshot();
                await activateTabGuarded("downloads");
                setGlobalStatus(`${result.message} Check Downloads for live progress.`);
            }
        });
        byId("libraryScanLocal")?.addEventListener("click", async () => {
            setLibraryStatus("Scanning local mods...");
            const previousLibrarySnapshot = state.library.snapshot;
            const result = await window.spikeApi.scanLocalMods();
            setLibraryStatus(result.message);
            if (result.added > 0) {
                await refreshLibrarySnapshot();
                await revealNewlyAddedDisabledMods(previousLibrarySnapshot);
            }
        });

        async function runSharedLoadOrderSuggestion() {
            setLibraryStatus("Fetching Stellarisync load-order suggestions...");
            const preview = await window.spikeApi.getLibraryLoadOrderSuggestion();
            if (!preview.ok || !Array.isArray(preview.changes) || preview.changes.length === 0) {
                setLibraryStatus(preview.message);
                return;
            }

            if (!await showLoadOrderPreviewModal("Apply Stellarisync Suggested Order", preview, "Apply suggestion")) {
                setLibraryStatus("Suggested load order cancelled.");
                return;
            }

            const result = await window.spikeApi.applyLibraryLoadOrderSuggestion({
                orderedWorkshopIds: preview.orderedWorkshopIds || []
            });
            setLibraryStatus(result.message);
            if (result.ok) {
                await refreshLibrarySnapshot();
            }
        }

        byId("librarySuggestLoadOrder")?.addEventListener("click", () => void runSharedLoadOrderSuggestion());

        byId("librarySubmitTagsOnly")?.addEventListener("click", () => void runLibraryTagOnlySubmission());

        byId("libraryClearTags")?.addEventListener("click", () => {
            state.library.selectedReportTags = [];
            renderLibraryReportTagList();
            renderSelectedTagsInfo();
            setLibraryStatus("Tag selection cleared.");
        });

        byId("libraryResetTags")?.addEventListener("click", () => {
            restoreLibraryTagDraftForSelectedMod();
            renderLibraryReportTagList();
            renderSelectedTagsInfo();
            setLibraryStatus("Tags restored to last saved.");
        });

        // Detail actions
        byId("libraryActionReinstall")?.addEventListener("click", async () => {
            const mod = getSelectedLibraryMod();
            if (mod) await queueAction(mod.workshopId, "install", "library");
        });
        byId("libraryActionWorks")?.addEventListener("click", () => void runLibraryCompatibilityReport(true));
        byId("libraryActionBroken")?.addEventListener("click", () => void runLibraryCompatibilityReport(false));
        window.spikeApi.onLibraryModContextMenuCommand((event) => {
            void runLibraryModContextMenuCommand(event.command, event.modId);
        });
    }

    return {
        hookLibraryControls,
        refreshLibrarySnapshot,
        revealNewlyAddedDisabledMods
    };
}
