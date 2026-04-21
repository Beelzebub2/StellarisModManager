import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./main/ipc";
import { logError, logInfo } from "./main/services/logger";
import { loadSettingsSnapshot } from "./main/services/settings";
import { getTitleBarOverlayOptionsForTheme } from "./main/windowChrome";

let mainWindow: BrowserWindow | null = null;

interface ElectronDataPaths {
    userDataRoot: string;
    sessionDataRoot: string;
    chromiumCacheRoot: string;
}

function getLocalAppDataRoot(): string {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) {
        return localAppData;
    }

    return path.join(app.getPath("temp"), "StellarisModManager", "LocalAppDataFallback");
}

function resolveAppWindowIconPath(): string | undefined {
    const candidates = [
        path.join(app.getAppPath(), "assets", "app.ico"),
        path.join(app.getAppPath(), "assets", "icon.png"),
        path.join(app.getAppPath(), "assets", "icon.jpg"),
        path.join(__dirname, "..", "assets", "app.ico"),
        path.join(__dirname, "..", "assets", "icon.png"),
        path.join(__dirname, "..", "assets", "icon.jpg"),
        path.join(process.resourcesPath, "assets", "app.ico"),
        path.join(process.resourcesPath, "assets", "icon.png"),
        path.join(process.resourcesPath, "assets", "icon.jpg")
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
}

function configureWritableElectronDataPaths(): ElectronDataPaths {
    const localRoot = path.join(getLocalAppDataRoot(), "StellarisModManager", "ElectronSpike");
    const userDataRoot = path.join(localRoot, "UserData");
    const sessionDataRoot = path.join(localRoot, "SessionData");
    const chromiumCacheRoot = path.join(sessionDataRoot, "ChromiumCache");

    fs.mkdirSync(userDataRoot, { recursive: true });
    fs.mkdirSync(sessionDataRoot, { recursive: true });
    fs.mkdirSync(chromiumCacheRoot, { recursive: true });

    app.setPath("userData", userDataRoot);
    app.setPath("sessionData", sessionDataRoot);

    // Keep cache writes in a known writable location and avoid shader disk-cache corruption churn.
    app.commandLine.appendSwitch("disk-cache-dir", chromiumCacheRoot);
    app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

    return { userDataRoot, sessionDataRoot, chromiumCacheRoot };
}

const electronDataPaths = configureWritableElectronDataPaths();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
    process.exit(0);
}

function getRendererEntryPath(): string {
    const candidates = [
        path.join(app.getAppPath(), "src", "renderer", "index.html"),
        path.join(app.getAppPath(), "dist", "renderer", "index.html"),
        path.join(__dirname, "renderer", "index.html")
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function createMainWindow(): void {
    const iconPath = resolveAppWindowIconPath();
    const settings = loadSettingsSnapshot();

    mainWindow = new BrowserWindow({
        width: 1360,
        height: 880,
        // Keep a practical floor, but allow responsive renderer breakpoints to engage.
        minWidth: 820,
        minHeight: 560,
        icon: iconPath,
        titleBarStyle: "hidden",
        titleBarOverlay: getTitleBarOverlayOptionsForTheme(settings?.themePalette),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webviewTag: true
        }
    });

    Menu.setApplicationMenu(null);

    const entryPath = getRendererEntryPath();
    if (iconPath) {
        logInfo(`Using app window icon: ${iconPath}`);
    } else {
        logError("No app window icon found; OS may show a generic icon.");
    }
    logInfo(`Loading renderer from ${entryPath}`);
    if (!fs.existsSync(entryPath)) {
        logError(`Renderer entry file does not exist: ${entryPath}`);
        void mainWindow.loadURL("data:text/html,<html><body style='font-family:Segoe UI,sans-serif;background:#0e1117;color:#e2e8f0;padding:24px'><h2>Renderer bootstrap failed</h2><p>index.html could not be found in the packaged app.</p></body></html>");
    } else {
        void mainWindow.loadFile(entryPath);
    }

    mainWindow.webContents.on("console-message", (event, ...legacyArgs: unknown[]) => {
        const payload = event as {
            message?: unknown;
            line?: unknown;
            lineNumber?: unknown;
            sourceId?: unknown;
        };

        // Electron is migrating console-message details from positional args to event payload fields.
        const message = typeof payload.message === "string"
            ? payload.message
            : String(legacyArgs[1] ?? "");
        const line = typeof payload.lineNumber === "number"
            ? payload.lineNumber
            : (typeof payload.line === "number" ? payload.line : Number(legacyArgs[2] ?? 0));
        const sourceId = typeof payload.sourceId === "string"
            ? payload.sourceId
            : String(legacyArgs[3] ?? "unknown");

        console.error(`[Renderer] ${message} (line ${line} at ${sourceId})`);
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on("second-instance", () => {
    if (!mainWindow) {
        return;
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.focus();
});

app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (_wae, webPreferences) => {
        webPreferences.preload = path.join(__dirname, "webviewPreload.js");
    });
});

app.whenReady()
    .then(() => {
        app.setAppUserModelId("StellarisModManager.ElectronSpike");
        logInfo(`Electron userData path: ${electronDataPaths.userDataRoot}`);
        logInfo(`Electron sessionData path: ${electronDataPaths.sessionDataRoot}`);
        logInfo(`Electron Chromium cache path: ${electronDataPaths.chromiumCacheRoot}`);
        registerIpcHandlers();
        createMainWindow();
        logInfo("Electron spike started.");
    })
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown startup error";
        logError(`Electron startup failed: ${message}`);
        app.exit(1);
    });
