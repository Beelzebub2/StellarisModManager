import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { app } from "electron";
import type {
    AppReleaseInfo,
    AppUpdateCheckResult,
    StartAppUpdateResult
} from "../../shared/types";
import { loadSettingsSnapshot, saveSettingsSnapshot } from "./settings";
import { logError, logInfo } from "./logger";

const STELLARISYNC_BASE_URL = "https://stellarisync.rrmtools.uk";
const CHECK_TIMEOUT_MS = 12000;
const UPDATER_EXE_NAME = "smm-updater.exe";

function compareVersions(a: string, b: string): number {
    const pa = (a || "0.0.0").split(".").map(Number);
    const pb = (b || "0.0.0").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function fetchJson(urlString: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const client = url.protocol === "https:" ? https : http;

        const req = client.get(url, { timeout: CHECK_TIMEOUT_MS }, (res) => {
            if (res.statusCode && (res.statusCode >= 301 && res.statusCode <= 308) && res.headers.location) {
                fetchJson(res.headers.location).then(resolve, reject);
                return;
            }

            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                } catch {
                    reject(new Error("Invalid JSON response"));
                }
            });
            res.on("error", reject);
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timed out"));
        });
    });
}

export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
    const now = new Date().toISOString();
    const currentVersion = app.getVersion() || "0.1.0";

    try {
        const data = await fetchJson(`${STELLARISYNC_BASE_URL}/app-release/latest`) as Record<string, unknown>;

        const release: AppReleaseInfo = {
            version: String(data.version || ""),
            changelog: typeof data.changelog === "string" ? data.changelog : null,
            critical: data.critical === true,
            downloadUrl: String(data.downloadUrl || ""),
            releaseUrl: String(data.releaseUrl || ""),
            releasedAt: String(data.releasedAt || now),
            sha256: typeof data.sha256 === "string" ? data.sha256 : null
        };

        if (!release.version) {
            logInfo("App update check: no version in response.");
            return {
                ok: true,
                message: "No release information available.",
                hasUpdate: false,
                release: null,
                currentVersion,
                checkedAtUtc: now
            };
        }

        const hasUpdate = compareVersions(release.version, currentVersion) > 0;
        const settings = loadSettingsSnapshot();
        if (settings) {
            settings.lastAppUpdateCheckUtc = now;
            settings.lastOfferedAppVersion = hasUpdate ? release.version : (settings.lastOfferedAppVersion || "");
            saveSettingsSnapshot(settings);
        }

        logInfo(`App update check: current=${currentVersion}, latest=${release.version}, hasUpdate=${hasUpdate}`);

        return {
            ok: true,
            message: hasUpdate
                ? `Update available: v${release.version}`
                : "You are running the latest version.",
            hasUpdate,
            release: hasUpdate ? release : null,
            currentVersion,
            checkedAtUtc: now
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`App update check failed: ${msg}`);
        return {
            ok: false,
            message: `Update check failed: ${msg}`,
            hasUpdate: false,
            release: null,
            currentVersion,
            checkedAtUtc: now
        };
    }
}

function resolveUpdaterExecutable(): string | null {
    const candidates = [
        // Installed layout: updater sits next to the main exe (electron-builder win-unpacked root)
        path.join(path.dirname(app.getPath("exe")), UPDATER_EXE_NAME),
        // Packaged resources fallback
        path.join(process.resourcesPath || "", UPDATER_EXE_NAME),
        // Dev fallback: Cargo release build inside the repo
        path.join(app.getAppPath(), "..", "updater", "target", "release", UPDATER_EXE_NAME),
        path.join(app.getAppPath(), "..", "..", "updater", "target", "release", UPDATER_EXE_NAME)
    ];

    for (const candidate of candidates) {
        try {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // ignore and keep searching
        }
    }
    return null;
}

export async function startAppUpdate(release: AppReleaseInfo): Promise<StartAppUpdateResult> {
    if (!release || !release.downloadUrl || !release.version) {
        return { ok: false, message: "Missing download URL or version." };
    }

    const updaterPath = resolveUpdaterExecutable();
    if (!updaterPath) {
        logError(`Updater executable '${UPDATER_EXE_NAME}' not found next to app.`);
        return {
            ok: false,
            message: `Updater companion not installed. Please download the latest installer manually.`
        };
    }

    const args = ["--url", release.downloadUrl, "--version", release.version];
    if (release.sha256) {
        args.push("--sha256", release.sha256);
    } else {
        logInfo("Launching updater without SHA-256 — integrity check will be skipped.");
    }
    if (release.releaseUrl) {
        args.push("--release-url", release.releaseUrl);
    }

    try {
        const child = spawn(updaterPath, args, {
            detached: true,
            stdio: "ignore",
            windowsHide: false
        });
        child.unref();
        logInfo(`Spawned updater: ${updaterPath} (pid=${child.pid ?? "?"})`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`Failed to spawn updater: ${msg}`);
        return { ok: false, message: `Failed to start updater: ${msg}` };
    }

    // Give the updater a moment to draw its window before the app vanishes.
    setTimeout(() => app.quit(), 600);
    return { ok: true, message: "Updater launched." };
}
