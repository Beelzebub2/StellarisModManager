import { byId, escapeHtml } from "./dom.js";
import { state } from "./state.js";

const VERSION_SKELETON_DELAY_MS = 220;
const VERSION_SKELETON_CARD_COUNT = 6;

export function formatVersionBadgeValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    return /^v/i.test(raw) ? raw : `v${raw}`;
}

export function setLoadingState(isLoading) {
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

export function syncSearchClearButton() {
    const btn = byId("searchClear");
    if (btn) btn.disabled = !state.searchText;
}

export function clearVersionLoadingDelay() {
    if (state.versionLoadingDelayHandle !== null) {
        clearTimeout(state.versionLoadingDelayHandle);
        state.versionLoadingDelayHandle = null;
    }
}

export function resetVersionCardsLoadingState(container = byId("versionCards")) {
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

export function renderVersionLoadingSkeletons() {
    const container = byId("versionCards");
    if (!container) return;

    state.activeCards = [];
    state.versionSkeletonVisible = true;
    container.classList.add("is-loading-skeleton");
    container.setAttribute("aria-busy", "true");
    container.innerHTML = buildVersionSkeletonCards();
}

export function scheduleVersionLoadingSkeleton(requestSeq) {
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

export function renderVersionFeedbackCard(title, message) {
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
