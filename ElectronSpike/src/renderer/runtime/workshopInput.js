export function normalizeWorkshopId(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (/^\d{6,}$/.test(raw)) return raw;

    const idParamMatch = raw.match(/[?&]id=(\d{6,})\b/i);
    if (idParamMatch) return idParamMatch[1];

    const fileDetailsMatch = raw.match(/sharedfiles\/filedetails\/?[^\s]*id=(\d{6,})\b/i);
    if (fileDetailsMatch) return fileDetailsMatch[1];

    const fallbackDigitsMatch = raw.match(/\b(\d{6,})\b/);
    return fallbackDigitsMatch ? fallbackDigitsMatch[1] : "";
}

export function isValidWorkshopId(value) {
    return /^\d{6,}$/.test(value);
}

export function parseSharedProfileSyncInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return { sharedProfileId: "", sharedProfileSince: "" };
    }

    const paramsSource = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
    const params = new URLSearchParams(paramsSource);
    const paramId = (params.get("id") || params.get("profileId") || "").trim();
    const paramSince = (params.get("since") || "").trim();

    if (paramId) {
        return {
            sharedProfileId: paramId,
            sharedProfileSince: paramSince
        };
    }

    const commaSeparated = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (commaSeparated.length >= 2) {
        return {
            sharedProfileId: commaSeparated[0],
            sharedProfileSince: commaSeparated.slice(1).join(",")
        };
    }

    return { sharedProfileId: raw, sharedProfileSince: "" };
}
