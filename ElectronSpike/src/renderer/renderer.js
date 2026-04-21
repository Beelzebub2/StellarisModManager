/* ============================================================
   Stellaris Mod Manager – Renderer
   ============================================================ */

const state = {
    selectedVersion: "4.3",
    sortMode: "relevance",
    showOlderVersions: false,
    searchText: "",
    page: 1,
    pageSize: 30,
    totalPages: 1,
    isLoading: false,
    selectedTab: "version",
    settingsTab: "general",
    downloadEventUnsubscribe: null,
    searchDebounceHandle: null,
    versionRequestSeq: 0,
    activeDetailWorkshopId: null,
    activeCards: [],
    settingsModel: null,
    settingsDirty: false,
    usernamePromptShown: false,
    gameRunning: false,
    gamePollingHandle: null,
    stellarisyncPollingHandle: null,
    workshopMouseNavHooked: false,
    workshopReturnContext: null,
    tabHistory: [],
    tabForwardStack: [],
    queueHadActiveWork: false,
    queueRowsByWorkshopId: new Map(),
    queueSnapshot: null,
    queueLibrarySyncKey: "",
    queueLibrarySyncInFlight: false,
    library: {
        snapshot: null,
        searchText: "",
        showEnabledOnly: false,
        selectedModId: null,
        removingModIds: new Set(),
        dragSourceModId: null,
        descriptorTagsExpanded: false,
        availableTags: [],
        selectedReportTags: [],
        savedReportTagsByModVersion: {}
    }
};

const libraryVisibility = globalThis.libraryVisibility || {};
const promptInputBehavior = globalThis.promptInputBehavior || {};

const THEME_PALETTE_TO_KEY = Object.freeze({
    "Obsidian Ember": "obsidian-ember",
    "Graphite Moss": "graphite-moss",
    "Nocturne Slate": "nocturne-slate",
    "Starlight White": "starlight-white",
    "Ivory White": "ivory-white",
    "Frost White": "frost-white"
});

const LIGHT_THEME_PALETTES = new Set([
    "Starlight White",
    "Ivory White",
    "Frost White"
]);

const ICON_PATHS = Object.freeze({
    versions: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-6.9 6.9a2.12 2.12 0 0 1-3-3l6.9-6.9a6 6 0 0 1 9.36-7.94l-3.79 3.79z"/>',
    launch: '<polygon points="5 3 19 12 5 21 5 3"/>',
    restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    queue: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    reinstall: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    scan: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    thumbsUp: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
    thumbsDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    forward: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    refresh: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    chevronUp: '<polyline points="18 15 12 9 6 15"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>'
});

