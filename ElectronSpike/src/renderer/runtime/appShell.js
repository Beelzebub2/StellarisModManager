import { byId } from "./dom.js";

export async function applyAppIcon() {
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
        // Keep fallback initials if icon loading fails.
    }
}
