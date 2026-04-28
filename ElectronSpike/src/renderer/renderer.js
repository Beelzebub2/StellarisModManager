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
    versionLoadingDelayHandle: null,
    versionSkeletonVisible: false,
    versionRequestSeq: 0,
    activeDetailWorkshopId: null,
    activeCards: [],
    settingsModel: null,
    settingsDirty: false,
    usernamePromptShown: false,
    gameRunning: false,
    gamePollingHandle: null,
    stellarisyncPollingHandle: null,
    modsPathMigrationPollingHandle: null,
    mergerProgressPollingHandle: null,
    modsPathMigration: {
        active: false,
        sourceModsPath: null,
        targetModsPath: null,
        moveExistingMods: false,
        startedAtUtc: null,
        completedAtUtc: null,
        lastMessage: null,
        currentModName: null,
        currentPhase: null,
        processedModCount: 0,
        totalModCount: 0,
        progressPercent: 0,
        modalVisible: false,
        backgrounded: false,
        pendingPromise: null
    },
    workshopMouseNavHooked: false,
    workshopReturnContext: null,
    tabHistory: [],
    tabForwardStack: [],
    queueHadActiveWork: false,
    queueRowsByWorkshopId: new Map(),
    queueSnapshot: null,
    queueLibrarySyncKey: "",
    queueLibrarySyncInFlight: false,
    downloadFailureNotice: {
        latestFailureKey: "",
        dismissedFailureKey: "",
        workshopId: null,
        modName: null,
        message: "",
        updatedAtUtc: null
    },
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
    },
    merger: {
        plan: null,
        summary: null,
        selectedVirtualPath: null,
        lastBuildOutputPath: null,
        lastReportPath: null,
        progress: {
            active: false,
            operation: null,
            startedAtUtc: null,
            completedAtUtc: null,
            phase: null,
            currentItemLabel: null,
            processedItemCount: 0,
            totalItemCount: 0,
            progressPercent: 0,
            message: null,
            lastResultOk: null,
            modalVisible: false,
            backgrounded: false
        }
    }
};

const libraryVisibility = globalThis.libraryVisibility || {};
const appUpdateState = globalThis.appUpdateState || {};
const promptInputBehavior = globalThis.promptInputBehavior || {};
const downloadQueueState = globalThis.downloadQueueState || {};

const VERSION_SKELETON_DELAY_MS = 220;
const VERSION_SKELETON_CARD_COUNT = 6;
const SETTINGS_DOWNLOAD_CONCURRENCY_MIN = 1;
const SETTINGS_DOWNLOAD_CONCURRENCY_MAX = 5;
const DEFAULT_STEAMWORKS_CONCURRENCY = 3;
const DEFAULT_STEAMCMD_CONCURRENCY = 1;
const TOOLTIP_SHOW_DELAY_MS = 90;
const TOOLTIP_OFFSET_PX = 14;

const tooltipState = {
    activeTarget: null,
    pendingTarget: null,
    showTimer: null,
    observer: null
};

const THEME_PALETTE_TO_KEY = Object.freeze({
    "Obsidian Ember": "obsidian-ember",
    "Graphite Moss": "graphite-moss",
    "Nocturne Slate": "nocturne-slate",
    "Starlight White": "starlight-white",
    "Ivory White": "ivory-white",
    "Frost White": "frost-white"
});

