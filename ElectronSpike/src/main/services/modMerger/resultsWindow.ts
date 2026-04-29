import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import type { ModMergerOpenResultsResult } from "../../../shared/types";
import { buildMainWindowWebPreferences } from "../../security";
import { loadSettingsSnapshot } from "../settings";
import { getTitleBarOverlayOptionsForTheme } from "../../windowChrome";
import { logError, logInfo } from "../logger";

let resultsWindow: BrowserWindow | null = null;

function getRendererEntryPath(): string {
    const candidates = [
        path.join(app.getAppPath(), "dist", "renderer", "index.html"),
        path.join(__dirname, "..", "..", "..", "renderer", "index.html"),
        path.join(app.getAppPath(), "src", "renderer", "index.html")
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export async function openModMergerResultsWindow(): Promise<ModMergerOpenResultsResult> {
    if (resultsWindow && !resultsWindow.isDestroyed()) {
        if (resultsWindow.isMinimized()) {
            resultsWindow.restore();
        }
        resultsWindow.focus();
        return {
            ok: true,
            message: "Focused merger results."
        };
    }

    const entryPath = getRendererEntryPath();
    if (!fs.existsSync(entryPath)) {
        return {
            ok: false,
            message: `Renderer entry file does not exist: ${entryPath}`
        };
    }

    const settings = loadSettingsSnapshot();
    resultsWindow = new BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 900,
        minHeight: 560,
        title: "Merger Results",
        titleBarStyle: "hidden",
        titleBarOverlay: getTitleBarOverlayOptionsForTheme(settings?.themePalette),
        webPreferences: buildMainWindowWebPreferences(path.join(__dirname, "..", "..", "..", "preload.js"))
    });

    resultsWindow.on("closed", () => {
        resultsWindow = null;
    });

    resultsWindow.webContents.on("console-message", (event, ...legacyArgs: unknown[]) => {
        const payload = event as {
            level?: unknown;
            message?: unknown;
            line?: unknown;
            lineNumber?: unknown;
            sourceId?: unknown;
        };
        const level = typeof payload.level === "number"
            ? payload.level
            : Number(legacyArgs[0] ?? 0);
        const message = typeof payload.message === "string"
            ? payload.message
            : String(legacyArgs[1] ?? "");
        const line = typeof payload.lineNumber === "number"
            ? payload.lineNumber
            : (typeof payload.line === "number" ? payload.line : Number(legacyArgs[2] ?? 0));
        const sourceId = typeof payload.sourceId === "string"
            ? payload.sourceId
            : String(legacyArgs[3] ?? "unknown");

        const logMessage = `[MergerResultsRenderer] ${message} (line ${line} at ${sourceId})`;
        if (level >= 2) {
            logError(logMessage);
        } else {
            logInfo(logMessage);
        }
    });

    logInfo(`Loading merger results renderer from ${entryPath}`);
    await resultsWindow.loadFile(entryPath, {
        query: {
            view: "merger-results"
        }
    });
    resultsWindow.focus();

    return {
        ok: true,
        message: "Opened merger results."
    };
}
