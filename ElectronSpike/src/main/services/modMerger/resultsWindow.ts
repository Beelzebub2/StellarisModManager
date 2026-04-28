import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import type { ModMergerOpenResultsResult } from "../../../shared/types";
import { buildMainWindowWebPreferences } from "../../security";
import { loadSettingsSnapshot } from "../settings";
import { getTitleBarOverlayOptionsForTheme } from "../../windowChrome";

let resultsWindow: BrowserWindow | null = null;

function getRendererEntryPath(): string {
    const candidates = [
        path.join(app.getAppPath(), "src", "renderer", "index.html"),
        path.join(app.getAppPath(), "dist", "renderer", "index.html"),
        path.join(__dirname, "..", "..", "..", "renderer", "index.html")
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