const ICON_PATHS = Object.freeze({
    versions: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-6.9 6.9a2.12 2.12 0 0 1-3-3l6.9-6.9a6 6 0 0 1 9.36-7.94l-3.79 3.79z"/>',
    launch: '<polygon points="5 3 19 12 5 21 5 3"/>',
    restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    achievement: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M8 4h8v4a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4z"/><path d="M16 6h2a2 2 0 0 1 0 4h-2"/><path d="M8 6H6a2 2 0 0 0 0 4h2"/>',
    achievementBroken: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M8 4h8v4a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4z"/><path d="M16 6h2a2 2 0 0 1 0 4h-2"/><path d="M8 6H6a2 2 0 0 0 0 4h2"/><path d="m10 5 2 3-2 3 2 3"/>',
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
    merge: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/><path d="M14 12H10"/>',
    sparkles: '<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/><path d="M5 14l.9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14z"/>',
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

function clearTooltipShowTimer() {
    if (tooltipState.showTimer) {
        clearTimeout(tooltipState.showTimer);
        tooltipState.showTimer = null;
    }
}

function getTooltipHost() {
    return byId("appTooltip");
}

function getTooltipText(target) {
    if (!(target instanceof HTMLElement)) {
        return "";
    }

    return String(target.dataset.tooltip || "").trim();
}

function findTooltipTarget(value) {
    if (!(value instanceof Element)) {
        return null;
    }

    const target = value.closest("[data-tooltip]");
    return target instanceof HTMLElement ? target : null;
}

function upgradeNativeTitlesToTooltips(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") {
        return;
    }

    if (root instanceof HTMLElement && root.hasAttribute("title")) {
        const title = String(root.getAttribute("title") || "").trim();
        if (title) {
            if (!root.dataset.tooltip) {
                root.dataset.tooltip = title;
            }
            if (!root.getAttribute("aria-label") && !String(root.textContent || "").trim()) {
                root.setAttribute("aria-label", title);
            }
            root.removeAttribute("title");
        }
    }

    for (const el of root.querySelectorAll("[title]")) {
        if (!(el instanceof HTMLElement)) {
            continue;
        }

        const title = String(el.getAttribute("title") || "").trim();
        if (!title) {
            continue;
        }

        if (!el.dataset.tooltip) {
            el.dataset.tooltip = title;
        }

        if (!el.getAttribute("aria-label") && !String(el.textContent || "").trim()) {
            el.setAttribute("aria-label", title);
        }

        el.removeAttribute("title");
    }
}

function positionTooltip(target) {
    const host = getTooltipHost();
    if (!host || !(target instanceof HTMLElement)) {
        return;
    }

    const targetRect = target.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - hostRect.width - 8);
    let x = Math.round(targetRect.left + (targetRect.width / 2) - (hostRect.width / 2));
    x = Math.min(maxX, Math.max(8, x));

    let y = Math.round(targetRect.bottom + TOOLTIP_OFFSET_PX);
    if (y + hostRect.height > window.innerHeight - 8) {
        y = Math.max(8, Math.round(targetRect.top - hostRect.height - TOOLTIP_OFFSET_PX));
    }

    host.style.setProperty("--tooltip-x", `${x}px`);
    host.style.setProperty("--tooltip-y", `${y}px`);
}

function hideTooltip() {
    clearTooltipShowTimer();
    tooltipState.pendingTarget = null;
    tooltipState.activeTarget = null;

    const host = getTooltipHost();
    if (!host) {
        return;
    }

    host.classList.remove("is-visible");
    host.setAttribute("aria-hidden", "true");
}

function showTooltip(target) {
    const host = getTooltipHost();
    const text = getTooltipText(target);
    if (!host || !text || !(target instanceof HTMLElement)) {
        hideTooltip();
        return;
    }

    tooltipState.pendingTarget = null;
    tooltipState.activeTarget = target;
    host.textContent = text;
    host.setAttribute("aria-hidden", "false");
    host.classList.add("is-visible");
    positionTooltip(target);
}

function scheduleTooltipShow(target) {
    const text = getTooltipText(target);
    if (!text || !(target instanceof HTMLElement)) {
        hideTooltip();
        return;
    }

    clearTooltipShowTimer();
    tooltipState.pendingTarget = target;
    tooltipState.showTimer = setTimeout(() => {
        if (tooltipState.pendingTarget === target) {
            showTooltip(target);
        }
    }, TOOLTIP_SHOW_DELAY_MS);
}

function hookCustomTooltips() {
    if (tooltipState.observer) {
        return;
    }

    upgradeNativeTitlesToTooltips(document);

    const handleTooltipExit = (target, relatedTarget) => {
        if (!(target instanceof HTMLElement)) {
            hideTooltip();
            return;
        }

        if (relatedTarget instanceof Node && target.contains(relatedTarget)) {
            return;
        }

        if (tooltipState.activeTarget === target || tooltipState.pendingTarget === target) {
            hideTooltip();
        }
    };

    document.addEventListener("mouseover", (event) => {
        const target = findTooltipTarget(event.target);
        if (!target) {
            return;
        }

        if (tooltipState.activeTarget === target) {
            positionTooltip(target);
            return;
        }

        scheduleTooltipShow(target);
    });

    document.addEventListener("mouseout", (event) => {
        handleTooltipExit(findTooltipTarget(event.target), event.relatedTarget);
    });

    document.addEventListener("focusin", (event) => {
        const target = findTooltipTarget(event.target);
        if (target) {
            scheduleTooltipShow(target);
        }
    });

    document.addEventListener("focusout", (event) => {
        handleTooltipExit(findTooltipTarget(event.target), event.relatedTarget);
    });

    document.addEventListener("mousemove", () => {
        if (tooltipState.activeTarget) {
            positionTooltip(tooltipState.activeTarget);
        }
    }, { passive: true });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hideTooltip();
        }
    });

    window.addEventListener("scroll", () => hideTooltip(), true);
    window.addEventListener("blur", () => hideTooltip());
    window.addEventListener("resize", () => {
        if (tooltipState.activeTarget) {
            positionTooltip(tooltipState.activeTarget);
        } else {
            hideTooltip();
        }
    });

    tooltipState.observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
                upgradeNativeTitlesToTooltips(mutation.target);
                continue;
            }

            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLElement) {
                    upgradeNativeTitlesToTooltips(node);
                }
            }
        }
    });

    tooltipState.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["title"]
    });
}

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
    const variants = [];

    for (const palette of palettes || []) {
        variants.push(normalizeThemePaletteName(palette));
    }

    const uniqueVariants = [...new Set(variants)];

    const renderOptions = (items) => items
        .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
        .join("");

    if (uniqueVariants.length === 0) {
        return "";
    }

    return `<optgroup label="Dark Glass Themes">${renderOptions(uniqueVariants)}</optgroup>`;
}

