import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import Database from "better-sqlite3";
import type {
    DownloadActionRequest,
    DownloadActionResult,
    DownloadQueueCommandResult,
    DownloadQueueEvent,
    DownloadQueueItem,
    DownloadQueueSnapshot,
    ModActionState
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { loadSettingsSnapshot } from "./settings";
import { discoverSteamLibraries } from "./steamDiscovery";
import { logError, logInfo } from "./logger";
import { isSteamworksAvailable, runSteamworksDownload } from "./steamworksProvider";

const STELLARIS_APP_ID = "281990";
const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_STEAMCMD_BATCH_ITEMS = 8;
const STEAMCMD_TIMEOUT_MS = 12 * 60 * 1000;
type DownloadRuntime = "Auto" | "SteamKit2" | "SteamCmd";

type EventEmitter = (event: DownloadQueueEvent) => void;

let eventEmitter: EventEmitter | null = null;

interface RunningJob {
    workshopId: string;
    action: "install" | "uninstall";
    process: ChildProcess | null;
    cancelled: boolean;
    sharedProcess: boolean;
}

interface InstallExecutionResult {
    ok: boolean;
    installPath: string;
    message: string;
}

interface InstallStateStore {
    byWorkshopId: Record<string, string>;
}

const installPathById = new Map<string, string>();
const actionStates = new Map<string, ModActionState>();
const queueItems = new Map<string, DownloadQueueItem>();
const queueOrder: string[] = [];
const queuePending: Array<{ workshopId: string; modName: string; action: "install" | "uninstall" }> = [];

const runningJobs = new Map<string, RunningJob>();
let queueWorkerActive = false;
let initialized = false;

const cacheRoot = path.join(getLegacyPaths().productDir, "ElectronSpike", "download-manager-cache");
const installStatePath = path.join(cacheRoot, "install-state.json");

function nowIso(): string {
    return new Date().toISOString();
}

function isValidWorkshopId(value: string): boolean {
    return /^\d{6,}$/.test(value);
}

function sanitizeWorkshopId(value: string): string {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return "";
    }

    if (/^\d{6,}$/.test(raw)) {
        return raw;
    }

    const idParamMatch = raw.match(/[?&]id=(\d{6,})\b/i);
    if (idParamMatch) {
        return idParamMatch[1];
    }

    const fileDetailsMatch = raw.match(/sharedfiles\/filedetails\/?[^\s]*id=(\d{6,})\b/i);
    if (fileDetailsMatch) {
        return fileDetailsMatch[1];
    }

    const fallbackDigitsMatch = raw.match(/\b(\d{6,})\b/);
    return fallbackDigitsMatch ? fallbackDigitsMatch[1] : raw;
}

function emitSnapshot(): void {
    if (!eventEmitter) return;
    eventEmitter({
        kind: "snapshot",
        snapshot: getQueueSnapshot()
    });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
        const raw = await fsp.readFile(filePath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    await fsp.mkdir(cacheRoot, { recursive: true });

    const installState = await readJsonFile<InstallStateStore>(installStatePath, { byWorkshopId: {} });
    for (const [id, p] of Object.entries(installState.byWorkshopId ?? {})) {
        installPathById.set(id, p);
    }

    initialized = true;
}

async function saveInstallState(): Promise<void> {
    await writeJsonFile(installStatePath, {
        byWorkshopId: Object.fromEntries(installPathById.entries())
    } satisfies InstallStateStore);
}

function upsertQueueItem(
    workshopId: string,
    modName: string,
    action: "install" | "uninstall",
    status: DownloadQueueItem["status"],
    progress: number,
    message: string
): DownloadQueueItem {
    const next: DownloadQueueItem = {
        workshopId,
        modName,
        action,
        status,
        progress: Math.min(100, Math.max(0, Math.trunc(progress))),
        message,
        updatedAtUtc: nowIso()
    };

    const existed = queueItems.has(workshopId);
    queueItems.set(workshopId, next);
    if (!existed) {
        queueOrder.unshift(workshopId);
    }

    emitSnapshot();
    return next;
}

function getQueueSnapshot(): DownloadQueueSnapshot {
    const items = Array.from(new Set(queueOrder))
        .map((workshopId) => queueItems.get(workshopId))
        .filter((item): item is DownloadQueueItem => item !== undefined)
        .slice(0, 60);

    const allItems = Array.from(queueItems.values());
    const queuedNotRunningCount = allItems.filter((i) => i.status === "queued" && !runningJobs.has(i.workshopId)).length;
    const completedCount = allItems.filter((i) => i.status === "completed").length;
    const failedCount = allItems.filter((i) => i.status === "failed").length;
    const cancelledCount = allItems.filter((i) => i.status === "cancelled").length;

    const runningCount = runningJobs.size;
    const queuedCount = Math.max(queuedNotRunningCount, queuePending.length);
    const pendingCount = queuePending.length;
    const finishedCount = completedCount + failedCount + cancelledCount;
    const hasActiveWork = runningCount > 0 || pendingCount > 0;

    return {
        items,
        hasActiveWork,
        runningCount,
        queuedCount,
        pendingCount,
        finishedCount,
        failedCount,
        cancelledCount,
        totalTrackedCount: allItems.length,
        updatedAtUtc: nowIso()
    };
}

function getInstalledWorkshopIdsFromDb(): Set<string> {
    const installedIds = new Set<string>();
    const dbPath = getLegacyPaths().modsDbPath;

    if (!fs.existsSync(dbPath)) return installedIds;

    let db: Database.Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const columns = db.prepare("PRAGMA table_info(Mods)").all() as Array<{ name: string }>;
        const workshopColumn = columns.some((c) => c.name === "SteamWorkshopId")
            ? "SteamWorkshopId"
            : columns.some((c) => c.name === "WorkshopId")
                ? "WorkshopId"
                : null;

        if (!workshopColumn) return installedIds;

        const rows = db
            .prepare(`SELECT DISTINCT ${workshopColumn} AS WorkshopId FROM Mods WHERE ${workshopColumn} IS NOT NULL AND ${workshopColumn} <> ''`)
            .all() as Array<{ WorkshopId: string }>;

        for (const row of rows) {
            if (row.WorkshopId?.trim()) installedIds.add(row.WorkshopId.trim());
        }
    } catch {
        // ignore
    } finally {
        db?.close();
    }

    return installedIds;
}

