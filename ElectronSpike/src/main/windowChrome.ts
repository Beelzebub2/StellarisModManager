import type { BrowserWindow } from "electron";

export const TITLE_BAR_OVERLAY_HEIGHT = 54;

interface TitleBarOverlayOptions {
    color: string;
    symbolColor: string;
    height: number;
}

const TITLE_BAR_OVERLAY_BY_THEME: Record<string, { color: string; symbolColor: string }> = {
    "Obsidian Ember": { color: "#111722", symbolColor: "#e2e8f0" },
    "Graphite Moss": { color: "#17201d", symbolColor: "#e8f2ea" },
    "Nocturne Slate": { color: "#141b2c", symbolColor: "#e8ecfb" },
    "Starlight White": { color: "#eef4fb", symbolColor: "#0f172a" },
    "Ivory White": { color: "#f7efe2", symbolColor: "#1f2937" },
    "Frost White": { color: "#edf5ff", symbolColor: "#0f172a" }
};

export function normalizeThemePaletteName(value: string | undefined): string {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "graphite moss") return "Graphite Moss";
    if (raw === "nocturne slate") return "Nocturne Slate";
    if (raw === "starlight white") return "Starlight White";
    if (raw === "ivory white") return "Ivory White";
    if (raw === "frost white") return "Frost White";
    return "Obsidian Ember";
}

export function getTitleBarOverlayOptionsForTheme(themePalette?: string): TitleBarOverlayOptions {
    const normalized = normalizeThemePaletteName(themePalette);
    const palette = TITLE_BAR_OVERLAY_BY_THEME[normalized] ?? TITLE_BAR_OVERLAY_BY_THEME["Obsidian Ember"];

    return {
        color: palette.color,
        symbolColor: palette.symbolColor,
        height: TITLE_BAR_OVERLAY_HEIGHT
    };
}

export function applyTitleBarOverlayForTheme(
    target: Pick<BrowserWindow, "setTitleBarOverlay" | "isDestroyed"> | null | undefined,
    themePalette?: string
): boolean {
    if (!target || (typeof target.isDestroyed === "function" && target.isDestroyed())) {
        return false;
    }

    target.setTitleBarOverlay(getTitleBarOverlayOptionsForTheme(themePalette));
    return true;
}
