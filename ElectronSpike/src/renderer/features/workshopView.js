import { byId } from "../runtime/dom.js";
import { state } from "../runtime/state.js";
import { setLibraryStatus } from "../runtime/status.js";
import {
    isValidWorkshopId,
    normalizeWorkshopId
} from "../runtime/workshopInput.js";

const WORKSHOP_HOME = "https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems&days=90";

export function createWorkshopController({
    activateTab,
    getModNameByWorkshopId,
    queueDownloadAction,
    refreshDetailDrawer,
    refreshLibrarySnapshot,
    refreshQueueSnapshot
}) {
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

    return {
        initWorkshop,
        restoreVersionTabFromWorkshopContext
    };
}
