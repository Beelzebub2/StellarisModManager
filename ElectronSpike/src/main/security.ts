import type { WebPreferences } from "electron";

const WORKSHOP_WEBVIEW_HOSTS = new Set([
    "steamcommunity.com",
    "store.steampowered.com"
]);

function normalizeSafeExternalUrl(rawUrl: string): string | null {
    const value = String(rawUrl ?? "").trim();
    if (!value) {
        return null;
    }

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

function shouldStayInWorkshopWebview(rawUrl: string): boolean {
    const safeUrl = normalizeSafeExternalUrl(rawUrl);
    if (!safeUrl) {
        return false;
    }

    try {
        const parsed = new URL(safeUrl);
        return WORKSHOP_WEBVIEW_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function buildMainWindowWebPreferences(preloadPath: string): WebPreferences {
    return {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: true
    };
}

function applyWebviewSecurity(webPreferences: WebPreferences, preloadPath: string): void {
    webPreferences.preload = preloadPath;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
}

export const buildMainWindowWebPreferencesForTest = buildMainWindowWebPreferences;
export const applyWebviewSecurityForTest = applyWebviewSecurity;
export const normalizeSafeExternalUrlForTest = normalizeSafeExternalUrl;
export const shouldStayInWorkshopWebviewForTest = shouldStayInWorkshopWebview;

export {
    applyWebviewSecurity,
    buildMainWindowWebPreferences,
    normalizeSafeExternalUrl,
    shouldStayInWorkshopWebview
};