function iconSvg(name) {
    const paths = ICON_PATHS[name] || ICON_PATHS.settings;
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths}</svg>`;
}

function applyDataIcons(root = document) {
    for (const el of root.querySelectorAll("[data-icon]")) {
        const iconName = (el.getAttribute("data-icon") || "").trim();
        if (!iconName) continue;
        el.innerHTML = iconSvg(iconName);
    }
}

function setDataIcon(el, iconName) {
    if (!(el instanceof HTMLElement)) return;
    el.setAttribute("data-icon", iconName);
    el.innerHTML = iconSvg(iconName);
}

/* ---- Helpers ---- */
function byId(id) { return document.getElementById(id); }

function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
}

function printJson(id, value) {
    const el = byId(id);
    if (el) el.textContent = JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toDisplayValue(value, fallback = "Not set") {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") { const t = value.trim(); return t || fallback; }
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
    return fallback;
}

function formatUtc(value) {
    if (!value || typeof value !== "string") return "Never";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function formatInteger(value) { return Number(value || 0).toLocaleString(); }

function applyViewportMetrics() {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty("--app-vw", `${window.innerWidth}px`);
    root.style.setProperty("--app-vh", `${window.innerHeight}px`);
}

function hookWindowResizeResponsiveness() {
    let resizeResetTimer = null;

    const onResize = () => {
        applyViewportMetrics();
        document.body.classList.add("window-resizing");
        if (resizeResetTimer) {
            clearTimeout(resizeResetTimer);
        }
        resizeResetTimer = setTimeout(() => {
            document.body.classList.remove("window-resizing");
            resizeResetTimer = null;
        }, 140);
    };

    applyViewportMetrics();
    window.addEventListener("resize", onResize, { passive: true });
}

function normalizeWorkshopId(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (/^\d{6,}$/.test(raw)) return raw;

    const idParamMatch = raw.match(/[?&]id=(\d{6,})\b/i);
    if (idParamMatch) return idParamMatch[1];

    const fileDetailsMatch = raw.match(/sharedfiles\/filedetails\/?[^\s]*id=(\d{6,})\b/i);
    if (fileDetailsMatch) return fileDetailsMatch[1];

    const fallbackDigitsMatch = raw.match(/\b(\d{6,})\b/);
    return fallbackDigitsMatch ? fallbackDigitsMatch[1] : "";
}

function isValidWorkshopId(value) {
    return /^\d{6,}$/.test(value);
}

function parseSharedProfileSyncInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return { sharedProfileId: "", sharedProfileSince: "" };
    }

    const paramsSource = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
    const params = new URLSearchParams(paramsSource);
    const paramId = (params.get("id") || params.get("profileId") || "").trim();
    const paramSince = (params.get("since") || "").trim();

    if (paramId) {
        return {
            sharedProfileId: paramId,
            sharedProfileSince: paramSince
        };
    }

    const commaSeparated = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (commaSeparated.length >= 2) {
        return {
            sharedProfileId: commaSeparated[0],
            sharedProfileSince: commaSeparated.slice(1).join(",")
        };
    }

    return { sharedProfileId: raw, sharedProfileSince: "" };
}

function formatVersionBadgeValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    return /^v/i.test(raw) ? raw : `v${raw}`;
}

function normalizeThemePaletteName(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "graphite moss") return "Graphite Moss";
    if (raw === "nocturne slate") return "Nocturne Slate";
    if (raw === "starlight white") return "Starlight White";
    if (raw === "ivory white") return "Ivory White";
    if (raw === "frost white") return "Frost White";
    return "Obsidian Ember";
}

function buildThemePaletteOptionsMarkup(palettes) {
    const dark = [];
    const light = [];

    for (const palette of palettes || []) {
        const normalized = normalizeThemePaletteName(palette);
        if (LIGHT_THEME_PALETTES.has(normalized)) {
            light.push(normalized);
        } else {
            dark.push(normalized);
        }
    }

    const uniqueDark = [...new Set(dark)];
    const uniqueLight = [...new Set(light)];

    const renderOptions = (items) => items
        .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
        .join("");

    const chunks = [];
    if (uniqueDark.length > 0) {
        chunks.push(`<optgroup label="Dark Themes">${renderOptions(uniqueDark)}</optgroup>`);
    }
    if (uniqueLight.length > 0) {
        chunks.push(`<optgroup label="Light Themes">${renderOptions(uniqueLight)}</optgroup>`);
    }

    return chunks.join("");
}

function applyThemePalette(paletteName) {
    const normalized = normalizeThemePaletteName(paletteName);
    const themeKey = THEME_PALETTE_TO_KEY[normalized] || THEME_PALETTE_TO_KEY["Obsidian Ember"];
    document.body.setAttribute("data-theme", themeKey);
}

/* ---- Status management ---- */
function setGlobalStatus(text) { setText("statusbarText", text); }

function setVersionStatus(text) {
    setText("versionStatus", text);
    if (state.selectedTab === "version") setGlobalStatus(text);
}

function setSettingsStatus(text) {
    setText("settingsStatus", text);
    if (state.selectedTab === "settings") setGlobalStatus(text);
}

function setLibraryStatus(text) {
    setText("libraryStatus", text);
    if (state.selectedTab === "library") setGlobalStatus(text);
}

function setResultSummary(total, page, pages) {
    setText("resultCountChip", `${total} matches`);
    setText("pageCursorChip", `Page ${page}/${pages}`);
}

async function applyAppIcon() {
    try {
        const iconDataUrl = await window.spikeApi.getAppIconDataUrl();
        if (!iconDataUrl) {
            return;
        }

        const targets = [
            ["appBadgeIcon", "appBadgeFallback"],
            ["sidebarHeroIcon", "sidebarHeroFallback"]
        ];

        for (const [iconId, fallbackId] of targets) {
            const iconEl = byId(iconId);
            const fallbackEl = byId(fallbackId);

            if (iconEl instanceof HTMLImageElement) {
                iconEl.src = iconDataUrl;
                iconEl.classList.remove("hidden");
            }

            if (fallbackEl) {
                fallbackEl.classList.add("hidden");
            }
        }
    } catch {
        // keep fallback initials if icon loading fails
    }
}

/* ---- Loading state ---- */
function setLoadingState(isLoading) {
    state.isLoading = isLoading;
    const btn = byId("versionRefresh");
    if (btn) {
        btn.disabled = isLoading;
        btn.classList.toggle("is-spinning", isLoading);
    }
    const prev = byId("pagePrev");
    if (prev) prev.disabled = isLoading || state.page <= 1;
    const next = byId("pageNext");
    if (next) next.disabled = isLoading || state.page >= state.totalPages;
    const clear = byId("searchClear");
    if (clear) clear.disabled = isLoading || !state.searchText;
}

function syncSearchClearButton() {
    const btn = byId("searchClear");
    if (btn) btn.disabled = !state.searchText;
}

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
function showModal(title, message, confirmLabel = "Confirm", cancelLabel = "Cancel") {
    return new Promise((resolve) => {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const backdrop = byId("modalBackdrop");

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = confirmLabel;
        if (cancelBtn) cancelBtn.textContent = cancelLabel;

        if (overlay) overlay.classList.remove("hidden");

        function cleanup(result) {
            if (overlay) overlay.classList.add("hidden");
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (backdrop) backdrop.onclick = null;
            resolve(result);
        }

        if (confirmBtn) confirmBtn.onclick = () => cleanup(true);
        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        if (backdrop) backdrop.onclick = () => cleanup(false);
    });
}

function showPrompt(title, message, defaultValue = "") {
    return new Promise((resolve) => {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const backdrop = byId("modalBackdrop");

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = "OK";
        if (cancelBtn) cancelBtn.textContent = "Cancel";

        if (extra) {
            extra.innerHTML = `<input id="modalInput" class="field-input" type="text" value="${escapeHtml(defaultValue)}" style="margin-top:8px" />`;
        }

        if (overlay) overlay.classList.remove("hidden");

        const inputEl = byId("modalInput");
        const readInputValue = () => {
            const input = byId("modalInput");
            return input ? input.value.trim() : null;
        };

        const handleInputKeydown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                cleanup(readInputValue());
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                cleanup(null);
            }
        };

        if (inputEl) {
            inputEl.addEventListener("keydown", handleInputKeydown);
        }

        setTimeout(() => {
            const input = byId("modalInput");
            if (input && typeof promptInputBehavior.focusAndSelectPromptInput === "function") {
                promptInputBehavior.focusAndSelectPromptInput(input);
                return;
            }

            if (input) input.focus();
        }, 50);

        const handleKeyDown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const input = byId("modalInput");
                cleanup(input ? input.value.trim() : null);
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                cleanup(null);
            }
        };

        function cleanup(result) {
            if (overlay) overlay.classList.add("hidden");
            if (extra) extra.innerHTML = "";
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (backdrop) backdrop.onclick = null;
            document.removeEventListener("keydown", handleKeyDown, true);
            resolve(result);
        }

        if (confirmBtn) confirmBtn.onclick = () => {
            cleanup(readInputValue());
        };
        if (cancelBtn) cancelBtn.onclick = () => cleanup(null);
        if (backdrop) backdrop.onclick = () => cleanup(null);
        document.addEventListener("keydown", handleKeyDown, true);
    });
}

/* ============================================================
   STELLARISYNC STATUS
   ============================================================ */
async function refreshStellarisyncStatus() {
    try {
        const status = await window.spikeApi.getStellarisyncStatus();
        const chip = byId("stellarisyncChip");
        const text = byId("stellarisyncText");

        if (chip && text) {
            if (status.online) {
                chip.className = "status-chip status-chip-online";
                text.textContent = "Stellarisync Online";
            } else {
                chip.className = "status-chip status-chip-offline";
                text.textContent = "Stellarisync Offline";
            }
        }
    } catch {
        // ignore
    }
}

/* ============================================================
   GAME LAUNCH
   ============================================================ */
async function refreshGameRunningStatus() {
    try {
        state.gameRunning = await window.spikeApi.getGameRunningStatus();
        const btn = byId("launchGameBtn");
        const text = byId("launchGameText");
        if (btn && text) {
            const iconHolder = btn.querySelector(".nav-icon[data-icon]");
            if (state.gameRunning) {
                text.textContent = "Restart Game";
                setDataIcon(iconHolder, "restart");
            } else {
                text.textContent = "Launch Game";
                setDataIcon(iconHolder, "launch");
            }
        }
    } catch {
        // ignore
    }
}

async function handleLaunchGame() {
    if (state.gameRunning) {
        const confirmed = await showModal(
            "Stellaris is running",
            "Restarting will close the running game. Did you save your current game?",
            "Restart Game",
            "Cancel"
        );
        if (!confirmed) return;
    }

    const result = await window.spikeApi.launchGame();
    setGlobalStatus(result.message);
    setTimeout(() => void refreshGameRunningStatus(), 2000);
}

/* ============================================================
   VERSION BROWSER
   ============================================================ */
function actionLabel(actionState) {
    switch (actionState) {
        case "queued": return "Queued";
        case "installing": return "Installing...";
        case "installed": return "Installed";
        case "uninstalling": return "Removing...";
        case "error": return "Retry";
        default: return "Install";
    }
}

function actionIntent(actionState) {
    return actionState === "installed" ? "uninstall" : "install";
}

function actionButtonClass(actionState) {
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

function actionIsDisabled(actionState) {
    return actionState === "queued" || actionState === "installing" || actionState === "uninstalling";
}

function normalizeDetectedGameVersion(rawVersion) {
    const value = String(rawVersion || "").trim();
    if (!value) return null;

    const match = value.match(/(\d+)\.(\d+)(?:\.\d+)?/);
    if (!match) return null;

    return `${match[1]}.${match[2]}`;
}

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

function applyInstalledHoverLabel(button, actionState) {
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
        setVersionStatus(`Version browser failed: ${msg}`);
    } finally {
        if (requestSeq === state.versionRequestSeq) {
            setLoadingState(false);
        }
    }
}

/* ============================================================
   QUEUE
   ============================================================ */
function getModNameByWorkshopId(workshopId) {
    const fromLib = (state.library.snapshot?.mods ?? []).find((m) => m.workshopId === workshopId);
    if (fromLib) return fromLib.name;
    const fromCards = state.activeCards.find((c) => c.workshopId === workshopId);
    if (fromCards) return fromCards.name;
    return workshopId;
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

function queueStatusLabel(status) {
    switch ((status || "").toLowerCase()) {
        case "queued":
            return "Queued";
        case "running":
            return "Running";
        case "completed":
            return "Done";
        case "failed":
            return "Failed";
        case "cancelled":
            return "Cancelled";
        default:
            return "Unknown";
    }
}

function queueActionLabel(action) {
    return action === "uninstall" ? "Uninstall" : "Install";
}

function isDeveloperModeEnabled() {
    return state.settingsModel?.developerMode === true || getCheckboxValue("settingsDeveloperModeInput") === true;
}

function parseByteProgress(rawMessage) {
    const match = String(rawMessage || "").match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*(MB|GB|KB)/i);
    if (!match) return null;
    return `${match[1]} / ${match[2]} ${match[3].toUpperCase()}`;
}

function buildQueueMessageForDisplay(item, developerModeEnabled) {
    const status = String(item.status || "").toLowerCase();
    const action = item.action === "uninstall" ? "uninstall" : "install";
    const rawMessage = String(item.message || "").trim();

    if (developerModeEnabled) {
        return rawMessage || (status === "running" || status === "queued" ? "Working..." : "No detail message available.");
    }

    if (status === "queued") {
        if (/retrying .*individually|individual steamcmd retry/i.test(rawMessage)) {
            return "Retrying this mod in its own SteamCMD run...";
        }
        if (/waiting for batch start/i.test(rawMessage)) {
            return "Waiting for the current SteamCMD batch to begin...";
        }
        return action === "uninstall" ? "Queued for uninstall." : "Waiting for a download slot...";
    }

    if (status === "running") {
        if (/steamworks unavailable|steam not running/i.test(rawMessage) || /steamcmd|SteamCMD/i.test(rawMessage)) {
            if (/preparing|preparing batch/i.test(rawMessage)) return "Starting download via SteamCMD...";
            if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
            if (/deploying|installed to mods path/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
            if (/batch/i.test(rawMessage)) return "Downloading via SteamCMD batch...";
            return "Downloading via SteamCMD...";
        }
        if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
        if (/deploying|installed to mods path/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
        if (/already in steam workshop cache|already downloaded/i.test(rawMessage)) return "Deploying cached mod files...";
        return action === "uninstall" ? "Removing installed files..." : "Downloading via Steam...";
    }

    if (status === "completed") {
        return action === "uninstall" ? "Uninstall completed." : "Installed successfully.";
    }

    if (status === "cancelled") {
        return "Operation cancelled.";
    }

    if (status === "failed") {
        if (/steamworks unavailable|steam not running/i.test(rawMessage)) {
            return "Steam is not running. Start Steam and retry, or switch to SteamCMD in Settings.";
        }
        if (/download item\s+\d+\s+failed|failed\s*\(failure\)|steamcmd reported download failure/i.test(rawMessage)) {
            return "Download failed. Retry later or check SteamCMD in Settings.";
        }
        if (/steamcmd path is not configured|executable is missing|configured steamcmd executable/i.test(rawMessage)) {
            return "SteamCMD not configured — update it in Settings or switch runtime to Steamworks.";
        }
        if (/timed out/i.test(rawMessage)) {
            return "Download timed out. Retry or check your connection.";
        }
        if (/stalled/i.test(rawMessage)) {
            return "SteamCMD stalled. The queue will retry this mod individually when possible.";
        }
        if (/retrying .*individually|individual steamcmd retry/i.test(rawMessage)) {
            return "Batch recovery queued an individual SteamCMD retry for this mod.";
        }
        if (/steam could not start download|check you are logged in/i.test(rawMessage)) {
            return "Steam could not start download. Make sure you are logged in to Steam.";
        }
        return "Operation failed. Enable Developer mode for details.";
    }

    return rawMessage || "Queue activity updated.";
}

function buildQueueDetailMessage(rawMessage) {
    const raw = String(rawMessage || "").trim();
    if (!raw) {
        return "No queue activity.";
    }

    if (isDeveloperModeEnabled()) {
        return raw;
    }

    if (/download item\s+\d+\s+failed|failed\s*\(failure\)|steamcmd reported download failure/i.test(raw)) {
        return "Steam download failed. Retry later or verify SteamCMD in Settings.";
    }

    if (/installed to mods path/i.test(raw)) {
        return "Install completed.";
    }

    if (/uninstall completed/i.test(raw)) {
        return "Uninstall completed.";
    }

    if (/queued/i.test(raw)) {
        return "Queued for processing.";
    }

    if (/retrying .*individually|individual steamcmd retry/i.test(raw)) {
        return "Retrying this mod individually.";
    }

    if (/cancel/i.test(raw)) {
        return "Queue operation cancelled.";
    }

    if (/stalled/i.test(raw)) {
        return "SteamCMD stalled before completion.";
    }

    if (/launching steamcmd|downloading|deploying/i.test(raw)) {
        return "Install in progress...";
    }

    return "Queue activity updated.";
}

function queueClampProgress(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
}

function formatQueueUpdatedAt(value) {
    const raw = String(value || "").trim();
    if (!raw) return "never";

    const timestamp = new Date(raw).getTime();
    if (!Number.isFinite(timestamp)) return raw;

    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 5000) return "just now";

    const seconds = Math.floor(deltaMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function partitionQueueItems(items) {
    const active = [];
    const history = [];

    for (const item of items || []) {
        const status = String(item?.status || "").toLowerCase();
        if (status === "queued" || status === "running") active.push(item);
        else history.push(item);
    }

    return { active, history };
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
                opacity: 0.86
            },
            {
                transform: "translate(0, 0)",
                opacity: 1
            }
        ], {
            duration: 420,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)"
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

    // Row 1: name + status badge
    const top = document.createElement("div");
    top.className = "queue-item-top";

    const idEl = document.createElement("span");
    idEl.className = "queue-id";

    const stageEl = document.createElement("span");
    stageEl.className = "queue-stage";

    top.append(idEl, stageEl);

    // Row 2: progress bar (full width, prominent)
    const progress = document.createElement("div");
    progress.className = "queue-progress";
    const progressBar = document.createElement("span");
    progress.append(progressBar);

    // Row 3: action label | bytes transferred | percentage
    const meta = document.createElement("div");
    meta.className = "queue-item-meta";

    const actionEl = document.createElement("span");
    actionEl.className = "queue-item-action";

    const bytesEl = document.createElement("span");
    bytesEl.className = "queue-item-bytes mono";

    const percentEl = document.createElement("span");
    percentEl.className = "queue-item-percent mono";

    meta.append(actionEl, bytesEl, percentEl);

    // Row 4: status message
    const messageEl = document.createElement("p");
    messageEl.className = "queue-item-message muted";

    // Row 5: workshop ID (dev) + action buttons
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
        lastMessage: "",
        layoutAnimation: null
    };
}

function updateQueueRow(view, item) {
    const status = String(item.status || "queued").toLowerCase();
    const progress = queueClampProgress(item.progress);
    const isActive = status === "queued" || status === "running";
    const canRetry = status === "failed" || status === "cancelled";
    const developerModeEnabled = isDeveloperModeEnabled();
    const previousStatus = view.lastStatus;
    const previousProgress = view.lastProgress;
    const previousMessage = view.lastMessage;
    const nextMessage = buildQueueMessageForDisplay(item, developerModeEnabled);

    view.root.setAttribute("data-status", status);

    const name = item.modName || getModNameByWorkshopId(item.workshopId);
    view.idEl.textContent = name;
    view.idEl.title = `${name} (${item.workshopId})`;

    view.stageEl.textContent = queueStatusLabel(status);
    view.stageEl.setAttribute("data-status", status);

    view.actionEl.textContent = queueActionLabel(item.action);
    view.percentEl.textContent = `${Math.round(progress)}%`;

    // Show byte progress extracted from the raw message (e.g. "45.2 / 128.5 MB")
    const byteProgress = status === "running" ? parseByteProgress(item.message) : null;
    if (view.bytesEl) {
        view.bytesEl.textContent = byteProgress ?? "";
        view.bytesEl.hidden = !byteProgress;
    }

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
        && (previousProgress !== progress || previousMessage !== nextMessage)
    ) {
        triggerTransientClass(view.root, "is-progressing", 420);
        triggerTransientClass(view.progressBar, "is-live", 420);
    } else if (status === "queued" && previousStatus === status && previousMessage !== nextMessage) {
        triggerTransientClass(view.stageEl, "is-soft-pulse", 360);
    }

    view.lastStatus = status;
    view.lastProgress = progress;
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

    for (const item of sectionItems) {
        desiredIds.add(item.workshopId);

        let view = state.queueRowsByWorkshopId.get(item.workshopId);
        if (!view) {
            view = createQueueRow(item.workshopId);
            state.queueRowsByWorkshopId.set(item.workshopId, view);
        }

        const previousParent = view.root.parentElement;
        updateQueueRow(view, item);
        container.appendChild(view.root);

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
            summary.textContent = parts.join(" • ") + (finished > 0 ? ` • ${finished} recent` : "");
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

    const overallSource = activeItems.length > 0 ? activeItems : items;
    const overallPct = overallSource.length === 0
        ? 0
        : Math.round(overallSource.reduce((sum, item) => sum + queueClampProgress(item.progress), 0) / overallSource.length);

    if (queueOverallBar) {
        queueOverallBar.style.width = `${overallPct}%`;
    }

    if (queueOverallLabel) {
        if (totalTracked === 0) queueOverallLabel.textContent = "No queue activity.";
        else if (active > 0) queueOverallLabel.textContent = `${overallPct}% average progress across active operations.`;
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

/* ============================================================
   DETAIL DRAWER
   ============================================================ */
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
        : `Unverified (0 reports)`);

    setText("detailSubscribers", `${detail.totalSubscribers.toLocaleString()} subscribers`);
    const detailFileSize = byId("detailFileSize");
    if (detailFileSize) {
        const hasFileSize = typeof detail.fileSizeLabel === "string" && detail.fileSizeLabel.length > 0;
        detailFileSize.textContent = hasFileSize ? `${detail.fileSizeLabel} download` : "";
        detailFileSize.classList.toggle("hidden", !hasFileSize);
    }
    setText("detailDescription", detail.descriptionText || "No description available.");
    setText("detailQueueMessage", buildQueueDetailMessage(detail.queueMessage));

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

/* ============================================================
   SETTINGS
   ============================================================ */
function getDefaultSettingsModel() {
    return {
        gamePath: "", modsPath: "", steamCmdPath: "", steamCmdDownloadPath: "",
        workshopDownloadRuntime: "Auto", lastDetectedGameVersion: "",
        autoDetectGame: true, developerMode: false, warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember", autoCheckAppUpdates: true,
        compatibilityReporterId: "", lastAppUpdateCheckUtc: "",
        lastOfferedAppVersion: "", skippedAppVersion: "", publicProfileUsername: "",
        hideDisabledMods: false
    };
}

async function resolveUnsavedSettingsBeforeLeave() {
    if (!(state.selectedTab === "settings" && state.settingsDirty)) {
        return true;
    }

    const shouldSave = await showModal(
        "Unsaved settings changes",
        "You made changes in Settings that are not saved. Save changes before leaving?",
        "Save changes",
        "Leave anyway"
    );

    if (shouldSave) {
        const saved = await saveSettingsPage();
        if (!saved) {
            setSettingsStatus("Could not save settings. Fix the issue before leaving this page.");
            return false;
        }
        return true;
    }

    applySettingsToForm(state.settingsModel || getDefaultSettingsModel());
    setSettingsStatus("Discarded unsaved settings changes.");
    return true;
}

function setInputValue(id, v) { const el = byId(id); if (el && "value" in el) el.value = v ?? ""; }
function setCheckboxValue(id, v) { const el = byId(id); if (el && "checked" in el) el.checked = v === true; }
function getInputValue(id) { const el = byId(id); return (!el || !("value" in el)) ? "" : String(el.value || "").trim(); }
function getCheckboxValue(id) { const el = byId(id); return (!el || !("checked" in el)) ? false : el.checked === true; }

function markSettingsDirty(isDirty) {
    state.settingsDirty = isDirty;
    const chip = byId("settingsUnsavedChip");
    if (chip) chip.classList.toggle("hidden", !isDirty);
}

function buildSettingsFromForm() {
    return {
        gamePath: getInputValue("settingsGamePathInput"),
        modsPath: getInputValue("settingsModsPathInput"),
        steamCmdPath: getInputValue("settingsSteamCmdPathInput"),
        steamCmdDownloadPath: getInputValue("settingsSteamCmdDownloadPathInput"),
        workshopDownloadRuntime: getInputValue("settingsWorkshopRuntimeInput") || "Auto",
        lastDetectedGameVersion: state.settingsModel?.lastDetectedGameVersion || "",
        // Keep persisted value because the startup auto-detect toggle is intentionally hidden from UI.
        autoDetectGame: state.settingsModel?.autoDetectGame === true,
        developerMode: getCheckboxValue("settingsDeveloperModeInput"),
        warnBeforeRestartGame: getCheckboxValue("settingsWarnBeforeRestartInput"),
        themePalette: getInputValue("settingsThemeInput") || "Obsidian Ember",
        autoCheckAppUpdates: getCheckboxValue("settingsAutoUpdatesInput"),
        // Kept internal; this field is no longer editable in Settings UI.
        compatibilityReporterId: state.settingsModel?.compatibilityReporterId || "",
        lastAppUpdateCheckUtc: state.settingsModel?.lastAppUpdateCheckUtc || "",
        lastOfferedAppVersion: state.settingsModel?.lastOfferedAppVersion || "",
        skippedAppVersion: state.settingsModel?.skippedAppVersion || "",
        publicProfileUsername: getInputValue("settingsPublicProfileInput"),
        hideDisabledMods: state.library.showEnabledOnly === true
    };
}

function updateSettingsGameVersionChip(version) {
    const chip = byId("settingsGameVersionChip");
    if (!chip) return;

    const normalizedVersion = String(version || "").trim();
    chip.className = "status-chip " + (normalizedVersion ? "status-chip-success" : "status-chip-muted");
    chip.textContent = normalizedVersion ? `Version ${normalizedVersion}` : "Version not detected";
}

function getWorkshopRuntimeHint(runtime, steamCmdPath, steamCmdDownloadPath) {
    const normalizedRuntime = String(runtime || "Auto").trim();
    const hasSteamCmdPath = String(steamCmdPath || "").trim().length > 0;
    const hasSteamCmdDownloadPath = String(steamCmdDownloadPath || "").trim().length > 0;

    if (normalizedRuntime === "Steamworks" && !hasSteamCmdPath) {
        return "Steamworks needs a valid Steam session for Stellaris. Configure SteamCMD as the fallback and recovery path.";
    }

    if (normalizedRuntime === "Steamworks") {
        return "Steamworks is preferred when a valid Stellaris Steam session is available. SteamCMD stays ready as the fallback path.";
    }

    if (normalizedRuntime === "SteamCmd") {
        return hasSteamCmdPath && hasSteamCmdDownloadPath
            ? "SteamCMD is configured and ready for standalone downloads, including larger profile imports."
            : "SteamCMD is selected. Set both the executable and download path for reliable installs.";
    }

    return hasSteamCmdPath
        ? "Auto will use the best configured runtime and can fall back to SteamCMD when needed."
        : "Auto works best when SteamCMD is configured as the fallback path.";
}

function applySettingsToForm(settings) {
    const m = { ...getDefaultSettingsModel(), ...(settings || {}) };
    state.settingsModel = m;

    state.library.showEnabledOnly = m.hideDisabledMods === true;
    const libraryEnabledOnly = byId("libraryEnabledOnly");
    if (libraryEnabledOnly) libraryEnabledOnly.checked = state.library.showEnabledOnly;

    setInputValue("settingsPublicProfileInput", m.publicProfileUsername);
    setInputValue("settingsGamePathInput", m.gamePath);
    setInputValue("settingsModsPathInput", m.modsPath);
    setInputValue("settingsSteamCmdPathInput", m.steamCmdPath);
    setInputValue("settingsSteamCmdDownloadPathInput", m.steamCmdDownloadPath);
    setInputValue("settingsThemeInput", m.themePalette || "Obsidian Ember");
    setInputValue("settingsWorkshopRuntimeInput", m.workshopDownloadRuntime || "Auto");

    setCheckboxValue("settingsWarnBeforeRestartInput", m.warnBeforeRestartGame === true);
    setCheckboxValue("settingsDeveloperModeInput", m.developerMode === true);
    setCheckboxValue("settingsAutoUpdatesInput", m.autoCheckAppUpdates === true);

    setText("settingsGameVersionText", toDisplayValue(m.lastDetectedGameVersion));
    updateSettingsGameVersionChip(m.lastDetectedGameVersion);
    setText("settingsLastCheckUtcText", formatUtc(m.lastAppUpdateCheckUtc));
    setText("settingsLastOfferedVersionText", toDisplayValue(m.lastOfferedAppVersion));
    setText("settingsSkippedVersionText", toDisplayValue(m.skippedAppVersion));
    setText("settingsCurrentVersionText", byId("appVersionText")?.textContent || "--");

    const steamText = byId("settingsSteamCmdConfiguredText");
    if (steamText) {
        const configured = !!(m.steamCmdPath?.trim() && m.steamCmdDownloadPath?.trim());
        steamText.textContent = configured ? "Configured" : "Needs SteamCMD path";
        steamText.className = "steam-status-text settings-value " + (configured ? "steam-status-configured" : "steam-status-not-configured");
    }

    syncSettingsRuntimeVisibility();
    syncDeveloperDiagnosticsVisibility();
    applyThemePalette(m.themePalette || "Obsidian Ember");
    markSettingsDirty(false);
}

function syncSettingsRuntimeVisibility() {
    const runtime = getInputValue("settingsWorkshopRuntimeInput") || "Auto";
    const steamCmdPath = getInputValue("settingsSteamCmdPathInput");
    const steamCmdDownloadPath = getInputValue("settingsSteamCmdDownloadPathInput");
    const configured = steamCmdPath.length > 0 && steamCmdDownloadPath.length > 0;

    setText("settingsWorkshopRuntimeChip", `Runtime: ${runtime}`);
    setText("settingsRuntimeHint", getWorkshopRuntimeHint(runtime, steamCmdPath, steamCmdDownloadPath));

    const steamText = byId("settingsSteamCmdConfiguredText");
    if (steamText) {
        steamText.textContent = configured ? "Configured" : "Needs SteamCMD path";
        steamText.className = "steam-status-text settings-value " + (configured ? "steam-status-configured" : "steam-status-not-configured");
    }
}

function syncDeveloperDiagnosticsVisibility() {
    const showDiagnostics = getCheckboxValue("settingsDeveloperModeInput");
    const diagnosticsContent = byId("settingsDiagnosticsContent");
    if (diagnosticsContent) diagnosticsContent.classList.toggle("hidden", !showDiagnostics);

    const diagnosticsHint = byId("settingsDiagnosticsHint");
    if (diagnosticsHint) diagnosticsHint.classList.toggle("hidden", showDiagnostics);
}

function renderSettingsSubtabs() {
    for (const btn of document.querySelectorAll(".settings-subtab")) {
        btn.classList.toggle("is-active", btn.getAttribute("data-settings-tab") === state.settingsTab);
    }
    for (const tab of ["general", "workshop", "updates", "advanced"]) {
        const panel = byId(`settingsTab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`);
        if (panel) panel.classList.toggle("hidden", tab !== state.settingsTab);
    }
}

async function refreshSettingsPage() {
    try {
        const [summary, settings, dbSummary, palettes, runtimes] = await Promise.all([
            window.spikeApi.getSystemSummary(),
            window.spikeApi.getSettings(),
            window.spikeApi.getDbSummary(),
            window.spikeApi.getThemePaletteOptions(),
            window.spikeApi.getDownloadRuntimeOptions()
        ]);

        const paletteSelect = byId("settingsThemeInput");
        if (paletteSelect) paletteSelect.innerHTML = buildThemePaletteOptionsMarkup(palettes);

        const runtimeSelect = byId("settingsWorkshopRuntimeInput");
        if (runtimeSelect) runtimeSelect.innerHTML = runtimes.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");

        applySettingsToForm(settings || getDefaultSettingsModel());
        printJson("runtime", summary);
        printJson("db", dbSummary ?? { message: "No readable mods.db found" });
        setSettingsStatus("Settings loaded.");
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown settings error";
        setSettingsStatus(`Failed to load settings: ${msg}`);
    }
}

async function validateSettingsPage() {
    const current = buildSettingsFromForm();
    const result = await window.spikeApi.validateSettings(current);
    setSettingsStatus(result.ok
        ? (result.warnings.length > 0 ? result.warnings.join(" ") : result.message)
        : result.errors.join(" "));
}

async function saveSettingsPage() {
    const current = buildSettingsFromForm();
    const result = await window.spikeApi.saveSettings(current);
    if (!result.ok) { setSettingsStatus(result.message); return false; }
    applySettingsToForm(result.settings);
    setSettingsStatus(result.message);
    return true;
}

async function autoDetectSettingsPage() {
    const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
    applySettingsToForm(result.settings);
    markSettingsDirty(true);
    setSettingsStatus(result.message);
}

async function detectAndApplyGameVersion(gamePath) {
    if (!gamePath) return;
    try {
        const version = await window.spikeApi.detectGameVersion(gamePath);
        if (!version) return;

        // Update the read-only display text in the settings page.
        setText("settingsGameVersionText", version);
        updateSettingsGameVersionChip(version);

        // Keep the in-memory model in sync so subsequent saves preserve the detected value.
        if (state.settingsModel) {
            state.settingsModel.lastDetectedGameVersion = version;
        }

        // Normalize to major.minor and update the version browser's selected version.
        const normalized = normalizeDetectedGameVersion(version);
        if (normalized && normalized !== state.selectedVersion) {
            state.selectedVersion = normalized;
            state.page = 1;
            // Refresh the dropdown so it reflects the new selection.
            await refreshVersionOptions();
            await refreshVersionResults();
            setSettingsStatus(`Detected game version ${version}; version browser updated to ${normalized}.`);
        } else if (version) {
            setSettingsStatus(`Detected game version ${version}.`);
        }
    } catch {
        // Non-fatal: version stays whatever it was.
    }
}

async function detectModsPathSettings() {
    const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
    const detectedModsPath = String(result?.settings?.modsPath || "").trim();
    if (!detectedModsPath) {
        setSettingsStatus("Could not detect a Stellaris mods path.");
        return;
    }

    setInputValue("settingsModsPathInput", detectedModsPath);
    markSettingsDirty(true);
    setSettingsStatus(`Detected mods path: ${detectedModsPath}`);
}

async function detectWorkshopRuntimeSettings() {
    const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
    const detectedRuntime = String(result?.settings?.workshopDownloadRuntime || "").trim();
    if (!detectedRuntime) {
        setSettingsStatus("Could not detect a workshop download runtime.");
        return;
    }

    setInputValue("settingsWorkshopRuntimeInput", detectedRuntime);
    syncSettingsRuntimeVisibility();
    markSettingsDirty(true);
    setSettingsStatus(`Detected workshop runtime: ${detectedRuntime}`);
}

async function autoConfigureSteamCmdSettings() {
    const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
    const detectedSteamCmdPath = String(result?.settings?.steamCmdPath || "").trim();
    const detectedSteamCmdDownloadPath = String(result?.settings?.steamCmdDownloadPath || "").trim();

    if (!detectedSteamCmdPath || !detectedSteamCmdDownloadPath) {
        setSettingsStatus("Could not auto-configure SteamCMD because no valid steamcmd executable was detected.");
        return;
    }

    if (detectedSteamCmdPath) setInputValue("settingsSteamCmdPathInput", detectedSteamCmdPath);
    if (detectedSteamCmdDownloadPath) setInputValue("settingsSteamCmdDownloadPathInput", detectedSteamCmdDownloadPath);

    const detectedRuntime = String(result?.settings?.workshopDownloadRuntime || "").trim();
    if (detectedRuntime) setInputValue("settingsWorkshopRuntimeInput", detectedRuntime);

    syncSettingsRuntimeVisibility();
    markSettingsDirty(true);
    setSettingsStatus("SteamCMD auto-configuration applied. Review and save settings.");
}

async function ensurePublicUsernameConfigured(forcePrompt = false) {
    const configuredUsername = String(state.settingsModel?.publicProfileUsername || "").trim();
    if (configuredUsername) {
        state.usernamePromptShown = true;
        return true;
    }

    if (state.usernamePromptShown && !forcePrompt) {
        return false;
    }

    state.usernamePromptShown = true;

    const enteredUsername = await showPrompt(
        "Configure Public Username",
        "A public username is required for profile sharing and community reporting. Enter one now:",
        ""
    );

    if (enteredUsername === null) {
        setSettingsStatus("Public username is not configured yet.");
        return false;
    }

    const normalizedUsername = enteredUsername.trim();
    if (!normalizedUsername) {
        setSettingsStatus("Public username is required. You can set it in Settings > General.");
        return false;
    }

    setInputValue("settingsPublicProfileInput", normalizedUsername);
    markSettingsDirty(true);
    if (!await saveSettingsPage()) {
        return false;
    }
    setSettingsStatus("Public username configured.");
    return true;
}

/* ============================================================
   LIBRARY
   ============================================================ */
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
    setText("libraryDetailWorkshopId", mod.workshopId || "—");
    setText("libraryDetailVersion", toDisplayValue(mod.version));
    setText("libraryDetailGameVersion", toDisplayValue(mod.gameVersion));
    setText("libraryDetailInstalledAt", formatUtc(mod.lastUpdatedAtUtc || mod.installedAtUtc));
    setText("libraryDetailDescription", mod.description || "No description available.");

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

    const updateBtn = byId("libraryActionUpdate");
    if (updateBtn) updateBtn.disabled = !mod.hasUpdate;

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

    list.innerHTML = mods.map((mod) => {
        const sel = mod.id === state.library.selectedModId ? " is-selected" : "";
        const isRemoving = state.library.removingModIds.has(mod.id);
        const updateBadge = mod.hasUpdate ? "<span class='badge badge-version'>Update</span>" : "";
        const mpBadge = mod.isMultiplayerSafe ? "<span class='badge badge-community'>MP safe</span>" : "";
        const removingBadge = isRemoving ? "<span class='badge badge-danger'>Removing...</span>" : "";
        const versionLabel = formatVersionBadgeValue(mod.version);
        return `
            <article class="library-row${sel}${isRemoving ? " is-removing" : ""}" data-mod-id="${mod.id}" draggable="${mod.isEnabled && !isRemoving ? "true" : "false"}">
                <div class="library-cell library-enabled">
                    <input type="checkbox" data-action="toggle-enabled" data-mod-id="${mod.id}" ${mod.isEnabled ? "checked" : ""} ${isRemoving ? "disabled" : ""} />
                </div>
                <div class="library-cell library-name">
                    <p class="library-row-title">${escapeHtml(mod.name)}</p>
                    <div class="library-row-badges">
                        <span class="badge">${escapeHtml(versionLabel)}</span>
                        ${mpBadge}${updateBadge}${removingBadge}
                    </div>
                </div>
                <div class="library-cell library-order">
                    <span class="badge">${mod.loadOrder}</span>
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

                const confirmed = await showModal("Remove Mod", "Remove this mod and delete its local files?", "Remove", "Cancel");
                if (!confirmed) return;
                await removeLibraryModWithFeedback(mod);
            }

            return;
        }

        const row = target.closest(".library-row");
        if (!row || !list.contains(row)) {
            return;
        }

        const id = Number.parseInt(row.getAttribute("data-mod-id") || "0", 10);
        if (!Number.isFinite(id) || id <= 0 || state.library.selectedModId === id) {
            return;
        }

        state.library.selectedModId = id;
        state.library.descriptorTagsExpanded = false;
        restoreLibraryTagDraftForSelectedMod();
        renderLibraryList();
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

        const result = await window.spikeApi.setLibraryModEnabled({ modId: id, isEnabled: target.checked === true });
        setLibraryStatus(result.message);
        await refreshLibrarySnapshot();
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
}

