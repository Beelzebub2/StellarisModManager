import { byId } from "../runtime/dom.js";
import { state } from "../runtime/state.js";

export function createVersionControlsController({
    hookVersionCardDelegation,
    refreshVersionOptions,
    refreshVersionResults,
    syncSearchClearButton
}) {
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
        byId("pagePrev")?.addEventListener("click", () => {
            if (state.page > 1) {
                state.page -= 1;
                void refreshVersionResults();
            }
        });
        byId("pageNext")?.addEventListener("click", () => {
            if (state.page < state.totalPages) {
                state.page += 1;
                void refreshVersionResults();
            }
        });
    }

    return { hookVersionControls };
}
