export function normalizeVirtualPath(value: string): string {
    return String(value ?? "").replace(/\\/g, "/").trim().toLowerCase();
}

export function isLocalisationPath(virtualPath: string): boolean {
    const normalized = normalizeVirtualPath(virtualPath);
    return normalized.startsWith("localisation/") && normalized.endsWith(".yml");
}

export function isScriptObjectPath(virtualPath: string): boolean {
    const normalized = normalizeVirtualPath(virtualPath);
    return (
        (normalized.startsWith("common/") || normalized.startsWith("events/")) &&
        normalized.endsWith(".txt")
    );
}

export function isBlockedAutoPath(virtualPath: string): boolean {
    const normalized = normalizeVirtualPath(virtualPath);
    return normalized.startsWith("map/") || normalized.startsWith("sound/") || normalized.startsWith("interface/");
}