function renderLibraryProfiles() {
    const snapshot = state.library.snapshot;
    const select = byId("libraryProfileSelect");
    const sharedValue = byId("librarySharedProfileValue");
    if (!snapshot || !select) return;

    select.innerHTML = snapshot.profiles
        .map((p) => `<option value="${p.id}" ${p.id === snapshot.activeProfileId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("");

    const active = getActiveLibraryProfile();
    if (sharedValue) {
        const currentSharedId = (active?.sharedProfileId || "").trim();
        sharedValue.textContent = currentSharedId || "No shared profile ID set";
        sharedValue.classList.toggle("is-empty", !currentSharedId);
        if (currentSharedId) {
            sharedValue.title = currentSharedId;
        } else {
            sharedValue.title = "No shared profile ID set";
        }
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

async function getWorkshopOverlayActionState(workshopId) {
    try {
        const [librarySnapshot, queueSnapshot] = await Promise.all([
            window.spikeApi.getLibrarySnapshot(),
            window.spikeApi.getDownloadQueueSnapshot()
        ]);

        const activeQueueItem = (queueSnapshot.items || []).find((item) => {
            if (item.workshopId !== workshopId) return false;
            return item.status === "queued" || item.status === "running";
        });

        if (activeQueueItem) {
            if (activeQueueItem.status === "queued") {
                return "queued";
            }
            return activeQueueItem.action === "uninstall" ? "uninstalling" : "installing";
        }

        const isInstalled = (librarySnapshot.mods || []).some((mod) => mod.workshopId === workshopId);
        return isInstalled ? "installed" : "not-installed";
    } catch {
        return "error";
    }
}

/* ============================================================
   WORKSHOP VIEW
   ============================================================ */
const WORKSHOP_HOME = "https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems&days=90";

function restoreVersionTabFromWorkshopContext() {
    const context = state.workshopReturnContext;
    if (!context || context.fromTab !== "version") {
        return false;
    }

    state.workshopReturnContext = null;
    activateTab("version");

    const scrollTop = Number.isFinite(context.scrollTop) ? context.scrollTop : 0;
    const workshopId = String(context.workshopId || "").trim();

    const restoreScroll = () => {
        const container = byId("versionCards");
        if (!container) {
            return;
        }

        container.scrollTop = Math.max(0, scrollTop);

        if (workshopId) {
            const card = container.querySelector(`.mod-card[data-workshop-id="${workshopId}"]`);
            if (card instanceof HTMLElement) {
                card.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
        }
    };

    requestAnimationFrame(() => {
        restoreScroll();
        requestAnimationFrame(restoreScroll);
    });

    return true;
}

function initWorkshop() {
    const webview = byId("workshopWebview");
    const urlInput = byId("workshopUrl");
    const loading = byId("workshopLoading");

    if (!webview) return;

    const navigateWorkshopHistory = (direction) => {
        if (direction === "back") {
            if (restoreVersionTabFromWorkshopContext()) {
                return true;
            }

            if (webview.canGoBack()) {
                webview.goBack();
                return true;
            }
            return false;
        }

        if (webview.canGoForward()) {
            webview.goForward();
            return true;
        }

        return false;
    };

    const handleWorkshopSideButton = (event) => {
        if (state.selectedTab !== "workshop") {
            return;
        }

        if (event.button === 3) {
            if (navigateWorkshopHistory("back")) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (event.button === 4) {
            if (navigateWorkshopHistory("forward")) {
                event.preventDefault();
                event.stopPropagation();
            }
        }
    };

    if (!state.workshopMouseNavHooked) {
        window.addEventListener("mouseup", handleWorkshopSideButton, true);
        window.addEventListener("auxclick", handleWorkshopSideButton, true);
        state.workshopMouseNavHooked = true;
    }

    webview.addEventListener("did-start-loading", () => {
        if (loading) loading.classList.add("is-loading");
    });
    webview.addEventListener("did-stop-loading", () => {
        if (loading) loading.classList.remove("is-loading");
        // Inject CSS to improve Steam workshop rendering in the embedded webview
        webview.insertCSS(`
            body { background: #1b2838 !important; }
            .responsive_page_template_content { min-height: 600px !important; }
            .apphub_HomeHeaderContent { display: none !important; }
            #global_header { position: sticky; top: 0; z-index: 100; }
        `).catch(() => { });
    });
    webview.addEventListener("did-navigate", (e) => {
        if (urlInput) urlInput.value = e.url;
    });
    webview.addEventListener("did-navigate-in-page", (e) => {
        if (urlInput && e.isMainFrame) urlInput.value = e.url;
    });

    // Handle new-window requests from Steam links (opens in same webview)
    webview.addEventListener("new-window", (e) => {
        const url = e.url;
        if (url && url.startsWith("http")) {
            e.preventDefault();
            if (url.includes("steamcommunity.com") || url.includes("store.steampowered.com")) {
                webview.loadURL(url);
            } else {
                void window.spikeApi.openExternalUrl(url);
            }
        }
    });

    webview.addEventListener("ipc-message", async (e) => {
        if (e.channel === "smm-open-url") {
            const url = String(e.args?.[0] ?? "").trim();
            if (!url || !url.startsWith("http")) return;

            if (url.includes("steamcommunity.com") || url.includes("store.steampowered.com")) {
                webview.loadURL(url);
            } else {
                void window.spikeApi.openExternalUrl(url);
            }
            return;
        }

        if (e.channel === "smm-query-mod-state") {
            const workshopId = normalizeWorkshopId(e.args?.[0]);
            if (!isValidWorkshopId(workshopId)) return;

            const actionState = await getWorkshopOverlayActionState(workshopId);
            webview.send("smm-mod-state", { workshopId, actionState });
            return;
        }

        if (e.channel === "smm-toggle-workshop-mod" || e.channel === "smm-add-workshop-mod") {
            const payload = e.args?.[0];

            const rawWorkshopId = (typeof payload === "string" || typeof payload === "number")
                ? String(payload)
                : String(payload?.workshopId ?? payload?.workshop_id ?? payload?.id ?? "");
            const workshopId = normalizeWorkshopId(rawWorkshopId);
            if (!isValidWorkshopId(workshopId)) {
                setLibraryStatus("Invalid workshop ID. Paste the numeric ID or a Steam Workshop URL.");
                return;
            }

            const action = payload && typeof payload === "object" && payload.action === "uninstall"
                ? "uninstall"
                : "install";

            const modName = getModNameByWorkshopId(workshopId);
            const result = await queueDownloadAction({ workshopId, modName, action });
            setLibraryStatus(result.message);
            if (result.blockedBySettings) {
                const actionState = await getWorkshopOverlayActionState(workshopId);
                webview.send("smm-mod-state", { workshopId, actionState });
                return;
            }

            await Promise.all([
                refreshQueueSnapshot(),
                refreshLibrarySnapshot()
            ]);

            if (state.activeDetailWorkshopId === workshopId) {
                await refreshDetailDrawer(workshopId);
            }

            const actionState = await getWorkshopOverlayActionState(workshopId);
            webview.send("smm-mod-state", { workshopId, actionState });
            return;
        }
    });

    byId("workshopBack")?.addEventListener("click", () => { void navigateWorkshopHistory("back"); });
    byId("workshopForward")?.addEventListener("click", () => { void navigateWorkshopHistory("forward"); });
    byId("workshopRefresh")?.addEventListener("click", () => webview.reload());
    byId("workshopHome")?.addEventListener("click", () => webview.loadURL(WORKSHOP_HOME));
    byId("workshopGo")?.addEventListener("click", () => {
        const url = urlInput?.value?.trim();
        if (url) webview.loadURL(url.startsWith("http") ? url : `https://${url}`);
    });

    if (urlInput) {
        urlInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const url = urlInput.value.trim();
                if (url) webview.loadURL(url.startsWith("http") ? url : `https://${url}`);
            }
        });
    }
}

