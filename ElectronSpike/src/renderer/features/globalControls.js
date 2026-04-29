import { byId } from "../runtime/dom.js";
import { state } from "../runtime/state.js";

export function createGlobalControlsController({
    activateTabGuarded,
    cancelAllQueueActions,
    clearQueueHistory,
    dismissDownloadFailureNotice,
    handleLaunchGame,
    handleWindowCloseWithUnsavedSettings,
    navigateTabHistoryBack,
    navigateTabHistoryForward,
    restoreVersionTabFromWorkshopContext,
    showDetailDrawer,
    showMergerProgressModal,
    showModsPathMigrationProgressModal
}) {
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
            if (state.windowCloseAllowed || !state.settingsDirty) {
                return;
            }
            e.preventDefault();
            e.returnValue = "";
            void handleWindowCloseWithUnsavedSettings();
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

    return { hookGlobalControls };
}