function applyThemePalette(paletteName) {
    const normalized = normalizeThemePaletteName(paletteName);
    const themeKey = THEME_PALETTE_TO_KEY[normalized] || THEME_PALETTE_TO_KEY["Obsidian Ember"];
    document.body.setAttribute("data-theme", themeKey);
    void window.spikeApi.setWindowChromeTheme(normalized).catch(() => {
        // Native titlebar overlay syncing is cosmetic; ignore failures.
    });
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

function setMergerStatus(text) {
    setText("mergerStatus", text);
    if (state.selectedTab === "merger") setGlobalStatus(text);
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

function clearVersionLoadingDelay() {
    if (state.versionLoadingDelayHandle !== null) {
        clearTimeout(state.versionLoadingDelayHandle);
        state.versionLoadingDelayHandle = null;
    }
}

function resetVersionCardsLoadingState(container = byId("versionCards")) {
    if (!container) return;
    container.classList.remove("is-loading-skeleton");
    container.setAttribute("aria-busy", "false");
    state.versionSkeletonVisible = false;
}

function buildVersionSkeletonCards(count = VERSION_SKELETON_CARD_COUNT) {
    return Array.from({ length: count }, () => `
        <article class="mod-card mod-card-skeleton" aria-hidden="true">
            <div class="mod-thumb mod-thumb-skeleton skeleton"></div>
            <div class="mod-body">
                <div class="mod-copy version-skeleton-copy">
                    <div class="skeleton version-skeleton-title"></div>
                    <div class="version-skeleton-badges">
                        <span class="skeleton version-skeleton-badge"></span>
                        <span class="skeleton version-skeleton-badge version-skeleton-badge-wide"></span>
                    </div>
                    <div class="version-skeleton-stats">
                        <div class="version-skeleton-stat">
                            <span class="skeleton version-skeleton-stat-value"></span>
                            <span class="skeleton version-skeleton-stat-label"></span>
                        </div>
                        <div class="version-skeleton-stat">
                            <span class="skeleton version-skeleton-stat-value"></span>
                            <span class="skeleton version-skeleton-stat-label"></span>
                        </div>
                    </div>
                    <div class="skeleton version-skeleton-meta"></div>
                </div>
                <div class="mod-footer">
                    <span class="skeleton version-skeleton-action"></span>
                </div>
            </div>
        </article>`).join("\n");
}

function renderVersionLoadingSkeletons() {
    const container = byId("versionCards");
    if (!container) return;

    state.activeCards = [];
    state.versionSkeletonVisible = true;
    container.classList.add("is-loading-skeleton");
    container.setAttribute("aria-busy", "true");
    container.innerHTML = buildVersionSkeletonCards();
}

function scheduleVersionLoadingSkeleton(requestSeq) {
    clearVersionLoadingDelay();
    state.versionSkeletonVisible = false;

    state.versionLoadingDelayHandle = window.setTimeout(() => {
        state.versionLoadingDelayHandle = null;
        if (!state.isLoading || requestSeq !== state.versionRequestSeq) {
            return;
        }

        renderVersionLoadingSkeletons();
    }, VERSION_SKELETON_DELAY_MS);
}

function renderVersionFeedbackCard(title, message) {
    state.activeCards = [];
    clearVersionLoadingDelay();
    const container = byId("versionCards");
    if (!container) return;

    resetVersionCardsLoadingState(container);
    container.innerHTML = `
        <article class="panel-lite" style="padding:20px;text-align:center;">
            <h3 style="margin:0 0 6px">${escapeHtml(title)}</h3>
            <p class="muted">${escapeHtml(message)}</p>
        </article>`;
}

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
function showModal(title, message, confirmLabel = "Confirm", cancelLabel = "Cancel") {
    return new Promise((resolve) => {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = confirmLabel;
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) {
            cancelBtn.textContent = cancelLabel;
            cancelBtn.disabled = false;
            cancelBtn.classList.remove("hidden");
        }
        if (extra) extra.innerHTML = "";
        if (altBtn) {
            altBtn.classList.add("hidden");
            altBtn.onclick = null;
            altBtn.textContent = "Alternate";
        }

        if (overlay) overlay.classList.remove("hidden");

        function cleanup(result) {
            if (overlay) overlay.classList.add("hidden");
            if (extra) extra.innerHTML = "";
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (altBtn) {
                altBtn.onclick = null;
                altBtn.classList.add("hidden");
                altBtn.textContent = "Alternate";
            }
            if (backdrop) backdrop.onclick = null;
            resolve(result);
        }

        if (confirmBtn) confirmBtn.onclick = () => cleanup(true);
        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        if (backdrop) backdrop.onclick = () => cleanup(false);
    });
}

function showChoiceModal(title, message, options = {}) {
    return new Promise((resolve) => {
        const overlay = byId("modalOverlay");
        const titleEl = byId("modalTitle");
        const msgEl = byId("modalMessage");
        const extra = byId("modalExtra");
        const confirmBtn = byId("modalConfirm");
        const cancelBtn = byId("modalCancel");
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = options.confirmLabel || "Confirm";
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) {
            cancelBtn.textContent = options.cancelLabel || "Cancel";
            cancelBtn.disabled = false;
            cancelBtn.classList.remove("hidden");
        }
        if (altBtn) {
            altBtn.textContent = options.alternateLabel || "Alternate";
            altBtn.classList.remove("hidden");
        }
        if (extra) {
            extra.innerHTML = options.detailHtml || "";
        }

        if (overlay) overlay.classList.remove("hidden");

        const handleKeyDown = (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                cleanup("confirm");
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                cleanup("cancel");
            }
        };

        function cleanup(result) {
            if (overlay) overlay.classList.add("hidden");
            if (extra) extra.innerHTML = "";
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (altBtn) {
                altBtn.onclick = null;
                altBtn.classList.add("hidden");
                altBtn.textContent = "Alternate";
            }
            if (backdrop) backdrop.onclick = null;
            document.removeEventListener("keydown", handleKeyDown, true);
            resolve(result);
        }

        if (confirmBtn) confirmBtn.onclick = () => cleanup("confirm");
        if (cancelBtn) cancelBtn.onclick = () => cleanup("cancel");
        if (altBtn) altBtn.onclick = () => cleanup("alternate");
        if (backdrop) backdrop.onclick = () => cleanup("cancel");
        document.addEventListener("keydown", handleKeyDown, true);
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
        const altBtn = byId("modalAlt");
        const backdrop = byId("modalBackdrop");

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (confirmBtn) confirmBtn.textContent = "OK";
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) {
            cancelBtn.textContent = "Cancel";
            cancelBtn.disabled = false;
            cancelBtn.classList.remove("hidden");
        }
        if (altBtn) {
            altBtn.classList.add("hidden");
            altBtn.onclick = null;
            altBtn.textContent = "Alternate";
        }

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
            if (altBtn) {
                altBtn.onclick = null;
                altBtn.classList.add("hidden");
                altBtn.textContent = "Alternate";
            }
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
    messageEl.textContent = `${state.modsPathMigration.currentPhase || "Working"} • ${getModsPathMigrationPercentLabel()}`;
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

function dismissDownloadFailureNotice() {
    const latestFailureKey = String(state.downloadFailureNotice.latestFailureKey || "").trim();
    if (latestFailureKey) {
        state.downloadFailureNotice.dismissedFailureKey = latestFailureKey;
    }
    renderDownloadFailureNotice();
}

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
function syncLaunchGameAvailability() {
    const btn = byId("launchGameBtn");
    const text = byId("launchGameText");
    if (!btn || !text) {
        return;
    }

    const iconHolder = btn.querySelector(".nav-icon[data-icon]");
    if (state.modsPathMigration.active) {
        btn.disabled = true;
        btn.title = "Wait for the mods folder change to finish before launching Stellaris.";
        text.textContent = "Moving Mods...";
        setDataIcon(iconHolder, "queue");
        return;
    }

    btn.disabled = false;
    btn.title = "";
    if (state.gameRunning) {
        text.textContent = "Restart Game";
        setDataIcon(iconHolder, "restart");
        return;
    }

    text.textContent = "Launch Game";
    setDataIcon(iconHolder, "launch");
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
        // ignore
    }
}

