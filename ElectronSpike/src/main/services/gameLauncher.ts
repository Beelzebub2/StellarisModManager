import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LaunchGameResult } from "../../shared/types";
import { isModsPathMigrationActive } from "./modsPathMigrationState";
import { loadSettingsSnapshot } from "./settings";
import { logError, logInfo } from "./logger";
import { getGameRunningStatus, killStellaris } from "./stellarisProcess";

export function launchGame(): LaunchGameResult {
    if (isModsPathMigrationActive()) {
        return {
            ok: false,
            message: "Cannot launch Stellaris while the mods folder move is still running.",
            wasRunning: false
        };
    }

    const settings = loadSettingsSnapshot();
    const gamePath = settings?.gamePath?.trim() || "";

    if (!gamePath) {
        return { ok: false, message: "Game path not configured. Set it in Settings.", wasRunning: false };
    }

    const wasRunning = getGameRunningStatus();

    if (wasRunning) {
        const killed = killStellaris();
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
