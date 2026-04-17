import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LaunchGameResult } from "../../shared/types";
import { loadSettingsSnapshot } from "./settings";
import { logError, logInfo } from "./logger";

function isGameRunning(): boolean {
    try {
        if (process.platform === "win32") {
            const output = execSync("tasklist /FI \"IMAGENAME eq stellaris.exe\" /NH", {
                encoding: "utf-8",
                timeout: 5000,
                windowsHide: true
            });
            return output.toLowerCase().includes("stellaris.exe");
        }

        const output = execSync("pgrep -f stellaris", {
            encoding: "utf-8",
            timeout: 5000
        });
        return output.trim().length > 0;
    } catch {
        return false;
    }
}

function killGame(): boolean {
    try {
        if (process.platform === "win32") {
            execSync("taskkill /IM stellaris.exe /F", {
                encoding: "utf-8",
                timeout: 10000,
                windowsHide: true
            });
        } else {
            execSync("pkill -f stellaris", {
                encoding: "utf-8",
                timeout: 10000
            });
        }
        return true;
    } catch {
        return false;
    }
}

export function getGameRunningStatus(): boolean {
    return isGameRunning();
}

export function launchGame(): LaunchGameResult {
    const settings = loadSettingsSnapshot();
    const gamePath = settings?.gamePath?.trim() || "";

    if (!gamePath) {
        return { ok: false, message: "Game path not configured. Set it in Settings.", wasRunning: false };
    }

    const wasRunning = isGameRunning();

    if (wasRunning) {
        const killed = killGame();
        if (!killed) {
            return { ok: false, message: "Failed to stop Stellaris. Close it manually.", wasRunning: true };
        }
        logInfo("Killed running Stellaris process for restart.");
    }

    const exePath = path.join(gamePath, "stellaris.exe");
    if (!fs.existsSync(exePath)) {
        // Try Steam launch as fallback
        try {
            if (process.platform === "win32") {
                spawn("cmd", ["/c", "start", "steam://run/281990"], {
                    detached: true,
                    stdio: "ignore",
                    windowsHide: true
                }).unref();
            } else {
                spawn("xdg-open", ["steam://run/281990"], {
                    detached: true,
                    stdio: "ignore"
                }).unref();
            }
            logInfo("Launched Stellaris via Steam protocol.");
            return {
                ok: true,
                message: wasRunning ? "Restarting Stellaris via Steam..." : "Launching Stellaris via Steam...",
                wasRunning
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            logError(`Failed to launch Stellaris: ${msg}`);
            return { ok: false, message: `Failed to launch: ${msg}`, wasRunning };
        }
    }

    try {
        const child = spawn(exePath, [], {
            detached: true,
            stdio: "ignore",
            cwd: gamePath
        });
        child.unref();
        logInfo(`Launched Stellaris from ${exePath}`);
        return {
            ok: true,
            message: wasRunning ? "Restarting Stellaris..." : "Launching Stellaris...",
            wasRunning
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`Failed to launch Stellaris: ${msg}`);
        return { ok: false, message: `Failed to launch: ${msg}`, wasRunning };
    }
}
