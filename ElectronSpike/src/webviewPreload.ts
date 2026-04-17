import { ipcRenderer } from "electron";

window.addEventListener("DOMContentLoaded", () => {
    const WORKSHOP_ID_REGEX = /sharedfiles\/filedetails\/\?id=(\d+)/;
    const match = window.location.href.match(WORKSHOP_ID_REGEX);

    if (match && match[1]) {
        const workshopId = match[1];

        function ensureOverlayStyles() {
            if (document.getElementById("smm-overlay-style")) {
                return;
            }

            const style = document.createElement("style");
            style.id = "smm-overlay-style";
            style.textContent = `
                #smm-overlay-btn {
                    display: inline-flex;
                    margin-left: 8px;
                    vertical-align: middle;
                }
                #smm-overlay-btn.smm-overlay-block {
                    display: flex;
                    margin: 12px 0 0 0;
                }
                #smm-overlay-btn .smm-button {
                    cursor: pointer;
                    text-decoration: none;
                    white-space: nowrap;
                }
                #smm-overlay-btn .smm-button span {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
            `;

            document.head.appendChild(style);
        }

        function resolveTargetContainer(): Element | null {
            return [
                document.querySelector(".subscribeControls"),
                document.querySelector(".game_area_purchase_margin"),
                document.querySelector(".workshopItemTitle")?.parentElement ?? null
            ].find((container) => container !== null) ?? null;
        }

        function injectOverlay() {
            if (document.getElementById("smm-overlay-btn")) return;

            ensureOverlayStyles();
            const container = resolveTargetContainer();
            if (!container) return;

            const btnContainer = document.createElement("div");
            btnContainer.id = "smm-overlay-btn";
            if (!container.classList.contains("subscribeControls")) {
                btnContainer.classList.add("smm-overlay-block");
            }

            const btn = document.createElement("a");
            btn.className = "btn_green_white_innerfade btn_border_2px btn_medium smm-button";
            btn.innerHTML = "<span>Add to SMM Library</span>";

            btn.onclick = (e) => {
                e.preventDefault();
                btn.innerHTML = "<span>Added! Check Library</span>";
                ipcRenderer.sendToHost("smm-add-workshop-mod", workshopId);
                setTimeout(() => {
                    btn.innerHTML = "<span>Add to SMM Library</span>";
                }, 3000);
            };

            btnContainer.appendChild(btn);
            container.appendChild(btnContainer);
        }

        injectOverlay();
        setTimeout(injectOverlay, 1000);
        setTimeout(injectOverlay, 2500);

        const observer = new MutationObserver(() => {
            injectOverlay();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 15_000);
    }
});