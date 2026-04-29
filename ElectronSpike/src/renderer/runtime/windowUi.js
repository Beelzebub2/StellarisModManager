import { byId } from "./dom.js";

const TOOLTIP_SHOW_DELAY_MS = 90;
const TOOLTIP_OFFSET_PX = 14;

const tooltipState = {
    activeTarget: null,
    pendingTarget: null,
    showTimer: null,
    observer: null
};

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
            root.dataset.tooltip = title;
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

        el.dataset.tooltip = title;

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

export function hookCustomTooltips() {
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

export function applyViewportMetrics() {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty("--app-vw", `${window.innerWidth}px`);
    root.style.setProperty("--app-vh", `${window.innerHeight}px`);
}

export function hookWindowResizeResponsiveness() {
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