// --- Path resolution ---

function getDefaultModsPath(): string {
    const home = os.homedir();
    if (process.platform === "win32" || process.platform === "darwin") {
        return path.join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
    }
    return path.join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod");
}

function resolveModsInstallRoot(): string {
    const settings = loadSettingsSnapshot();
    const configured = settings?.modsPath?.trim();
    return configured && configured.length > 0 ? configured : getDefaultModsPath();
}

function resolveDownloadBasePath(): string {
    const settings = loadSettingsSnapshot();
    const configured = settings?.steamCmdDownloadPath?.trim();
    return configured || path.join(getLegacyPaths().productDir, "SteamCmdDownloads");
}

function normalizeDownloadRuntime(value: string | undefined): DownloadRuntime {
    const normalized = value?.trim().toLowerCase() ?? "";
    if (normalized === "steamkit2") return "SteamKit2";
    if (normalized === "steamcmd") return "SteamCmd";
    return "Auto";
}

function resolveEffectiveRuntime(): DownloadRuntime {
    const settings = loadSettingsSnapshot();
    const configuredRuntime = normalizeDownloadRuntime(settings?.workshopDownloadRuntime);
    if (configuredRuntime !== "Auto") {
        return configuredRuntime;
    }

    const steamCmdPath = settings?.steamCmdPath?.trim() ?? "";
    if (steamCmdPath && fs.existsSync(steamCmdPath)) {
        return "SteamCmd";
    }

    return "SteamKit2";
}

function dedupeResolvedPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of paths) {
        const normalized = path.resolve(value);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

function getWorkshopDownloadPathCandidates(downloadBasePath: string, workshopId: string): string[] {
    const base = path.resolve(downloadBasePath);
    const directBaseName = path.basename(base).trim();

    const candidates = [
        path.join(base, "steamapps", "workshop", "content", STELLARIS_APP_ID, workshopId),
        path.join(base, "workshop", "content", STELLARIS_APP_ID, workshopId),
        path.join(base, "steamapps", "workshop", "content", workshopId),
        path.join(base, "workshop", "content", workshopId),
        path.join(base, STELLARIS_APP_ID, workshopId),
        path.join(base, workshopId)
    ];

    if (directBaseName === STELLARIS_APP_ID) {
        candidates.push(path.join(base, workshopId));
    }

    return dedupeResolvedPaths(candidates);
}

async function findDownloadedWorkshopPath(candidates: string[]): Promise<{ foundPath: string | null; hadEmptyPath: boolean }> {
    let hadEmptyPath = false;
    for (const candidate of candidates) {
        try {
            const entries = await fsp.readdir(candidate);
            if (entries.length > 0) return { foundPath: candidate, hadEmptyPath: false };
            hadEmptyPath = true;
        } catch {
            // skip
        }
    }
    return { foundPath: null, hadEmptyPath };
}

async function removeDirectoryIfExists(targetPath: string): Promise<void> {
    try {
        await fsp.rm(targetPath, { recursive: true, force: true });
    } catch {
        // best effort
    }
}

// --- Descriptor handling ---

function upsertQuotedDescriptorField(content: string, key: string, value: string): string {
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const line = `${key}="${escapedValue}"`;
    const re = new RegExp(`^\\s*${key}\\s*=\\s*"[^"]*"\\s*$`, "m");

    if (re.test(content)) return content.replace(re, line);
    const trimmed = content.trimEnd();
    return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}

async function deployDownloadedModToModsPath(
    workshopId: string,
    downloadedInstallPath: string,
    reportProgress: (progress: number, message: string) => void,
    keepSource = false
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const modsRoot = resolveModsInstallRoot();
    const finalInstallPath = path.join(modsRoot, workshopId);
    const finalDescriptorPath = path.join(modsRoot, `${workshopId}.mod`);

    try {
        await fsp.mkdir(modsRoot, { recursive: true });
    } catch {
        return { ok: false, installPath: finalInstallPath, message: `Could not create mods path: ${modsRoot}` };
    }

    reportProgress(96, `Deploying ${workshopId} to mods path...`);

    try {
        await removeDirectoryIfExists(finalInstallPath);
        await fsp.cp(downloadedInstallPath, finalInstallPath, { recursive: true, force: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Copy failed";
        return { ok: false, installPath: finalInstallPath, message: `Failed to deploy mod files: ${message}` };
    }

    let descriptorContent = `name="Workshop Mod ${workshopId}"\nremote_file_id="${workshopId}"\npath="mod/${workshopId}"\n`;
    try {
        const downloadedDescriptorPath = path.join(downloadedInstallPath, "descriptor.mod");
        if (fs.existsSync(downloadedDescriptorPath)) {
            descriptorContent = await fsp.readFile(downloadedDescriptorPath, "utf8");
        }
    } catch {
        // fall back to minimal descriptor
    }

    descriptorContent = upsertQuotedDescriptorField(descriptorContent, "remote_file_id", workshopId);
    descriptorContent = upsertQuotedDescriptorField(descriptorContent, "path", `mod/${workshopId}`);

    try {
        await fsp.writeFile(finalDescriptorPath, descriptorContent, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : "Descriptor write failed";
        return { ok: false, installPath: finalInstallPath, message: `Failed to write descriptor: ${message}` };
    }

    if (!keepSource && path.resolve(downloadedInstallPath) !== path.resolve(finalInstallPath)) {
        await removeDirectoryIfExists(downloadedInstallPath);
    }

    return { ok: true, installPath: finalInstallPath, message: `Installed to mods path: ${finalInstallPath}` };
}

// --- Steamworks download (primary) ---

async function runSteamworksInstall(
    entry: { workshopId: string; modName: string },
    job: RunningJob,
    reportProgress: (progress: number, message: string) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const downloadResult = await runSteamworksDownload(entry.workshopId, job, reportProgress);
    if (!downloadResult.ok) return downloadResult;

    // Deploy from Steam's workshop cache to the Stellaris mods folder.
    // keepSource=true because the source is Steam's workshop cache — we must not delete it.
    reportProgress(96, `Deploying ${entry.workshopId} to mods path...`);
    const deployed = await deployDownloadedModToModsPath(entry.workshopId, downloadResult.installPath, reportProgress, true);
    if (!deployed.ok) return deployed;

    installPathById.set(entry.workshopId, deployed.installPath);
    await saveInstallState();

    return { ok: true, installPath: deployed.installPath, message: deployed.message };
}

// --- SteamCMD download (fallback) ---

function parseSteamCmdProgress(line: string): number | null {
    const match = line.match(/(\d{1,3}\.\d{2})%/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[1]);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.min(95, Math.round(parsed)));
}

function extractSteamCmdFailureDetail(line: string): string | null {
    const explicit = line.match(/ERROR!\s*Download item\s+\d+\s+failed\s*\([^)]*\)\.?/i);
    if (explicit) return explicit[0].trim();

    const failedDownload = line.match(/Download item\s+\d+\s+failed\s*\([^)]*\)\.?/i);
    if (failedDownload) return `ERROR! ${failedDownload[0].trim()}`;

    const genericError = line.match(/ERROR!\s*[^|\r\n]+/i);
    if (genericError) return genericError[0].trim();

    return null;
}

async function runSteamCmdDownload(
    workshopId: string,
    job: RunningJob,
    reportProgress: (progress: number, message: string) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const settings = loadSettingsSnapshot();
    const steamCmdPath = settings?.steamCmdPath?.trim() ?? "";
    if (!steamCmdPath || !fs.existsSync(steamCmdPath)) {
        return { ok: false, installPath: "", message: "SteamCMD path is not configured or executable is missing." };
    }

    // Each concurrent download uses its own temp subdirectory to avoid conflicts
    const downloadBase = resolveDownloadBasePath();
    const forceInstallDir = path.join(downloadBase, `dl-${workshopId}`);
    await fsp.mkdir(forceInstallDir, { recursive: true });

    const outputCandidates = getWorkshopDownloadPathCandidates(forceInstallDir, workshopId);
    for (const candidate of outputCandidates) {
        await removeDirectoryIfExists(candidate);
    }

    const args = [
        "+force_install_dir", forceInstallDir,
        "+login", "anonymous",
        "+workshop_download_item", STELLARIS_APP_ID, workshopId, "validate",
        "+quit"
    ];

    reportProgress(6, `Launching SteamCMD for ${workshopId}...`);

    const statusHints: string[] = [];
    let explicitFailureMessage: string | null = null;
    const appendStatusHint = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const failureDetail = extractSteamCmdFailureDetail(trimmed);
        if (failureDetail && !explicitFailureMessage) {
            explicitFailureMessage = failureDetail;
        }
        statusHints.push(trimmed);
        if (statusHints.length > 8) statusHints.shift();
    };

    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        const child = spawn(steamCmdPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });

        job.process = child;

        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            try { child.kill(); } catch { /* ignore */ }
        }, STEAMCMD_TIMEOUT_MS);

        child.stdout.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            for (const line of text.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const parsed = parseSteamCmdProgress(trimmed);
                if (parsed !== null) {
                    reportProgress(parsed, `Downloading ${workshopId}... ${parsed}%`);
                } else {
                    appendStatusHint(trimmed);
                }
            }
        });

        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim();
            if (text) {
                reportProgress(12, `SteamCMD: ${text}`);
                appendStatusHint(text);
            }
        });

        child.on("error", (error) => {
            clearTimeout(timeout);
            resolve({ ok: false, message: error.message });
        });

        child.on("close", (code) => {
            clearTimeout(timeout);
            if (timedOut) { resolve({ ok: false, message: "SteamCMD download timed out." }); return; }
            if (job.cancelled) { resolve({ ok: false, message: "Download cancelled." }); return; }
            if (code !== 0) { resolve({ ok: false, message: `SteamCMD exited with code ${String(code)}` }); return; }
            resolve({ ok: true, message: "SteamCMD reported success." });
        });
    });

    if (!result.ok) {
        // Clean up the temp dir on failure
        await removeDirectoryIfExists(forceInstallDir);
        return { ok: false, installPath: outputCandidates[0] ?? "", message: result.message };
    }

    if (explicitFailureMessage) {
        await removeDirectoryIfExists(forceInstallDir);
        return { ok: false, installPath: outputCandidates[0] ?? "", message: `SteamCMD reported download failure: ${explicitFailureMessage}` };
    }

    const located = await findDownloadedWorkshopPath(outputCandidates);
    if (!located.foundPath) {
        const hint = statusHints.length > 0 ? ` Last SteamCMD output: ${statusHints.join(" | ")}` : "";
        await removeDirectoryIfExists(forceInstallDir);
        return {
            ok: false,
            installPath: outputCandidates[0] ?? "",
            message: located.hadEmptyPath
                ? `SteamCMD finished but download folder is empty.${hint}`
                : `SteamCMD finished but download folder was not found.${hint}`
        };
    }

    const deployed = await deployDownloadedModToModsPath(workshopId, located.foundPath, reportProgress);

    // Clean up the temp download dir (the whole dl-{workshopId} folder)
    await removeDirectoryIfExists(forceInstallDir);

    if (!deployed.ok) return deployed;

    installPathById.set(workshopId, deployed.installPath);
    await saveInstallState();

    return { ok: true, installPath: deployed.installPath, message: deployed.message };
}

