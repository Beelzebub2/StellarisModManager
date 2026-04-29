import { escapeHtml } from "./dom.js";

const THEME_PALETTE_TO_KEY = Object.freeze({
    "Obsidian Ember": "obsidian-ember",
    "Graphite Moss": "graphite-moss",
    "Nocturne Slate": "nocturne-slate",
    "Starlight White": "starlight-white",
    "Ivory White": "ivory-white",
    "Frost White": "frost-white"
});

const LIGHT_THEME_PALETTES = new Set([
    "Starlight White",
    "Ivory White",
    "Frost White"
]);

export function normalizeThemePaletteName(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "graphite moss") return "Graphite Moss";
    if (raw === "nocturne slate") return "Nocturne Slate";
    if (raw === "starlight white") return "Starlight White";
    if (raw === "ivory white") return "Ivory White";
    if (raw === "frost white") return "Frost White";
    return "Obsidian Ember";
}

export function buildThemePaletteOptionsMarkup(palettes) {
    const dark = [];
    const light = [];

    for (const palette of palettes || []) {
        const normalized = normalizeThemePaletteName(palette);
        if (LIGHT_THEME_PALETTES.has(normalized)) {
            light.push(normalized);
        } else {
            dark.push(normalized);
        }
    }

    const uniqueDark = [...new Set(dark)];
    const uniqueLight = [...new Set(light)];

    const renderOptions = (items) => items
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join("");

    const chunks = [];
    if (uniqueDark.length > 0) {
        chunks.push(`<optgroup label="Dark Themes">${renderOptions(uniqueDark)}</optgroup>`);
    }
    if (uniqueLight.length > 0) {
        chunks.push(`<optgroup label="White Themes">${renderOptions(uniqueLight)}</optgroup>`);
    }

    return chunks.join("");
}

export function applyThemePalette(paletteName) {
    const normalized = normalizeThemePaletteName(paletteName);
    const themeKey = THEME_PALETTE_TO_KEY[normalized] || THEME_PALETTE_TO_KEY["Obsidian Ember"];
    document.body.setAttribute("data-theme", themeKey);
    void window.spikeApi.setWindowChromeTheme(normalized).catch(() => {
        // Native titlebar overlay syncing is cosmetic; ignore failures.
    });
}
