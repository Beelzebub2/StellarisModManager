import { ipcRenderer } from "electron";

window.addEventListener("DOMContentLoaded", () => {
    function toHttpUrl(raw: string): string | null {
        try {
            const parsed = new URL(raw, window.location.href);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                return parsed.toString();
            }
        } catch {
            // ignore parse errors
        }

        return null;
    }

    function forwardOpenRequest(raw: string | null | undefined): void {
        const safeUrl = toHttpUrl((raw ?? "").trim());
        if (!safeUrl) {
            return;
        }

        ipcRenderer.sendToHost("smm-open-url", safeUrl);
    }

    // Preserve link behavior without allowpopups by forwarding target=_blank clicks.
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) {
            return;
        }

        if (anchor.target !== "_blank") {
            return;
        }

        const href = anchor.getAttribute("href") ?? "";
        const safeUrl = toHttpUrl(href);
        if (!safeUrl) {
            return;
        }

        event.preventDefault();
        ipcRenderer.sendToHost("smm-open-url", safeUrl);
    }, true);

    // Replace popup requests with host-routed navigation.
    window.open = ((url?: string | URL) => {
        const raw = typeof url === "string" ? url : url?.toString();
        forwardOpenRequest(raw);
        return null;
    }) as typeof window.open;

    type OverlayActionState = "not-installed" | "queued" | "installing" | "installed" | "uninstalling" | "error";

    const OVERLAY_LABELS: Record<OverlayActionState, string> = {
        "not-installed": "Add to SMM",
        queued: "Queued...",
        installing: "Installing...",
        installed: "Uninstall",
        uninstalling: "Removing...",
        error: "Retry install"
    };

    const OVERLAY_ICONS: Record<OverlayActionState, string> = {
        "not-installed": "+",
        queued: "•",
        installing: "↻",
        installed: "-",
        uninstalling: "↻",
        error: "!"
    };

    const WORKSHOP_ID_REGEX = /sharedfiles\/filedetails\/\?id=(\d+)/;
    const match = window.location.href.match(WORKSHOP_ID_REGEX);

    if (match && match[1]) {
        const workshopId = match[1];
        let currentState: OverlayActionState = "not-installed";

        function isOverlayActionState(value: string): value is OverlayActionState {
            return value === "not-installed"
                || value === "queued"
                || value === "installing"
                || value === "installed"
                || value === "uninstalling"
                || value === "error";
        }

        function isBusyState(state: OverlayActionState): boolean {
            return state === "queued" || state === "installing" || state === "uninstalling";
        }

        function actionIntentFromState(state: OverlayActionState): "install" | "uninstall" {
            return state === "installed" ? "uninstall" : "install";
        }

        function ensureOverlayStyles() {
            if (document.getElementById("smm-overlay-style")) {
                return;
            }

            const style = document.createElement("style");
            style.id = "smm-overlay-style";
            style.textContent = `
                #smm-overlay-btn {
                    display: inline-flex;
                    align-items: center;
                    margin: 0 0 0 8px;
                    vertical-align: middle;
                }
                #smm-overlay-btn.smm-overlay-inline {
                    align-self: center;
                    transform: translateY(1px);
                }
                #smm-overlay-btn.smm-overlay-block {
                    display: flex;
                    justify-content: flex-start;
                    margin: 10px 0 0 0;
                }
                #smm-overlay-btn .smm-button {
                    min-height: 30px;
                    min-width: 132px;
                    padding: 0 11px;
                    border-radius: 3px;
                    border: 1px solid #789922;
                    background: linear-gradient(180deg, #8bb70c 5%, #648b1b 95%);
                    color: #d2efa9;
                    font-size: 15px;
                    font-weight: 700;
                    line-height: 28px;
                    text-align: center;
                    cursor: pointer;
                    white-space: nowrap;
                    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
                }
                #smm-overlay-btn .smm-button-content {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    width: 100%;
                }
                #smm-overlay-btn .smm-button-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 12px;
                    min-width: 12px;
                    font-size: 13px;
                    line-height: 1;
                    font-weight: 800;
                    text-align: center;
                }
                #smm-overlay-btn .smm-button-text {
                    display: inline-block;
                    line-height: 1;
                }
                #smm-overlay-btn .smm-button:hover {
                    filter: brightness(1.06);
                }
                #smm-overlay-btn .smm-button[data-state="installed"] {
                    border-color: #9f4040;
                    background: linear-gradient(180deg, #b75454 5%, #944343 95%);
                    color: #ffdada;
                }
                #smm-overlay-btn .smm-button[data-state="queued"],
                #smm-overlay-btn .smm-button[data-state="installing"] {
                    border-color: #5f7ea1;
                    background: linear-gradient(180deg, #6f8fb1 5%, #58779a 95%);
                    color: #e5f0ff;
                }
                #smm-overlay-btn .smm-button[data-state="uninstalling"] {
                    border-color: #8e5a3a;
                    background: linear-gradient(180deg, #a66a44 5%, #865337 95%);
                    color: #ffe6d2;
                }
                #smm-overlay-btn .smm-button.is-error {
                    border-color: #c08a2f;
                    background: linear-gradient(180deg, #d29c3e 5%, #aa7a2f 95%);
                    color: #fff0c9;
                }
                #smm-overlay-btn .smm-button.is-busy {
                    opacity: 0.9;
                    cursor: progress;
                }
                #smm-overlay-btn .smm-button.is-busy .smm-button-icon {
                    animation: smm-busy-pulse 900ms ease-in-out infinite;
                }
                @keyframes smm-busy-pulse {
                    0%, 100% { opacity: 0.45; }
                    50% { opacity: 1; }
                }
            `;

            document.head.appendChild(style);
        }

        function resolveTargetContainer(): Element | null {
            return [
                document.querySelector(".subscribeControls"),
                document.querySelector(".game_area_purchase_game .game_purchase_action"),
                document.querySelector(".game_area_purchase_game"),
                document.querySelector(".game_area_purchase_margin"),
                document.querySelector(".workshopItemTitle")?.parentElement ?? null
            ].find((container) => container !== null) ?? null;
        }

        function getOverlayButton(): HTMLButtonElement | null {
            const button = document.querySelector("#smm-overlay-btn .smm-button");
            return button instanceof HTMLButtonElement ? button : null;
        }

        function renderOverlayState(nextState: OverlayActionState) {
            currentState = nextState;
            const button = getOverlayButton();
            if (!button) {
                return;
            }

            let iconEl = button.querySelector(".smm-button-icon");
            let labelEl = button.querySelector(".smm-button-text");

            if (!(iconEl instanceof HTMLElement) || !(labelEl instanceof HTMLElement)) {
                button.textContent = "";
                const content = document.createElement("span");
                content.className = "smm-button-content";

                iconEl = document.createElement("span");
                iconEl.className = "smm-button-icon";

                labelEl = document.createElement("span");
                labelEl.className = "smm-button-text";

                content.append(iconEl, labelEl);
                button.appendChild(content);
            }

            iconEl.textContent = OVERLAY_ICONS[nextState];
            labelEl.textContent = OVERLAY_LABELS[nextState];
            button.disabled = isBusyState(nextState);
            button.classList.toggle("is-installed", nextState === "installed");
            button.classList.toggle("is-error", nextState === "error");
            button.classList.toggle("is-busy", isBusyState(nextState));
            button.setAttribute("data-state", nextState);
            button.setAttribute("aria-label", OVERLAY_LABELS[nextState]);
            button.title = nextState === "installed"
                ? "Uninstall this mod from SMM Library"
                : "Install this mod in SMM Library";
        }

        function requestOverlayState() {
            ipcRenderer.sendToHost("smm-query-mod-state", workshopId);
        }

        function injectOverlay() {
            if (document.getElementById("smm-overlay-btn")) {
                renderOverlayState(currentState);
                return;
            }

            ensureOverlayStyles();
            const container = resolveTargetContainer();
            if (!container) {
                return;
            }

            const btnContainer = document.createElement("div");
            btnContainer.id = "smm-overlay-btn";
            if (container.classList.contains("subscribeControls") || container.classList.contains("game_purchase_action")) {
                btnContainer.classList.add("smm-overlay-inline");
            } else {
                btnContainer.classList.add("smm-overlay-block");
            }

            const button = document.createElement("button");
            button.type = "button";
            button.className = "smm-button";
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (isBusyState(currentState)) {
                    return;
                }

                const action = actionIntentFromState(currentState);
                renderOverlayState(action === "uninstall" ? "uninstalling" : "queued");
                ipcRenderer.sendToHost("smm-toggle-workshop-mod", {
                    workshopId,
                    action
                });
            });

            btnContainer.appendChild(button);
            container.appendChild(btnContainer);
            renderOverlayState(currentState);
        }

        ipcRenderer.on("smm-mod-state", (_event, payload: unknown) => {
            if (!payload || typeof payload !== "object") {
                return;
            }

            const { workshopId: payloadWorkshopId, actionState } = payload as {
                workshopId?: unknown;
                actionState?: unknown;
            };

            if (String(payloadWorkshopId ?? "") !== workshopId) {
                return;
            }

            const nextState = String(actionState ?? "");
            if (isOverlayActionState(nextState)) {
                renderOverlayState(nextState);
            }
        });

        injectOverlay();
        requestOverlayState();
        setTimeout(injectOverlay, 500);
        setTimeout(injectOverlay, 1500);

        const observer = new MutationObserver(() => {
            injectOverlay();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 20_000);

        const poll = window.setInterval(() => {
            requestOverlayState();
        }, 5000);
        window.setTimeout(() => window.clearInterval(poll), 90_000);
    }
});