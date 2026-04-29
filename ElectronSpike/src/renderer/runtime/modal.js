import { byId, escapeHtml } from "./dom.js";

const promptInputBehavior = globalThis.promptInputBehavior || {};

export function showModal(title, message, confirmLabel = "Confirm", cancelLabel = "Cancel") {
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

export function showChoiceModal(title, message, options = {}) {
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

export function showPrompt(title, message, defaultValue = "") {
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
