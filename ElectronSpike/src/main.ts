import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./main/ipc";
import { logError, logInfo } from "./main/services/logger";

let mainWindow: BrowserWindow | null = null;

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
    mainWindow = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 1080,
        minHeight: 700,
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
    logInfo(`Loading renderer from ${entryPath}`);
    void mainWindow.loadFile(entryPath);
    
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
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

app.whenReady()
    .then(() => {
        registerIpcHandlers();
        createMainWindow();
        logInfo("Electron spike started.");
    })
    .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown startup error";
        logError(`Electron startup failed: ${message}`);
        app.exit(1);
    });