/* ============================================================
   TAB NAVIGATION
   ============================================================ */
let suppressTabHistoryRecord = false;

function activateTab(name) {
    const prev = state.selectedTab;
    if (!suppressTabHistoryRecord && prev && prev !== name) {
        state.tabHistory.push(prev);
        if (state.tabHistory.length > 50) state.tabHistory.shift();
        state.tabForwardStack.length = 0;
    }
    state.selectedTab = name;

    const tabs = {
        version: "tabVersion",
        library: "tabLibrary",
        downloads: "tabDownloads",
        workshop: "tabWorkshop",
        settings: "tabSettings"
    };
    for (const [tabName, id] of Object.entries(tabs)) {
        const el = byId(id);
        if (el) el.classList.toggle("is-active", tabName === name);
    }

    const pages = {
        version: "pageVersion",
        library: "pageLibrary",
        downloads: "pageDownloads",
        workshop: "pageWorkshop",
        settings: "pageSettings"
    };
    for (const [tabName, id] of Object.entries(pages)) {
        const el = byId(id);
        if (el) el.classList.toggle("hidden", tabName !== name);
    }

    const statusMap = {
        version: "Version browser ready.",
        library: "Library view ready.",
        downloads: "Downloads queue ready.",
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

/* ============================================================
   EVENT HOOKS
   ============================================================ */
function hookVersionControls() {
    hookVersionCardDelegation();

    byId("versionSelect")?.addEventListener("change", (e) => {
        state.selectedVersion = e.target.value;
        state.page = 1;
        void refreshVersionResults();
    });
    byId("sortSelect")?.addEventListener("change", (e) => {
        state.sortMode = e.target.value;
        state.page = 1;
        void refreshVersionResults();
    });
    byId("showOlderVersions")?.addEventListener("change", (e) => {
        state.showOlderVersions = e.target.checked;
        state.page = 1;
        void refreshVersionOptions().then(() => refreshVersionResults());
    });

    const searchInput = byId("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            state.searchText = searchInput.value.trim();
            state.page = 1;
            syncSearchClearButton();
            if (state.searchDebounceHandle) clearTimeout(state.searchDebounceHandle);
            state.searchDebounceHandle = setTimeout(() => void refreshVersionResults(), 260);
        });
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (state.searchDebounceHandle) clearTimeout(state.searchDebounceHandle);
                void refreshVersionResults();
            }
        });
    }

    byId("searchClear")?.addEventListener("click", () => {
        if (searchInput && searchInput.value) {
            searchInput.value = "";
            state.searchText = "";
            state.page = 1;
            syncSearchClearButton();
            void refreshVersionResults();
            searchInput.focus();
        }
    });

    byId("versionRefresh")?.addEventListener("click", async () => {
        await window.spikeApi.clearVersionResultCache();
        void refreshVersionResults();
    });
    byId("pagePrev")?.addEventListener("click", () => { if (state.page > 1) { state.page -= 1; void refreshVersionResults(); } });
    byId("pageNext")?.addEventListener("click", () => { if (state.page < state.totalPages) { state.page += 1; void refreshVersionResults(); } });
}