async function refreshGameRunningStatus() {
    try {
        state.gameRunning = await window.spikeApi.getGameRunningStatus();
        syncLaunchGameAvailability();
    } catch {
        // ignore
    }
}

async function handleLaunchGame() {
    if (state.modsPathMigration.active) {
        const message = state.modsPathMigration.lastMessage
            || "Wait for the mods folder change to finish before launching Stellaris.";
        setGlobalStatus(message);
        return;
    }

    if (state.gameRunning && state.settingsModel?.warnBeforeRestartGame !== false) {
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

function queueProgressMode(item) {
    return String(item?.progressMode || "").toLowerCase() === "indeterminate" ? "indeterminate" : "determinate";
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
        if (/Preparing .*staged files|Committing .*staged files|Downloading from Steam\.\.\.|installed data/i.test(rawMessage)) {
            return rawMessage;
        }
        if (/steamworks unavailable|steam not running/i.test(rawMessage) || /steamcmd|SteamCMD/i.test(rawMessage)) {
            if (/preparing|preparing batch/i.test(rawMessage)) return "Starting download via SteamCMD...";
            if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
            if (/deploying|installed to (?:mods path|managed mods folder)/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
            if (/batch/i.test(rawMessage)) return "Downloading via SteamCMD batch...";
            return "Downloading via SteamCMD...";
        }
        if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
        if (/deploying|installed to (?:mods path|managed mods folder)/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
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

    if (/installed to (?:mods path|managed mods folder)/i.test(raw)) {
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
        lastProgressMode: "determinate",
        lastMessage: "",
        layoutAnimation: null
    };
}

function updateQueueRow(view, item) {
    const status = String(item.status || "queued").toLowerCase();
    const progress = queueClampProgress(item.progress);
    const progressMode = queueProgressMode(item);
    const isIndeterminate = status === "running" && progressMode === "indeterminate";
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
        gamePath: "", launchOptions: "", modsPath: "", managedModsPath: "", steamCmdPath: "", steamCmdDownloadPath: "",
        workshopDownloadRuntime: "Auto",
        steamworksMaxConcurrentDownloads: DEFAULT_STEAMWORKS_CONCURRENCY,
        steamCmdMaxConcurrentDownloads: DEFAULT_STEAMCMD_CONCURRENCY,
        lastDetectedGameVersion: "",
        autoDetectGame: true, developerMode: false, warnBeforeRestartGame: true,
        themePalette: "Obsidian Ember", autoCheckAppUpdates: true,
        compatibilityReporterId: "", lastAppUpdateCheckUtc: "",
        lastOfferedAppVersion: "", skippedAppVersion: "", publicProfileUsername: "",
        hideDisabledMods: false
    };
}

function normalizeSettingsPathKey(value) {
    const normalized = String(value || "")
        .trim()
        .replace(/[\\/]+/g, "/")
        .replace(/\/+$/, "");
    if (!normalized) {
        return "";
    }

    return navigator.platform.toLowerCase().includes("win")
        ? normalized.toLowerCase()
        : normalized;
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
function clampSettingsConcurrency(value, fallback) {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(SETTINGS_DOWNLOAD_CONCURRENCY_MAX, Math.max(SETTINGS_DOWNLOAD_CONCURRENCY_MIN, parsed));
}
function getConcurrencyInputValue(id, fallback) {
    return clampSettingsConcurrency(getInputValue(id), fallback);
}

function markSettingsDirty(isDirty) {
    state.settingsDirty = isDirty;
    const chip = byId("settingsUnsavedChip");
    if (chip) chip.classList.toggle("hidden", !isDirty);
}

function buildSettingsFromForm() {
    return {
        gamePath: getInputValue("settingsGamePathInput"),
        launchOptions: getInputValue("settingsLaunchOptionsInput"),
        modsPath: getInputValue("settingsModsPathInput"),
        managedModsPath: getInputValue("settingsManagedModsPathInput"),
        steamCmdPath: getInputValue("settingsSteamCmdPathInput"),
        steamCmdDownloadPath: getInputValue("settingsSteamCmdDownloadPathInput"),
        workshopDownloadRuntime: getInputValue("settingsWorkshopRuntimeInput") || "Auto",
        steamworksMaxConcurrentDownloads: getConcurrencyInputValue(
            "settingsSteamworksConcurrencyInput",
            state.settingsModel?.steamworksMaxConcurrentDownloads ?? DEFAULT_STEAMWORKS_CONCURRENCY
        ),
        steamCmdMaxConcurrentDownloads: getConcurrencyInputValue(
            "settingsSteamCmdConcurrencyInput",
            state.settingsModel?.steamCmdMaxConcurrentDownloads ?? DEFAULT_STEAMCMD_CONCURRENCY
        ),
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

    if (normalizedRuntime === "SteamCMD") {
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
    setInputValue("settingsLaunchOptionsInput", m.launchOptions);
    setInputValue("settingsModsPathInput", m.modsPath);
    setInputValue("settingsManagedModsPathInput", m.managedModsPath);
    setInputValue("settingsSteamCmdPathInput", m.steamCmdPath);
    setInputValue("settingsSteamCmdDownloadPathInput", m.steamCmdDownloadPath);
    setInputValue("settingsThemeInput", m.themePalette || "Obsidian Ember");
    setInputValue("settingsWorkshopRuntimeInput", m.workshopDownloadRuntime || "Auto");
    setInputValue(
        "settingsSteamworksConcurrencyInput",
        clampSettingsConcurrency(m.steamworksMaxConcurrentDownloads, DEFAULT_STEAMWORKS_CONCURRENCY)
    );
    setInputValue(
        "settingsSteamCmdConcurrencyInput",
        clampSettingsConcurrency(m.steamCmdMaxConcurrentDownloads, DEFAULT_STEAMCMD_CONCURRENCY)
    );

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

    try {
        if (didModsPathChange(current)) {
            const choice = await promptForModsPathMigration(current);
            if (choice === "cancel") {
                setSettingsStatus("Managed mods folder change cancelled.");
                return false;
            }

            return beginModsPathMigrationSave(current, choice === "confirm");
        }

        const result = await window.spikeApi.saveSettings(current);
        if (!result.ok) {
            setSettingsStatus(result.message);
            return false;
        }

        applySettingsToForm(result.settings);
        setSettingsStatus(result.message);
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown settings save error";
        setSettingsStatus(`Failed to save settings: ${message}`);
        return false;
    }
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
        setSettingsStatus("Could not detect the Stellaris descriptor folder.");
        return;
    }

    setInputValue("settingsModsPathInput", detectedModsPath);
    if (!getInputValue("settingsManagedModsPathInput")) {
        setInputValue("settingsManagedModsPathInput", detectedModsPath);
    }
    markSettingsDirty(true);
    setSettingsStatus(`Detected descriptor folder: ${detectedModsPath}`);
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
    const button = byId("settingsAutoConfigureSteamCmd");
    if (button) {
        button.disabled = true;
    }

    setSettingsStatus("Configuring SteamCMD. This may download and extract the runtime...");

    try {
        const result = await window.spikeApi.autoConfigureSteamCmd(buildSettingsFromForm());
        const detectedSteamCmdPath = String(result?.settings?.steamCmdPath || "").trim();
        const detectedSteamCmdDownloadPath = String(result?.settings?.steamCmdDownloadPath || "").trim();

        if (!result?.ok || !detectedSteamCmdPath || !detectedSteamCmdDownloadPath) {
            setSettingsStatus(String(result?.message || "Could not auto-configure SteamCMD."));
            return;
        }

        if (detectedSteamCmdPath) setInputValue("settingsSteamCmdPathInput", detectedSteamCmdPath);
        if (detectedSteamCmdDownloadPath) setInputValue("settingsSteamCmdDownloadPathInput", detectedSteamCmdDownloadPath);

        const detectedRuntime = String(result?.settings?.workshopDownloadRuntime || "").trim();
        if (detectedRuntime) setInputValue("settingsWorkshopRuntimeInput", detectedRuntime);

        syncSettingsRuntimeVisibility();
        markSettingsDirty(true);
        setSettingsStatus(String(result?.message || "SteamCMD auto-configuration applied. Review and save settings."));
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
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
    setText("libraryDetailWorkshopId", mod.workshopId || "—");
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
    if (!snapshot || !select) return;

    select.innerHTML = snapshot.profiles
        .map((p) => `<option value="${p.id}" ${p.id === snapshot.activeProfileId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
        .join("");

    const active = getActiveLibraryProfile();
    const currentSharedId = (active?.sharedProfileId || "").trim();
    if (sharedValue) {
        sharedValue.textContent = currentSharedId || "No shared profile ID set";
        sharedValue.classList.toggle("is-empty", !currentSharedId);
        if (currentSharedId) {
            sharedValue.title = currentSharedId;
        } else {
            sharedValue.title = "No shared profile ID set";
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
    if (updateButton) {
        updateButton.disabled = !active;
        updateButton.title = currentSharedId
            ? "Send this profile's current enabled mods and load order to Stellarisync"
            : "Publish this profile to Stellarisync and create a shared profile ID";
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

function normalizeWorkshopNavigationUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return null;

    try {
        const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

function shouldStayInWorkshopWebview(url) {
    const safeUrl = normalizeWorkshopNavigationUrl(url);
    if (!safeUrl) return false;

    try {
        const parsed = new URL(safeUrl);
        return parsed.hostname === "steamcommunity.com" || parsed.hostname === "store.steampowered.com";
    } catch {
        return false;
    }
}

function navigateWorkshopUrl(url, webview) {
    const safeUrl = normalizeWorkshopNavigationUrl(url);
    if (!safeUrl) return;

    if (shouldStayInWorkshopWebview(safeUrl)) {
        webview.loadURL(safeUrl);
    } else {
        void window.spikeApi.openExternalUrl(safeUrl);
    }
}

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
        e.preventDefault();
        navigateWorkshopUrl(e.url, webview);
    });

    webview.addEventListener("ipc-message", async (e) => {
        if (e.channel === "smm-open-url") {
            navigateWorkshopUrl(e.args?.[0], webview);
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
        navigateWorkshopUrl(urlInput?.value, webview);
    });

    if (urlInput) {
        urlInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                navigateWorkshopUrl(urlInput.value, webview);
            }
        });
    }
}

/* ============================================================
   MERGER
   ============================================================ */
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
        if (filePlan.fileType === "script" || filePlan.fileType === "event") {
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

    const buildBtn = byId("mergerBuildBtn");
    if (buildBtn) buildBtn.disabled = !hasPlan || isBusy;
    const analyzeBtn = byId("mergerAnalyzeBtn");
    if (analyzeBtn) analyzeBtn.disabled = isBusy;
    const openBtn = byId("mergerOpenOutputBtn");
    if (openBtn) openBtn.disabled = !hasOutputPath || isBusy;
    const exportBtn = byId("mergerExportReportBtn");
    if (exportBtn) exportBtn.disabled = !hasPlan || isBusy;
}

function renderMergerSummary() {
    const plan = state.merger.plan;
    const summary = getMergerSummary();
    setMergerMetric("mergerMetricEnabledMods", summary.enabledModCount);
    setMergerMetric("mergerMetricFilesScanned", summary.scannedFileCount);
    setMergerMetric("mergerMetricFileConflicts", summary.conflictingFileCount);
    setMergerMetric("mergerMetricScriptConflicts", summary.scriptConflictCount);
    setMergerMetric("mergerMetricLocalisationConflicts", summary.localisationConflictCount);
    setMergerMetric("mergerMetricAssetConflicts", summary.assetConflictCount);
    setMergerMetric("mergerMetricAutoResolved", summary.autoResolvedCount);
    setMergerMetric("mergerMetricUnresolved", summary.unresolvedCount);

    const profileLabel = plan?.profileName ? `Profile: ${plan.profileName}` : "Profile: --";
    const enabledModsLabel = `Enabled mods: ${formatInteger(summary.enabledModCount)}`;
    const analysisLabel = plan?.createdAtUtc ? `Last analysis: ${formatUtc(plan.createdAtUtc)}` : "Last analysis: Never";
    setText("mergerProfileChip", profileLabel);
    setText("mergerEnabledChip", enabledModsLabel);
    setText("mergerAnalysisChip", analysisLabel);
    setText("mergerLastOutputPath", state.merger.lastBuildOutputPath || plan?.outputModPath || "Not built yet.");

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
                            <span class="muted">${escapeHtml(formatMergerFileType(filePlan.fileType))} • ${formatInteger((filePlan.entries || []).length)} mods</span>
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
                <p class="muted">Strategy: ${escapeHtml(filePlan.strategy)}</p>
                <div class="merger-detail-actions">
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
            <p class="settings-key">Warnings</p>
            <p class="muted">This milestone keeps full-file winners deterministic. Script-object merging and manual text editing come later.</p>
        </div>
    `;

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

function renderMergerPage() {
    renderMergerSummary();
    renderMergerConflictTree();
    renderMergerDetailPanel();
}

async function refreshMergerPlan() {
    try {
        const plan = await window.spikeApi.modMergerGetPlan();
        state.merger.plan = plan;
        state.merger.summary = buildMergerSummaryFromPlan(plan);
        ensureMergerSelection();
        renderMergerPage();
    } catch {
        state.merger.plan = null;
        state.merger.summary = buildMergerSummaryFromPlan(null);
        renderMergerPage();
    }
}

async function runMergerAnalysis() {
    beginMergerProgress("analyze", "Analyzing enabled mods...");
    setMergerStatus("Analyzing enabled mods...");
    try {
        const result = await window.spikeApi.modMergerAnalyze();
        await refreshMergerProgressStatus();
        state.merger.plan = result.plan;
        state.merger.summary = result.summary;
        state.merger.selectedVirtualPath = null;
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
    byId("mergerBuildBtn")?.addEventListener("click", () => void runMergerBuild());
    byId("mergerOpenOutputBtn")?.addEventListener("click", () => void openMergerOutputFolder());
    byId("mergerExportReportBtn")?.addEventListener("click", () => void runMergerExportReport());
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
        "settingsPublicProfileInput", "settingsGamePathInput", "settingsLaunchOptionsInput",
        "settingsModsPathInput", "settingsManagedModsPathInput",
        "settingsSteamCmdPathInput", "settingsSteamCmdDownloadPathInput",
        "settingsWorkshopRuntimeInput", "settingsSteamworksConcurrencyInput",
        "settingsSteamCmdConcurrencyInput", "settingsThemeInput"
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

    byId("settingsModsPathBrowse")?.addEventListener("click", async () => {
        const selectedPath = await window.spikeApi.pickDirectory({
            title: "Select Stellaris mods folder",
            defaultPath: getInputValue("settingsModsPathInput")
        });

        if (!selectedPath) {
            return;
        }

        setInputValue("settingsModsPathInput", selectedPath);
        markSettingsDirty(true);
    });

    byId("settingsManagedModsPathBrowse")?.addEventListener("click", async () => {
        const selectedPath = await window.spikeApi.pickDirectory({
            title: "Select managed mods folder",
            defaultPath: getInputValue("settingsManagedModsPathInput")
        });

        if (!selectedPath) {
            return;
        }

        setInputValue("settingsManagedModsPathInput", selectedPath);
        markSettingsDirty(true);
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

/* ============================================================
   APP UPDATES
   ============================================================ */
state.appUpdate = { latestRelease: null, message: "Not checked yet.", busy: false };

function getAppUpdateView() {
    const latestRelease = state.appUpdate.latestRelease || null;
    const skippedVersion = state.settingsModel?.skippedAppVersion || "";
    const helper = appUpdateState.getVisibleAppUpdateState;
    if (typeof helper === "function") {
        return helper(latestRelease, skippedVersion);
    }

    return {
        bannerRelease: latestRelease && latestRelease.version !== skippedVersion ? latestRelease : null,
        settingsRelease: latestRelease,
        isSkipped: !!(latestRelease && latestRelease.version === skippedVersion)
    };
}

async function checkForAppUpdates(source = "auto") {
    if (state.appUpdate.busy) return;
    state.appUpdate.busy = true;
    const statusEl = byId("settingsUpdateStatus");
    if (source === "manual" && statusEl) statusEl.textContent = "Checking for updates…";
    try {
        const result = await window.spikeApi.checkAppUpdate();
        state.appUpdate.message = result.message;
        state.appUpdate.latestRelease = result.hasUpdate ? result.release : null;
    } catch (err) {
        state.appUpdate.latestRelease = null;
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
    const { bannerRelease: release } = getAppUpdateView();
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
    const { settingsRelease: release, isSkipped } = getAppUpdateView();
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
    const skipBtn = byId("settingsSkipVersionBtn");
    if (skipBtn) skipBtn.classList.toggle("hidden", isSkipped);
}

async function launchAppUpdateFlow() {
    const { settingsRelease: release } = getAppUpdateView();
    if (!release) return;
    const result = await window.spikeApi.startAppUpdate(release);
    if (!result?.ok) {
        state.appUpdate.message = result?.message || "Could not start updater.";
        renderSettingsAppUpdate();
    }
    // On success the main process quits this app; no further UI work.
}

async function skipCurrentAppVersion() {
    const { settingsRelease: release } = getAppUpdateView();
    if (!release) return;
    await window.spikeApi.skipAppVersion(release.version);
    if (state.settingsModel) state.settingsModel.skippedAppVersion = release.version;
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
        const { settingsRelease: release } = getAppUpdateView();
        const url = release?.releaseUrl;
        if (url) void window.spikeApi.openExternalUrl(url);
    });
}

function hookGlobalControls() {
    byId("tabVersion")?.addEventListener("click", () => void activateTabGuarded("version"));
    byId("tabDownloads")?.addEventListener("click", () => void activateTabGuarded("downloads"));
    byId("tabLibrary")?.addEventListener("click", () => void activateTabGuarded("library"));
    byId("tabMerger")?.addEventListener("click", () => void activateTabGuarded("merger"));
    byId("tabWorkshop")?.addEventListener("click", () => {
        state.workshopReturnContext = null;
        void activateTabGuarded("workshop");
    });
    byId("tabSettings")?.addEventListener("click", () => void activateTabGuarded("settings"));
    byId("launchGameBtn")?.addEventListener("click", () => void handleLaunchGame());
    byId("queueCancelAll")?.addEventListener("click", () => void cancelAllQueueActions());
    byId("queueClearFinished")?.addEventListener("click", () => void clearQueueHistory());
    const reopenModsPathMigrationProgress = () => {
        if (!state.modsPathMigration.active) {
            return;
        }

        showModsPathMigrationProgressModal();
    };
    byId("modsPathMigrationNotice")?.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("button")) {
            return;
        }

        reopenModsPathMigrationProgress();
    });
    byId("modsPathMigrationNoticeOpen")?.addEventListener("click", () => reopenModsPathMigrationProgress());
    const reopenMergerProgress = () => {
        if (!state.merger.progress.active) {
            return;
        }

        showMergerProgressModal();
    };
    byId("mergerProgressNotice")?.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("button")) {
            return;
        }

        reopenMergerProgress();
    });
    byId("mergerProgressNoticeOpen")?.addEventListener("click", () => reopenMergerProgress());
    const openDownloadsFromFailureNotice = async () => {
        const opened = await activateTabGuarded("downloads");
        if (opened) {
            dismissDownloadFailureNotice();
        }
    };
    byId("downloadFailureNotice")?.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("button")) {
            return;
        }

        void openDownloadsFromFailureNotice();
    });
    byId("downloadFailureNoticeOpen")?.addEventListener("click", () => void openDownloadsFromFailureNotice());

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
                if (state.modsPathMigration.modalVisible) {
                    return;
                }
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
    hookCustomTooltips();
    hookVersionControls();
    hookSettingsControls();
    hookLibraryControls();
    hookMergerControls();
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
        refreshMergerPlan(),
        refreshMergerProgressStatus(),
        refreshQueueSnapshot(),
        refreshStellarisyncStatus(),
        refreshModsPathMigrationStatus(),
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
    state.gamePollingHandle = setInterval(() => {
        void refreshGameRunningStatus();
        void refreshModsPathMigrationStatus();
    }, 3000);

    if (state.stellarisyncPollingHandle) clearInterval(state.stellarisyncPollingHandle);
    state.stellarisyncPollingHandle = setInterval(() => void refreshStellarisyncStatus(), 120000);

    if (state.settingsModel?.autoCheckAppUpdates !== false) {
        void checkForAppUpdates("auto");
    }
}

void init();
