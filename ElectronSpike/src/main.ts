import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./main/ipc";
import { logError, logInfo } from "./main/services/logger";

let mainWindow: BrowserWindow | null = null;

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

function configureWritableElectronDataPaths(): void {
    const userDataRoot = path.join(app.getPath("appData"), "StellarisModManager", "ElectronSpike");
    const sessionDataRoot = path.join(userDataRoot, "SessionData");

    fs.mkdirSync(userDataRoot, { recursive: true });
    fs.mkdirSync(sessionDataRoot, { recursive: true });

    app.setPath("userData", userDataRoot);
    app.setPath("sessionData", sessionDataRoot);
}

configureWritableElectronDataPaths();

function getRendererEntryPath(): string {
    const fromWorkspace = path.join(app.getAppPath(), "src", "renderer", "index.html");
    if (fs.existsSync(fromWorkspace)) {
        return fromWorkspace;
    }

    return path.join(__dirname, "renderer", "index.html");
}

function createMainWindow(): void {
    const iconPath = resolveAppWindowIconPath();

    mainWindow = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 1080,
        minHeight: 700,
        icon: iconPath,
        titleBarStyle: "hidden",
        titleBarOverlay: {
            color: "#0e1117",
            symbolColor: "#e2e8f0",
            height: 40
        },
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
    void mainWindow.loadFile(entryPath);

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

app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (_wae, webPreferences) => {
        webPreferences.preload = path.join(__dirname, "webviewPreload.js");
    });
});

app.whenReady()
    .then(() => {
        app.setAppUserModelId("StellarisModManager.ElectronSpike");
        registerIpcHandlers();
        createMainWindow();
        logInfo("Electron spike started.");
    })
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown startup error";
        logError(`Electron startup failed: ${message}`);
        app.exit(1);
    });