function hookSettingsControls() {
    byId("refreshSettings")?.addEventListener("click", async () => {
        if (state.settingsDirty) {
            const proceed = await showModal(
                "Unsaved settings changes",
                "Refreshing will discard your unsaved settings changes. Continue?",
                "Refresh anyway",
                "Cancel"
            );
            if (!proceed) return;
        }
        await refreshSettingsPage();
    });
    byId("validateSettings")?.addEventListener("click", () => void validateSettingsPage());
    byId("saveSettings")?.addEventListener("click", () => void saveSettingsPage());

    for (const btn of document.querySelectorAll(".settings-subtab")) {
        btn.addEventListener("click", () => {
            state.settingsTab = btn.getAttribute("data-settings-tab") || "general";
            renderSettingsSubtabs();
        });
    }

    const dirtyInputs = [
        "settingsPublicProfileInput", "settingsGamePathInput", "settingsModsPathInput",
        "settingsSteamCmdPathInput", "settingsSteamCmdDownloadPathInput",
        "settingsWorkshopRuntimeInput", "settingsThemeInput"
    ];
    for (const id of dirtyInputs) {
        byId(id)?.addEventListener("input", () => {
            markSettingsDirty(true);
            if (id === "settingsWorkshopRuntimeInput") syncSettingsRuntimeVisibility();
            if (id === "settingsThemeInput") applyThemePalette(getInputValue("settingsThemeInput"));
        });
    }

    byId("settingsThemeInput")?.addEventListener("change", () => {
        markSettingsDirty(true);
        applyThemePalette(getInputValue("settingsThemeInput"));
    });

    const dirtyCheckboxes = [
        "settingsWarnBeforeRestartInput",
        "settingsDeveloperModeInput", "settingsAutoUpdatesInput"
    ];
    for (const id of dirtyCheckboxes) {
        byId(id)?.addEventListener("change", () => {
            markSettingsDirty(true);
            if (id === "settingsDeveloperModeInput") syncDeveloperDiagnosticsVisibility();
        });
    }

    byId("settingsGamePathInput")?.addEventListener("blur", () => {
        const gamePath = getInputValue("settingsGamePathInput");
        if (gamePath) {
            void detectAndApplyGameVersion(gamePath);
        }
    });

    byId("settingsGamePathBrowse")?.addEventListener("click", async () => {
        const selectedPath = await window.spikeApi.pickDirectory({
            title: "Select Stellaris installation folder",
            defaultPath: getInputValue("settingsGamePathInput")
        });

        if (!selectedPath) {
            return;
        }

        setInputValue("settingsGamePathInput", selectedPath);
        markSettingsDirty(true);
        void detectAndApplyGameVersion(selectedPath);
    });

    byId("settingsDetectModsPath")?.addEventListener("click", () => void detectModsPathSettings());
    byId("settingsDetectWorkshopRuntime")?.addEventListener("click", () => void detectWorkshopRuntimeSettings());
    byId("settingsAutoConfigureSteamCmd")?.addEventListener("click", () => void autoConfigureSteamCmdSettings());
}

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
        const result = await window.spikeApi.activateLibraryProfile(id);
        setLibraryStatus(result.message);
        await refreshLibrarySnapshot();
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
                    await window.spikeApi.activateLibraryProfile(p.id);
                    await refreshLibrarySnapshot();
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
            const syncResult = await window.spikeApi.syncLibrarySharedProfile({
                profileId: active.id,
                sharedProfileId: parsedShared.sharedProfileId,
                sharedProfileSince: parsedShared.sharedProfileSince
            });
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
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLibraryStatus(`Failed to sync shared profile: ${message}`);
        }
    });

    byId("libraryShareProfile")?.addEventListener("click", async () => {
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

        const copied = await window.spikeApi.copyText(publishResult.sharedProfileId);
        setLibraryStatus(
            copied
                ? `${publishResult.message} ID copied: ${publishResult.sharedProfileId}`
                : `${publishResult.message} ID: ${publishResult.sharedProfileId}`
        );
        await refreshLibrarySnapshot();
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
    byId("libraryActionUpdate")?.addEventListener("click", async () => {
        const mod = getSelectedLibraryMod();
        if (mod) await queueAction(mod.workshopId, "install", "library");
    });
    byId("libraryActionReinstall")?.addEventListener("click", async () => {
        const mod = getSelectedLibraryMod();
        if (mod) await queueAction(mod.workshopId, "install", "library");
    });
    byId("libraryActionWorks")?.addEventListener("click", () => void runLibraryCompatibilityReport(true));
    byId("libraryActionBroken")?.addEventListener("click", () => void runLibraryCompatibilityReport(false));
    byId("libraryActionWorkshop")?.addEventListener("click", () => {
        const mod = getSelectedLibraryMod();
        if (!mod) return;
        const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`;
        state.workshopReturnContext = null;
        activateTab("workshop");
        const webview = byId("workshopWebview");
        if (webview) webview.loadURL(url);
        const urlInput = byId("workshopUrl");
        if (urlInput) urlInput.value = url;
    });
    byId("libraryActionLocation")?.addEventListener("click", async () => {
        const mod = getSelectedLibraryMod();
        if (!mod) return;
        const ok = await window.spikeApi.openPathInFileExplorer(mod.installedPath || mod.descriptorPath);
        setLibraryStatus(ok ? "Opened file location." : "Could not open file location.");
    });
    byId("libraryActionRemove")?.addEventListener("click", async () => {
        const mod = getSelectedLibraryMod();
        if (!mod) return;
        const confirmed = await showModal("Remove Mod", `Remove '${mod.name}'?`, "Remove", "Cancel");
        if (!confirmed) return;
        await removeLibraryModWithFeedback(mod);
    });
}

/* ============================================================
   APP UPDATES
   ============================================================ */
state.appUpdate = { release: null, message: "Not checked yet.", busy: false };

async function checkForAppUpdates(source = "auto") {
    if (state.appUpdate.busy) return;
    state.appUpdate.busy = true;
    const statusEl = byId("settingsUpdateStatus");
    if (source === "manual" && statusEl) statusEl.textContent = "Checking for updates…";
    try {
        const result = await window.spikeApi.checkAppUpdate();
        state.appUpdate.message = result.message;
        const release = result.hasUpdate ? result.release : null;
        const skipped = state.settingsModel?.skippedAppVersion || "";
        state.appUpdate.release = release && release.version !== skipped ? release : null;
    } catch (err) {
        state.appUpdate.release = null;
        state.appUpdate.message = `Update check failed: ${err?.message || err}`;
    } finally {
        state.appUpdate.busy = false;
        renderAppUpdateBanner();
        renderSettingsAppUpdate();
    }
}

function renderAppUpdateBanner() {
    const banner = byId("updateBanner");
    if (!banner) return;
    const release = state.appUpdate.release;
    if (!release) {
        banner.classList.add("hidden");
        return;
    }
    const versionEl = byId("updateBannerVersion");
    const messageEl = byId("updateBannerMessage");
    if (versionEl) versionEl.textContent = `v${release.version} available`;
    if (messageEl) {
        messageEl.textContent = release.critical
            ? "Critical update — install as soon as possible."
            : "A new version is ready to install.";
    }
    banner.classList.remove("hidden");
}

function renderSettingsAppUpdate() {
    const statusEl = byId("settingsUpdateStatus");
    if (statusEl) statusEl.textContent = state.appUpdate.message || "Not checked yet.";

    const card = byId("settingsUpdateAvailable");
    const release = state.appUpdate.release;
    if (!card) return;
    if (!release) {
        card.classList.add("hidden");
        return;
    }
    card.classList.remove("hidden");
    const badge = byId("settingsUpdateVersionBadge");
    if (badge) badge.textContent = `v${release.version}`;
    const changelog = byId("settingsUpdateChangelog");
    if (changelog) changelog.textContent = release.changelog || "See release notes on GitHub.";
}

async function launchAppUpdateFlow() {
    const release = state.appUpdate.release;
    if (!release) return;
    const result = await window.spikeApi.startAppUpdate(release);
    if (!result?.ok) {
        state.appUpdate.message = result?.message || "Could not start updater.";
        renderSettingsAppUpdate();
    }
    // On success the main process quits this app; no further UI work.
}

async function skipCurrentAppVersion() {
    const release = state.appUpdate.release;
    if (!release) return;
    await window.spikeApi.skipAppVersion(release.version);
    if (state.settingsModel) state.settingsModel.skippedAppVersion = release.version;
    state.appUpdate.release = null;
    renderAppUpdateBanner();
    renderSettingsAppUpdate();
}

function hookAppUpdateControls() {
    byId("updateBannerUpdate")?.addEventListener("click", () => void launchAppUpdateFlow());
    byId("updateBannerSkip")?.addEventListener("click", () => void skipCurrentAppVersion());
    byId("updateBannerDismiss")?.addEventListener("click", () => {
        byId("updateBanner")?.classList.add("hidden");
    });
    byId("updateBannerBackdrop")?.addEventListener("click", () => {
        byId("updateBanner")?.classList.add("hidden");
    });

    byId("settingsCheckUpdateBtn")?.addEventListener("click", () => void checkForAppUpdates("manual"));
    byId("settingsDownloadUpdateBtn")?.addEventListener("click", () => void launchAppUpdateFlow());
    byId("settingsSkipVersionBtn")?.addEventListener("click", () => void skipCurrentAppVersion());
    byId("settingsViewReleaseBtn")?.addEventListener("click", () => {
        const url = state.appUpdate.release?.releaseUrl;
        if (url) void window.spikeApi.openExternalUrl(url);
    });
}

function hookGlobalControls() {
    byId("tabVersion")?.addEventListener("click", () => void activateTabGuarded("version"));
    byId("tabLibrary")?.addEventListener("click", () => void activateTabGuarded("library"));
    byId("tabDownloads")?.addEventListener("click", () => void activateTabGuarded("downloads"));
    byId("tabWorkshop")?.addEventListener("click", () => {
        state.workshopReturnContext = null;
        void activateTabGuarded("workshop");
    });
    byId("tabSettings")?.addEventListener("click", () => void activateTabGuarded("settings"));
    byId("launchGameBtn")?.addEventListener("click", () => void handleLaunchGame());
    byId("queueCancelAll")?.addEventListener("click", () => void cancelAllQueueActions());
    byId("queueClearFinished")?.addEventListener("click", () => void clearQueueHistory());

    byId("detailCloseBackdrop")?.addEventListener("click", () => showDetailDrawer(false));
    byId("detailCloseButton")?.addEventListener("click", () => showDetailDrawer(false));

    window.addEventListener("keydown", (e) => {
        if (state.selectedTab === "workshop") {
            if (e.key === "BrowserBack") {
                if (restoreVersionTabFromWorkshopContext()) {
                    e.preventDefault();
                    return;
                }

                const webview = byId("workshopWebview");
                if (webview?.canGoBack()) {
                    e.preventDefault();
                    webview.goBack();
                    return;
                }
            }

            if (e.key === "BrowserForward") {
                const webview = byId("workshopWebview");
                if (webview?.canGoForward()) {
                    e.preventDefault();
                    webview.goForward();
                    return;
                }
            }
        }

        if (e.key === "Escape") {
            showDetailDrawer(false);
            const overlay = byId("modalOverlay");
            if (overlay && !overlay.classList.contains("hidden")) {
                overlay.classList.add("hidden");
            } else {
                const updatePopup = byId("updateBanner");
                if (updatePopup && !updatePopup.classList.contains("hidden")) {
                    updatePopup.classList.add("hidden");
                }
            }
            return;
        }

        if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const target = e.target;
            const isTyping = target instanceof HTMLElement
                && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
            if (!isTyping) {
                const input = state.selectedTab === "library" ? byId("librarySearchInput") : byId("searchInput");
                if (input) { e.preventDefault(); input.focus(); }
            }
        }
    });

    window.addEventListener("beforeunload", (e) => {
        if (!state.settingsDirty) {
            return;
        }
        e.preventDefault();
        e.returnValue = "";
    });

    const handleMouseNavButton = (e) => {
        if (e.button !== 3 && e.button !== 4) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type !== "mouseup") return;

        if (state.selectedTab === "workshop") {
            const webview = byId("workshopWebview");
            if (e.button === 3) {
                if (restoreVersionTabFromWorkshopContext()) return;
                if (webview?.canGoBack?.()) { webview.goBack(); return; }
            } else if (e.button === 4) {
                if (webview?.canGoForward?.()) { webview.goForward(); return; }
            }
        }

        if (e.button === 3) {
            void navigateTabHistoryBack();
        } else {
            void navigateTabHistoryForward();
        }
    };
    window.addEventListener("mousedown", handleMouseNavButton);
    window.addEventListener("mouseup", handleMouseNavButton);
    window.addEventListener("auxclick", handleMouseNavButton);
}

/* ============================================================
   INITIALIZATION
   ============================================================ */
async function init() {
    hookWindowResizeResponsiveness();
    applyDataIcons(document);
    hookVersionControls();
    hookSettingsControls();
    hookLibraryControls();
    hookGlobalControls();
    hookAppUpdateControls();
    initWorkshop();
    renderSettingsSubtabs();

    // Handshake + version
    try {
        await window.spikeApi.ping();
        const version = await window.spikeApi.getAppVersion();
        setText("appVersionText", `v${version}`);
    } catch {
        setText("appVersionText", "v0.1.0");
    }

    await applyAppIcon();

    await bootstrapSelectedVersionFromSettings();

    // Load all data in parallel
    await Promise.all([
        refreshVersionOptions(),
        refreshSettingsPage(),
        refreshLibrarySnapshot(),
        refreshQueueSnapshot(),
        refreshStellarisyncStatus(),
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
    state.gamePollingHandle = setInterval(() => void refreshGameRunningStatus(), 3000);

    if (state.stellarisyncPollingHandle) clearInterval(state.stellarisyncPollingHandle);
    state.stellarisyncPollingHandle = setInterval(() => void refreshStellarisyncStatus(), 120000);

    if (state.settingsModel?.autoCheckAppUpdates !== false) {
        void checkForAppUpdates("auto");
    }
}

void init();
