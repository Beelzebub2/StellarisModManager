export function byId(id) {
    return document.getElementById(id);
}

export function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
}

export function printJson(id, value) {
    const el = byId(id);
    if (el) el.textContent = JSON.stringify(value, null, 2);
}

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function toDisplayValue(value, fallback = "Not set") {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || fallback;
    }
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
    return fallback;
}

export function formatUtc(value) {
    if (!value || typeof value !== "string") return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function formatHumanDateTime(value, fallback = "Never") {
    if (!value || typeof value !== "string") return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(date);
}

export function formatInteger(value) {
    return Number(value || 0).toLocaleString();
}