async function runSteamCmdDownloadBatch(
    entries: Array<{ workshopId: string; modName: string; action: "install" | "uninstall" }>,
    jobsByWorkshopId: Map<string, RunningJob>,
    reportProgress: (workshopId: string, progress: number, message: string) => void
): Promise<Map<string, InstallExecutionResult>> {
    const results = new Map<string, InstallExecutionResult>();
    if (entries.length === 0) {
        return results;
    }

    if (entries.length === 1) {
        const entry = entries[0];
        const job = jobsByWorkshopId.get(entry.workshopId);
        if (!job) {
            results.set(entry.workshopId, {
                ok: false,
                installPath: "",
                message: "Internal queue error: running job was not found."
            });
            return results;
        }

        const singleResult = await runSteamCmdDownload(entry.workshopId, job, (progress, message) => {
            reportProgress(entry.workshopId, progress, message);
        });
        results.set(entry.workshopId, singleResult);
        return results;
    }

    const settings = loadSettingsSnapshot();
    const steamCmdPath = settings?.steamCmdPath?.trim() ?? "";
    if (!steamCmdPath || !fs.existsSync(steamCmdPath)) {
        for (const entry of entries) {
            results.set(entry.workshopId, {
                ok: false,
                installPath: "",
                message: "SteamCMD path is not configured or executable is missing."
            });
        }
        return results;
    }

    const downloadBase = resolveDownloadBasePath();
    const forceInstallDir = path.join(downloadBase, `dl-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fsp.mkdir(forceInstallDir, { recursive: true });

    try {
        const outputCandidatesById = new Map<string, string[]>();
        for (const entry of entries) {
            const candidates = getWorkshopDownloadPathCandidates(forceInstallDir, entry.workshopId);
            outputCandidatesById.set(entry.workshopId, candidates);
            for (const candidate of candidates) {
                await removeDirectoryIfExists(candidate);
            }

            reportProgress(entry.workshopId, 6, `Launching SteamCMD batch for ${entries.length} mods...`);
        }

        const args = [
            "+force_install_dir", forceInstallDir,
            "+login", "anonymous"
        ];

        for (const entry of entries) {
            args.push("+workshop_download_item", STELLARIS_APP_ID, entry.workshopId, "validate");
        }
        args.push("+quit");

        const statusHints: string[] = [];
        let explicitFailureMessage: string | null = null;
        const appendStatusHint = (line: string): void => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }

            const failureDetail = extractSteamCmdFailureDetail(trimmed);
            if (failureDetail && !explicitFailureMessage) {
                explicitFailureMessage = failureDetail;
            }

            statusHints.push(trimmed);
            if (statusHints.length > 8) {
                statusHints.shift();
            }
        };

        const batchRunResult = await new Promise<{ ok: boolean; message: string }>((resolve) => {
            const child = spawn(steamCmdPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true
            });

            for (const entry of entries) {
                const job = jobsByWorkshopId.get(entry.workshopId);
                if (job) {
                    job.process = child;
                }
            }

            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill();
                } catch {
                    // ignore
                }
            }, STEAMCMD_TIMEOUT_MS);

            child.stdout.on("data", (chunk) => {
                const text = chunk.toString("utf8");
                for (const line of text.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        continue;
                    }

                    const parsed = parseSteamCmdProgress(trimmed);
                    if (parsed !== null) {
                        for (const entry of entries) {
                            const job = jobsByWorkshopId.get(entry.workshopId);
                            if (!job || job.cancelled) {
                                continue;
                            }

                            reportProgress(
                                entry.workshopId,
                                parsed,
                                `Downloading ${entries.length} mods... ${parsed}%`
                            );
                        }
                    } else {
                        appendStatusHint(trimmed);
                    }
                }
            });

            child.stderr.on("data", (chunk) => {
                const text = chunk.toString("utf8").trim();
                if (!text) {
                    return;
                }

                appendStatusHint(text);
                for (const entry of entries) {
                    const job = jobsByWorkshopId.get(entry.workshopId);
                    if (!job || job.cancelled) {
                        continue;
                    }

                    reportProgress(entry.workshopId, 12, `SteamCMD: ${text}`);
                }
            });

            child.on("error", (error) => {
                clearTimeout(timeout);
                resolve({ ok: false, message: error.message });
            });

            child.on("close", (code) => {
                clearTimeout(timeout);
                if (timedOut) {
                    resolve({ ok: false, message: "SteamCMD download timed out." });
                    return;
                }

                const hasRunningNonCancelledJob = entries.some((entry) => {
                    const job = jobsByWorkshopId.get(entry.workshopId);
                    return Boolean(job) && !job!.cancelled;
                });
                if (!hasRunningNonCancelledJob) {
                    resolve({ ok: false, message: "Download cancelled." });
                    return;
                }

                if (code !== 0) {
                    resolve({ ok: false, message: `SteamCMD exited with code ${String(code)}` });
                    return;
                }

                resolve({ ok: true, message: "SteamCMD reported success." });
            });
        });

        if (!batchRunResult.ok) {
            for (const entry of entries) {
                const job = jobsByWorkshopId.get(entry.workshopId);
                if (job?.cancelled) {
                    results.set(entry.workshopId, {
                        ok: false,
                        installPath: "",
                        message: "Download cancelled."
                    });
                    continue;
                }

                results.set(entry.workshopId, {
                    ok: false,
                    installPath: "",
                    message: batchRunResult.message
                });
            }

            return results;
        }

        if (explicitFailureMessage) {
            for (const entry of entries) {
                const job = jobsByWorkshopId.get(entry.workshopId);
                if (job?.cancelled) {
                    results.set(entry.workshopId, {
                        ok: false,
                        installPath: "",
                        message: "Download cancelled."
                    });
                    continue;
                }

                results.set(entry.workshopId, {
                    ok: false,
                    installPath: "",
                    message: `SteamCMD reported download failure: ${explicitFailureMessage}`
                });
            }

            return results;
        }

        let installStateDirty = false;

        for (const entry of entries) {
            const job = jobsByWorkshopId.get(entry.workshopId);
            if (job?.cancelled) {
                results.set(entry.workshopId, {
                    ok: false,
                    installPath: "",
                    message: "Download cancelled."
                });
                continue;
            }

            const candidates = outputCandidatesById.get(entry.workshopId) ?? [];
            const located = await findDownloadedWorkshopPath(candidates);
            if (!located.foundPath) {
                const hint = statusHints.length > 0
                    ? ` Last SteamCMD output: ${statusHints.join(" | ")}`
                    : "";

                results.set(entry.workshopId, {
                    ok: false,
                    installPath: candidates[0] ?? "",
                    message: located.hadEmptyPath
                        ? `SteamCMD finished but download folder is empty.${hint}`
                        : `SteamCMD finished but download folder was not found.${hint}`
                });
                continue;
            }

            const deployed = await deployDownloadedModToModsPath(entry.workshopId, located.foundPath, (progress, message) => {
                reportProgress(entry.workshopId, progress, message);
            });

            if (deployed.ok) {
                installPathById.set(entry.workshopId, deployed.installPath);
                installStateDirty = true;
            }

            results.set(entry.workshopId, deployed);
        }

        if (installStateDirty) {
            await saveInstallState();
        }

        return results;
    } finally {
        await removeDirectoryIfExists(forceInstallDir);
    }
}

async function runUninstall(workshopId: string): Promise<{ ok: boolean; message: string }> {
    const knownPath = installPathById.get(workshopId);
    if (knownPath) {
        await removeDirectoryIfExists(knownPath);
        const descriptorPath = path.join(path.dirname(knownPath), `${workshopId}.mod`);
        await removeDirectoryIfExists(descriptorPath);
    } else {
        const modsRoot = resolveModsInstallRoot();
        await removeDirectoryIfExists(path.join(modsRoot, workshopId));
        await removeDirectoryIfExists(path.join(modsRoot, `${workshopId}.mod`));

        const discovery = discoverSteamLibraries();
        for (const library of discovery.libraries) {
            const candidate = path.join(library.workshopContentPath, workshopId);
            await removeDirectoryIfExists(candidate);
        }
    }

    installPathById.delete(workshopId);
    await saveInstallState();

    return { ok: true, message: "Uninstall completed." };
}

// --- Queue worker ---

async function runJob(entry: { workshopId: string; modName: string; action: "install" | "uninstall" }): Promise<void> {
    const job: RunningJob = {
        workshopId: entry.workshopId,
        action: entry.action,
        process: null,
        cancelled: false,
        sharedProcess: false
    };

    runningJobs.set(entry.workshopId, job);

    if (entry.action === "install") {
        const runtime = resolveEffectiveRuntime();
        actionStates.set(entry.workshopId, "installing");
        upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", 3, "Preparing download...");

        const installResult = runtime === "SteamCmd"
            ? await runSteamCmdDownload(entry.workshopId, job, (progress, message) => {
                upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", progress, message);
            })
            : {
                ok: false,
                installPath: "",
                message: "SteamKit2/Steamworks downloads are not available in this build. Select SteamCmd runtime in Settings."
            };

        if (job.cancelled) {
            actionStates.set(entry.workshopId, "not-installed");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "cancelled", 0, "Install cancelled.");
        } else if (installResult.ok) {
            actionStates.set(entry.workshopId, "installed");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "completed", 100, installResult.message);
        } else {
            actionStates.set(entry.workshopId, "error");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "failed", 0, installResult.message);
        }
    } else {
        actionStates.set(entry.workshopId, "uninstalling");
        upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", 10, "Removing mod files...");

        const uninstallResult = await runUninstall(entry.workshopId);

        if (job.cancelled) {
            actionStates.set(entry.workshopId, "installed");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "cancelled", 0, "Uninstall cancelled.");
        } else if (uninstallResult.ok) {
            actionStates.set(entry.workshopId, "not-installed");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "completed", 100, uninstallResult.message);
        } else {
            actionStates.set(entry.workshopId, "error");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "failed", 0, uninstallResult.message);
        }
    }

    runningJobs.delete(entry.workshopId);
}

function shouldUseSteamworks(): boolean {
    const settings = loadSettingsSnapshot();
    const runtime = (settings?.workshopDownloadRuntime ?? "Auto").toLowerCase();
    if (runtime === "steamcmd") return false;
    // "Steamworks" → always use steamworks; "Auto" → use steamworks if available
    return isSteamworksAvailable();
}

async function runInstallBatch(firstEntry: { workshopId: string; modName: string; action: "install" | "uninstall" }): Promise<void> {
<<<<<<< codex/fix-steamworks-download-failure
    const runtime = resolveEffectiveRuntime();
=======
    // --- Steamworks path: used when runtime is "Steamworks" or "Auto" (with Steam available) ---
    if (shouldUseSteamworks()) {
        const job: RunningJob = {
            workshopId: firstEntry.workshopId,
            action: "install",
            process: null,
            cancelled: false,
            sharedProcess: false
        };

        runningJobs.set(firstEntry.workshopId, job);
        actionStates.set(firstEntry.workshopId, "installing");
        upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "running", 3, "Requesting download from Steam...");
        logInfo(`Steamworks: install for ${firstEntry.workshopId}`);

        const result = await runSteamworksInstall(firstEntry, job, (progress, message) => {
            upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "running", progress, message);
        });

        if (job.cancelled) {
            actionStates.set(firstEntry.workshopId, "not-installed");
            upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "cancelled", 0, "Install cancelled.");
        } else if (result.ok) {
            actionStates.set(firstEntry.workshopId, "installed");
            upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "completed", 100, result.message);
        } else {
            // Steamworks failed — try SteamCMD as fallback for this single item
            logError(`Steamworks install failed for ${firstEntry.workshopId}: ${result.message}. Falling back to SteamCMD.`);
            upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "running", 3, `Steamworks unavailable, retrying via SteamCMD...`);
            const fallbackResult = await runSteamCmdDownloadBatch([firstEntry], new Map([[firstEntry.workshopId, job]]), (workshopId, progress, message) => {
                upsertQueueItem(workshopId, firstEntry.modName, "install", "running", progress, message);
            });
            const fallback = fallbackResult.get(firstEntry.workshopId) ?? { ok: false, installPath: "", message: "Unknown error." };
            if (job.cancelled) {
                actionStates.set(firstEntry.workshopId, "not-installed");
                upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "cancelled", 0, "Install cancelled.");
            } else if (fallback.ok) {
                actionStates.set(firstEntry.workshopId, "installed");
                upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "completed", 100, fallback.message);
            } else {
                actionStates.set(firstEntry.workshopId, "error");
                upsertQueueItem(firstEntry.workshopId, firstEntry.modName, "install", "failed", 0, fallback.message);
            }
        }

        runningJobs.delete(firstEntry.workshopId);
        return;
    }

    // --- SteamCMD fallback path: batch up to MAX_STEAMCMD_BATCH_ITEMS per process ---
>>>>>>> master
    const entries: Array<{ workshopId: string; modName: string; action: "install" | "uninstall" }> = [firstEntry];

    while (entries.length < MAX_STEAMCMD_BATCH_ITEMS && queuePending.length > 0) {
        const next = queuePending[0];
        if (!next || next.action !== "install") {
            break;
        }

        const shifted = queuePending.shift();
        if (!shifted) {
            break;
        }

        entries.push(shifted);
    }

    const isBatch = entries.length > 1;
    const jobsById = new Map<string, RunningJob>();

    for (const [index, entry] of entries.entries()) {
        const job: RunningJob = {
            workshopId: entry.workshopId,
            action: "install",
            process: null,
            cancelled: false,
            sharedProcess: isBatch
        };

        jobsById.set(entry.workshopId, job);
        runningJobs.set(entry.workshopId, job);

        const waitingForBatchStart = isBatch && index > 0;
        actionStates.set(entry.workshopId, waitingForBatchStart ? "queued" : "installing");
        upsertQueueItem(
            entry.workshopId,
            entry.modName,
            "install",
            waitingForBatchStart ? "queued" : "running",
            waitingForBatchStart ? 0 : 3,
            waitingForBatchStart
                ? `Waiting for batch start (${index + 1}/${entries.length}).`
                : isBatch
                    ? `Preparing SteamCMD batch (${entries.length} mods)...`
                    : "Preparing SteamCMD download..."
        );
    }

    logInfo(`Download queue: starting install ${isBatch ? `batch (${entries.length} mods)` : `for ${entries[0].workshopId}`} via ${runtime}`);

    const installResults = runtime === "SteamCmd"
        ? await runSteamCmdDownloadBatch(entries, jobsById, (workshopId, progress, message) => {
            const activeEntry = entries.find((entry) => entry.workshopId === workshopId);
            if (!activeEntry) {
                return;
            }

            upsertQueueItem(workshopId, activeEntry.modName, "install", "running", progress, message);
        })
        : new Map(entries.map((entry) => [entry.workshopId, {
            ok: false,
            installPath: "",
            message: "SteamKit2/Steamworks downloads are not available in this build. Select SteamCmd runtime in Settings."
        }]));

    for (const entry of entries) {
        const job = jobsById.get(entry.workshopId);
        const installResult = installResults.get(entry.workshopId) ?? {
            ok: false,
            installPath: "",
            message: "Unknown download error."
        };

        if (job?.cancelled) {
            actionStates.set(entry.workshopId, "not-installed");
            upsertQueueItem(entry.workshopId, entry.modName, "install", "cancelled", 0, "Install cancelled.");
        } else if (installResult.ok) {
            actionStates.set(entry.workshopId, "installed");
            upsertQueueItem(entry.workshopId, entry.modName, "install", "completed", 100, installResult.message);
        } else {
            actionStates.set(entry.workshopId, "error");
            upsertQueueItem(entry.workshopId, entry.modName, "install", "failed", 0, installResult.message);
        }

        runningJobs.delete(entry.workshopId);
    }
}

async function processQueue(): Promise<void> {
    if (queueWorkerActive) return;
    queueWorkerActive = true;

    try {
        while (queuePending.length > 0) {
            // Launch jobs up to MAX_CONCURRENT_DOWNLOADS
            while (runningJobs.size < MAX_CONCURRENT_DOWNLOADS && queuePending.length > 0) {
                const next = queuePending.shift();
                if (!next) break;

                logInfo(`Download queue: starting ${next.action} for ${next.workshopId} (${runningJobs.size + 1}/${MAX_CONCURRENT_DOWNLOADS} slots)`);
                // Don't await — fire-and-forget to enable queue throughput.
                const runner = next.action === "install" ? runInstallBatch(next) : runJob(next);
                void runner.catch((err) => {
                    logError(`Download job failed for ${next.workshopId}: ${err instanceof Error ? err.message : "unknown"}`);
                });

                // Small delay to stagger process launches
                await new Promise<void>((resolve) => setTimeout(resolve, 200));
            }

            // Wait for at least one running job to finish before pulling more from the queue
            if (runningJobs.size > 0) {
                await new Promise<void>((resolve) => {
                    const check = (): void => {
                        if (runningJobs.size < MAX_CONCURRENT_DOWNLOADS || queuePending.length === 0) {
                            resolve();
                        } else {
                            setTimeout(check, 500);
                        }
                    };
                    setTimeout(check, 500);
                });
            }
        }

        // Wait for all remaining running jobs to complete
        while (runningJobs.size > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
    } finally {
        queueWorkerActive = false;
    }
}

// --- Public API ---

export function setDownloadEventEmitter(emitter: EventEmitter): void {
    eventEmitter = emitter;
}

export function getActionState(workshopId: string): ModActionState {
    const mapped = actionStates.get(workshopId);
    if (mapped) return mapped;
    return "not-installed";
}

export function getEffectiveInstalledIds(): Set<string> {
    const dbIds = getInstalledWorkshopIdsFromDb();
    for (const id of installPathById.keys()) {
        dbIds.add(id);
    }
    return dbIds;
}

export function getActionStateForCard(workshopId: string): ModActionState {
    const mapped = actionStates.get(workshopId);
    if (mapped && mapped !== "not-installed") return mapped;
    const installedIds = getEffectiveInstalledIds();
    return installedIds.has(workshopId) ? "installed" : "not-installed";
}

export async function queueDownload(request: DownloadActionRequest): Promise<DownloadActionResult> {
    await ensureInitialized();

    const workshopId = sanitizeWorkshopId(request.workshopId);
    if (!isValidWorkshopId(workshopId)) {
        return { ok: false, workshopId, actionState: "error", message: "Invalid workshop id." };
    }

    const existing = queueItems.get(workshopId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
        return { ok: false, workshopId, actionState: getActionStateForCard(workshopId), message: `Mod ${workshopId} is already in queue.` };
    }

    const modName = request.modName?.trim() || workshopId;
    queuePending.push({ workshopId, modName, action: request.action });
    const queuePosition = queuePending.length;

    if (request.action === "install") {
        actionStates.set(workshopId, "queued");
        upsertQueueItem(workshopId, modName, request.action, "queued", 0, `Queued for install. Waiting slot: ${queuePosition}.`);
    } else {
        actionStates.set(workshopId, "queued");
        upsertQueueItem(workshopId, modName, request.action, "queued", 0, `Queued for uninstall. Waiting slot: ${queuePosition}.`);
    }

    void processQueue();

    return {
        ok: true,
        workshopId,
        actionState: getActionStateForCard(workshopId),
        message: request.action === "install"
            ? `Queued ${modName} for installation.`
            : `Queued ${modName} for uninstall.`
    };
}

export function cancelDownload(workshopIdRaw: string): DownloadActionResult {
    const workshopId = sanitizeWorkshopId(workshopIdRaw);
    if (!isValidWorkshopId(workshopId)) {
        return { ok: false, workshopId, actionState: "error", message: "Invalid workshop id." };
    }

    // Check pending queue first
    const pendingIndex = queuePending.findIndex((e) => e.workshopId === workshopId);
    if (pendingIndex >= 0) {
        const [removed] = queuePending.splice(pendingIndex, 1);
        const cancelledAction = removed.action;
        actionStates.set(workshopId, cancelledAction === "install" ? "not-installed" : "installed");
        upsertQueueItem(workshopId, removed.modName, cancelledAction, "cancelled", 0, "Queued operation cancelled.");
        return { ok: true, workshopId, actionState: getActionStateForCard(workshopId), message: `Cancelled queued operation for ${workshopId}.` };
    }

    // Check running jobs
    const job = runningJobs.get(workshopId);
    if (job) {
        job.cancelled = true;
        const activePeers = job.process
            ? Array.from(runningJobs.values()).filter((candidate) =>
                candidate.workshopId !== workshopId
                && candidate.process === job.process
                && !candidate.cancelled
            )
            : [];

        const shouldKillProcess = Boolean(job.process) && (!job.sharedProcess || activePeers.length === 0);
        if (job.process && shouldKillProcess) {
            try { job.process.kill(); } catch { /* ignore */ }
        }

        const message = job.sharedProcess && activePeers.length > 0
            ? `Cancel requested for ${workshopId}. Batch download continues for remaining mods.`
            : `Cancel requested for ${workshopId}.`;

        return { ok: true, workshopId, actionState: getActionStateForCard(workshopId), message };
    }

    return { ok: false, workshopId, actionState: getActionStateForCard(workshopId), message: `No active operation found for ${workshopId}.` };
}

export function cancelAllDownloads(): DownloadQueueCommandResult {
    let affected = 0;

    for (const pending of queuePending.splice(0, queuePending.length)) {
        actionStates.set(pending.workshopId, pending.action === "install" ? "not-installed" : "installed");
        upsertQueueItem(pending.workshopId, pending.modName, pending.action, "cancelled", 0, "Queued operation cancelled.");
        affected += 1;
    }

    const processesToKill = new Set<ChildProcess>();
    for (const [, job] of runningJobs) {
        job.cancelled = true;
        if (job.process) {
            processesToKill.add(job.process);
        }
        affected += 1;
    }

    for (const processHandle of processesToKill) {
        try { processHandle.kill(); } catch { /* ignore */ }
    }

    return {
        ok: true,
        message: affected > 0 ? `Cancelled ${affected} queue operation(s).` : "No active queue operations to cancel.",
        affected
    };
}

export function getDownloadQueueSnapshot(): DownloadQueueSnapshot {
    return getQueueSnapshot();
}

export function clearDownloadHistory(workshopIdsRaw?: string[]): DownloadQueueCommandResult {
    const requestedIds = Array.isArray(workshopIdsRaw)
        ? workshopIdsRaw.map((v) => sanitizeWorkshopId(String(v ?? ""))).filter((v) => v.length > 0)
        : [];

    const requestedSet = requestedIds.length > 0 ? new Set(requestedIds) : null;
    const targets: string[] = [];

    for (const workshopId of Array.from(new Set(queueOrder))) {
        if (requestedSet && !requestedSet.has(workshopId)) continue;
        const item = queueItems.get(workshopId);
        if (!item || item.status === "queued" || item.status === "running") continue;
        targets.push(workshopId);
    }

    let removed = 0;
    for (const workshopId of targets) {
        queueItems.delete(workshopId);
        actionStates.delete(workshopId);
        const orderIndex = queueOrder.indexOf(workshopId);
        if (orderIndex >= 0) queueOrder.splice(orderIndex, 1);
        removed += 1;
    }

    if (removed > 0) emitSnapshot();

    return {
        ok: true,
        message: removed > 0 ? `Cleared ${removed} queue history item(s).` : "No finished queue history to clear.",
        affected: removed
    };
}

export function getInstalledWorkshopIdsList(): string[] {
    const ids = getEffectiveInstalledIds();
    return Array.from(ids);
}
