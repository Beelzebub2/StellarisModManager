import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { app, shell } from "electron";
import type {
    AppReleaseInfo,
    AppUpdateCheckResult,
    AppUpdateDownloadProgress,
    AppUpdateDownloadResult
} from "../../shared/types";
import { loadSettingsSnapshot, saveSettingsSnapshot } from "./settings";
import { logError, logInfo } from "./logger";

const STELLARISYNC_BASE_URL = "https://stellarisync.rrmtools.uk";
const CHECK_TIMEOUT_MS = 12000;

let activeDownloadAbort: (() => void) | null = null;

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
                } catch (e) {
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
            releasedAt: String(data.releasedAt || now)
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

export function downloadAppUpdate(
    downloadUrl: string,
    version: string,
    onProgress: (progress: AppUpdateDownloadProgress) => void
): Promise<AppUpdateDownloadResult> {
    // Cancel any active download
    if (activeDownloadAbort) {
        activeDownloadAbort();
        activeDownloadAbort = null;
    }

    const tempDir = path.join(app.getPath("temp"), "StellarisModManager-Updates");
    fs.mkdirSync(tempDir, { recursive: true });
    const fileName = `StellarisModManager-Setup-${version}.exe`;
    const filePath = path.join(tempDir, fileName);

    // If already downloaded, return immediately
    if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > 1_000_000) {
            logInfo(`Update installer already cached: ${filePath}`);
            onProgress({
                phase: "completed",
                percent: 100,
                downloadedBytes: stat.size,
                totalBytes: stat.size,
                bytesPerSecond: 0,
                etaSeconds: 0,
                message: "Download complete.",
                installerPath: filePath
            });
            return Promise.resolve({ ok: true, message: "Installer ready.", installerPath: filePath });
        }
        // Too small — likely a partial download, remove it
        fs.unlinkSync(filePath);
    }

    return new Promise((resolve) => {
        let aborted = false;
        activeDownloadAbort = () => { aborted = true; };

        const url = new URL(downloadUrl);
        const client = url.protocol === "https:" ? https : http;

        function doRequest(reqUrl: URL, redirects: number): void {
            if (redirects > 5) {
                onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: "Too many redirects.", installerPath: null });
                resolve({ ok: false, message: "Too many redirects.", installerPath: null });
                return;
            }

            const reqClient = reqUrl.protocol === "https:" ? https : http;
            const req = reqClient.get(reqUrl, { timeout: 30000 }, (res) => {
                if (aborted) { res.destroy(); return; }

                if (res.statusCode && res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
                    res.resume();
                    try {
                        doRequest(new URL(res.headers.location), redirects + 1);
                    } catch {
                        onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: "Invalid redirect URL.", installerPath: null });
                        resolve({ ok: false, message: "Invalid redirect URL.", installerPath: null });
                    }
                    return;
                }

                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    const msg = `Download failed with HTTP ${res.statusCode}.`;
                    onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: msg, installerPath: null });
                    resolve({ ok: false, message: msg, installerPath: null });
                    return;
                }

                const totalBytes = parseInt(res.headers["content-length"] || "0", 10) || 0;
                let downloadedBytes = 0;
                const startTime = Date.now();
                let lastProgressTime = startTime;

                const fileStream = fs.createWriteStream(filePath);

                res.on("data", (chunk: Buffer) => {
                    if (aborted) { res.destroy(); fileStream.destroy(); return; }
                    downloadedBytes += chunk.length;

                    const now = Date.now();
                    // Throttle progress events to every 100ms
                    if (now - lastProgressTime >= 100 || downloadedBytes >= totalBytes) {
                        lastProgressTime = now;
                        const elapsed = (now - startTime) / 1000;
                        const bytesPerSecond = elapsed > 0 ? downloadedBytes / elapsed : 0;
                        const percent = totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
                        const remaining = totalBytes > 0 && bytesPerSecond > 0
                            ? Math.ceil((totalBytes - downloadedBytes) / bytesPerSecond)
                            : 0;

                        onProgress({
                            phase: "downloading",
                            percent,
                            downloadedBytes,
                            totalBytes,
                            bytesPerSecond,
                            etaSeconds: remaining,
                            message: `Downloading... ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`,
                            installerPath: null
                        });
                    }
                });

                res.pipe(fileStream);

                fileStream.on("finish", () => {
                    if (aborted) return;
                    activeDownloadAbort = null;
                    logInfo(`Update downloaded: ${filePath} (${formatBytes(downloadedBytes)})`);
                    onProgress({
                        phase: "completed",
                        percent: 100,
                        downloadedBytes,
                        totalBytes: downloadedBytes,
                        bytesPerSecond: 0,
                        etaSeconds: 0,
                        message: "Download complete.",
                        installerPath: filePath
                    });
                    resolve({ ok: true, message: "Download complete.", installerPath: filePath });
                });

                fileStream.on("error", (err) => {
                    activeDownloadAbort = null;
                    const msg = `Write error: ${err.message}`;
                    logError(msg);
                    onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: msg, installerPath: null });
                    resolve({ ok: false, message: msg, installerPath: null });
                });

                res.on("error", (err) => {
                    activeDownloadAbort = null;
                    fileStream.destroy();
                    const msg = `Network error: ${err.message}`;
                    logError(msg);
                    onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: msg, installerPath: null });
                    resolve({ ok: false, message: msg, installerPath: null });
                });
            });

            req.on("error", (err) => {
                activeDownloadAbort = null;
                const msg = `Request error: ${err.message}`;
                logError(msg);
                onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: msg, installerPath: null });
                resolve({ ok: false, message: msg, installerPath: null });
            });

            req.on("timeout", () => {
                req.destroy();
                activeDownloadAbort = null;
                const msg = "Download timed out.";
                onProgress({ phase: "failed", percent: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, etaSeconds: 0, message: msg, installerPath: null });
                resolve({ ok: false, message: msg, installerPath: null });
            });
        }

        doRequest(url, 0);
    });
}

export async function launchInstaller(installerPath: string): Promise<boolean> {
    if (!installerPath || !fs.existsSync(installerPath)) {
        logError(`Installer not found: ${installerPath}`);
        return false;
    }

    try {
        await shell.openPath(installerPath);
        logInfo(`Launched installer: ${installerPath}`);
        // Give the installer a moment to start, then quit the app
        setTimeout(() => app.quit(), 1500);
        return true;
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`Failed to launch installer: ${msg}`);
        return false;
    }
}

function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
