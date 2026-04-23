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
import {
    loadSettingsSnapshot,
    resolveDescriptorModsPath,
    resolveManagedModsPath
} from "./settings";
import { discoverSteamLibraries } from "./steamDiscovery";
import { logError, logInfo } from "./logger";
import {
    getSteamworksUnavailableMessage,
    isStandaloneSteamworksSessionFailure,
    runSteamworksDownload
} from "./steamworksProvider";

const STELLARIS_APP_ID = "281990";
const STEAM_PUBLISHED_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const MAX_CONCURRENT_DOWNLOADS = 3;
const STEAMCMD_TIMEOUT_MS = 12 * 60 * 1000;
const STEAMCMD_STALL_MS = 2 * 60 * 1000;
const STEAMCMD_PROGRESS_POLL_MS = 1000;
const WORKSHOP_TITLE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
type DownloadRuntime = "Auto" | "SteamKit2" | "SteamCMD";
type QueueProgressMode = NonNullable<DownloadQueueItem["progressMode"]>;
type SteamCmdPhase = "launching" | "preallocating" | "downloading" | "committing" | "verifying" | "deploying";

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
    retryIndividually?: boolean;
}

interface InstallStateStore {
    byWorkshopId: Record<string, string>;
}

interface QueueEntry {
    workshopId: string;
    modName: string;
    action: "install" | "uninstall";
}

interface MachineMetrics {
    cpuCount: number;
    totalMemoryGb: number;
}

interface SteamFileDetailsResponse {
    response?: {
        publishedfiledetails?: SteamPublishedFileDetail[];
    };
}

interface SteamPublishedFileDetail {
    publishedfileid?: string;
    title?: string;
    file_size?: string;
}

interface CachedWorkshopTitle {
    fetchedAtUtc: string;
    title: string | null;
    fileSizeBytes: number | null;
}


interface SteamCmdPhaseUpdate {
    progress: number;
    progressMode: QueueProgressMode;
    message: string;
}

interface SteamCmdContentLogEvent {
    phase?: Extract<SteamCmdPhase, "preallocating" | "downloading" | "committing">;
    downloadBytesTotal?: number;
    stageBytesTotal?: number;
}

interface SteamCmdLogTailState {
    path: string;
    offset: number;
    remainder: string;
}

const installPathById = new Map<string, string>();
const actionStates = new Map<string, ModActionState>();
const queueItems = new Map<string, DownloadQueueItem>();
const queueOrder: string[] = [];
const queuePending: QueueEntry[] = [];
const workshopTitleCache = new Map<string, CachedWorkshopTitle>();

const runningJobs = new Map<string, RunningJob>();
let queueWorkerActive = false;
let initialized = false;

const cacheRoot = path.join(getLegacyPaths().productDir, "ElectronSpike", "download-manager-cache");
const installStatePath = path.join(cacheRoot, "install-state.json");

function nowIso(): string {
    return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isCacheFresh(isoUtc: string, ttlMs: number): boolean {
    const timestamp = Date.parse(isoUtc);
    if (!Number.isFinite(timestamp)) {
        return false;
    }

    return Date.now() - timestamp < ttlMs;
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

function isPlaceholderModName(workshopId: string, modName: string | undefined): boolean {
    const trimmed = modName?.trim() ?? "";
    if (!trimmed) {
        return true;
    }

    if (trimmed === workshopId) {
        return true;
    }

    return trimmed.toLowerCase() === `workshop mod ${workshopId}`.toLowerCase();
}

async function fetchWorkshopMetadata(workshopId: string): Promise<{ title: string | null; fileSizeBytes: number | null }> {
    const cached = workshopTitleCache.get(workshopId);
    if (cached && isCacheFresh(cached.fetchedAtUtc, WORKSHOP_TITLE_CACHE_TTL_MS)) {
        return {
            title: cached.title,
            fileSizeBytes: cached.fileSizeBytes
        };
    }

    const formData = new URLSearchParams();
    formData.append("itemcount", "1");
    formData.append("publishedfileids[0]", workshopId);

    try {
        const response = await fetch(STEAM_PUBLISHED_DETAILS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: formData.toString()
        });

        if (!response.ok) {
            return {
                title: cached?.title ?? null,
                fileSizeBytes: cached?.fileSizeBytes ?? null
            };
        }

        const payload = (await response.json()) as SteamFileDetailsResponse;
        const detail = (payload.response?.publishedfiledetails ?? [])
            .find((entry) => String(entry.publishedfileid ?? "").trim() === workshopId);
        const title = (detail?.title ?? "").trim();
        const rawFileSize = Number.parseInt(String(detail?.file_size ?? "").trim(), 10);
        const fileSizeBytes = Number.isFinite(rawFileSize) && rawFileSize > 0 ? rawFileSize : null;

        workshopTitleCache.set(workshopId, {
            fetchedAtUtc: nowIso(),
            title: title || cached?.title || null,
            fileSizeBytes
        });

        return {
            title: title || cached?.title || null,
            fileSizeBytes
        };
    } catch {
        return {
            title: cached?.title ?? null,
            fileSizeBytes: cached?.fileSizeBytes ?? null
        };
    }
}

async function fetchWorkshopTitle(workshopId: string): Promise<string | null> {
    const metadata = await fetchWorkshopMetadata(workshopId);
    return metadata.title;
}

async function fetchWorkshopFileSize(workshopId: string): Promise<number | null> {
    const metadata = await fetchWorkshopMetadata(workshopId);
    return metadata.fileSizeBytes;
}

async function resolveQueueModName(workshopId: string, modName: string | undefined): Promise<string> {
    const trimmed = modName?.trim() ?? "";
    if (!isPlaceholderModName(workshopId, trimmed)) {
        return trimmed;
    }

    const fetchedTitle = await fetchWorkshopTitle(workshopId);
    return fetchedTitle || trimmed || workshopId;
}

function upsertQueueItem(
    workshopId: string,
    modName: string,
    action: "install" | "uninstall",
    status: DownloadQueueItem["status"],
    progress: number,
    message: string,
    progressMode: QueueProgressMode = "determinate"
): DownloadQueueItem {
    const next: DownloadQueueItem = {
        workshopId,
        modName,
        action,
        status,
        progress: Math.min(100, Math.max(0, Math.trunc(progress))),
        progressMode,
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

function resolveModsInstallRoot(): string {
    return resolveManagedModsPath(loadSettingsSnapshot());
}

function resolveDescriptorModsRoot(): string {
    return resolveDescriptorModsPath(loadSettingsSnapshot());
}

function resolveDownloadBasePath(): string {
    const settings = loadSettingsSnapshot();
    const configured = settings?.steamCmdDownloadPath?.trim();
    return configured || path.join(getLegacyPaths().productDir, "SteamCmdDownloads");
}

function normalizeDownloadRuntime(value: string | undefined): DownloadRuntime {
    const normalized = value?.trim().toLowerCase() ?? "";
    if (normalized === "steamkit2" || normalized === "steamworks") return "SteamKit2";
    if (normalized === "steamcmd") return "SteamCMD";
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
        return "SteamCMD";
    }

    return "SteamKit2";
}

function hasConfiguredSteamCmd(): boolean {
    const steamCmdPath = loadSettingsSnapshot()?.steamCmdPath?.trim() ?? "";
    return steamCmdPath.length > 0 && fs.existsSync(steamCmdPath);
}

export function getSteamworksFallbackDecision(
    message: string,
    steamCmdAvailable: boolean
): { shouldFallback: boolean; message: string } {
    if (!steamCmdAvailable) {
        return {
            shouldFallback: false,
            message
        };
    }

    if (isStandaloneSteamworksSessionFailure(message)) {
        return {
            shouldFallback: true,
            message: "Steamworks for Stellaris is unavailable in this standalone app session. Retrying with SteamCmd."
        };
    }

    return {
        shouldFallback: false,
        message
    };
}

function getMachineMetrics(metrics?: Partial<MachineMetrics>): MachineMetrics {
    const cpuCount = Math.max(1, Math.trunc(metrics?.cpuCount ?? os.cpus().length ?? 1));
    const totalMemoryGb = Math.max(1, Math.trunc(metrics?.totalMemoryGb ?? Math.floor(os.totalmem() / (1024 ** 3))));
    return {
        cpuCount,
        totalMemoryGb
    };
}

function getRecommendedSteamCmdConcurrency(metrics?: Partial<MachineMetrics>): number {
    void metrics;
    // SteamCMD writes progress into global logs relative to its install root.
    // Restrict it to a single worker so progress stays attributable to one mod.
    return 1;
}

export function getRecommendedSteamCmdConcurrencyForTest(metrics?: Partial<MachineMetrics>): number {
    return getRecommendedSteamCmdConcurrency(metrics);
}

function resolveInstallQueueMode(
    runtime: DownloadRuntime,
    metrics?: Partial<MachineMetrics>
): { mode: "default" | "isolated-workers"; concurrency: number } {
    if (runtime === "SteamCMD") {
        return {
            mode: "isolated-workers",
            concurrency: getRecommendedSteamCmdConcurrency(metrics)
        };
    }

    return {
        mode: "default",
        concurrency: MAX_CONCURRENT_DOWNLOADS
    };
}

export function resolveInstallQueueModeForTest(input: {
    runtime: DownloadRuntime;
    cpuCount?: number;
    totalMemoryGb?: number;
}): { mode: "default" | "isolated-workers"; concurrency: number } {
    return resolveInstallQueueMode(input.runtime, {
        cpuCount: input.cpuCount,
        totalMemoryGb: input.totalMemoryGb
    });
}

export function canStartQueuedAction(
    nextAction: "install" | "uninstall",
    runningActions: Array<"install" | "uninstall">
): boolean {
    if (runningActions.length === 0) {
        return true;
    }

    if (runningActions.includes("uninstall")) {
        return false;
    }

    return nextAction === "install";
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

async function removePathIfExists(
    targetPath: string,
    options?: { strict?: boolean }
): Promise<{ ok: boolean; message?: string }> {
    if (!targetPath) {
        return { ok: true };
    }

    try {
        await fsp.rm(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 6,
            retryDelay: 250
        });
    } catch (error) {
        if (options?.strict !== true) {
            return { ok: true };
        }

        const message = error instanceof Error ? error.message : "Unknown remove error";
        return { ok: false, message: `Failed to remove '${targetPath}': ${message}` };
    }

    if (options?.strict !== true) {
        return { ok: true };
    }

    try {
        await fsp.access(targetPath, fs.constants.F_OK);
        return { ok: false, message: `Failed to remove '${targetPath}': path still exists after retrying.` };
    } catch {
        return { ok: true };
    }
}

// --- Descriptor handling ---

export function upsertQuotedDescriptorField(content: string, key: string, value: string): string {
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const line = `${key}="${escapedValue}"`;
    const re = new RegExp(`^\\s*${key}\\s*=\\s*"[^"]*"\\s*$`, "m");

    if (re.test(content)) return content.replace(re, line);
    const trimmed = content.trimEnd();
    return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function normalizeManagedDescriptorValue(value: string): string {
    return path.normalize(value).replace(/\\/g, "/");
}

function canUseRelativeManagedPath(basePath: string, targetPath: string): boolean {
    const relative = path.relative(basePath, targetPath);
    return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findManagedStellarisRoot(modsRoot: string): string | null {
    let current = path.resolve(modsRoot);
    while (true) {
        if (path.basename(current).trim().toLowerCase() === "stellaris") {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }

        current = parent;
    }
}

export function buildManagedDescriptorPath(input: {
    modsRoot: string;
    installedPath: string;
}): string {
    const modsRoot = path.resolve(input.modsRoot);
    const installedPath = path.resolve(input.installedPath);
    const stellarisDir = findManagedStellarisRoot(modsRoot);
    if (stellarisDir && canUseRelativeManagedPath(stellarisDir, installedPath)) {
        return normalizeManagedDescriptorValue(path.relative(stellarisDir, installedPath));
    }

    return normalizeManagedDescriptorValue(installedPath);
}

export function buildManagedDescriptorReference(input: {
    modsRoot: string;
    descriptorPath: string;
}): string {
    const modsRoot = path.resolve(input.modsRoot);
    const descriptorPath = path.resolve(input.descriptorPath);
    const stellarisDir = findManagedStellarisRoot(modsRoot);
    if (stellarisDir && canUseRelativeManagedPath(stellarisDir, descriptorPath)) {
        return normalizeManagedDescriptorValue(path.relative(stellarisDir, descriptorPath));
    }

    return normalizeManagedDescriptorValue(descriptorPath);
}

export function buildManagedDescriptorPathForTest(input: {
    modsRoot: string;
    installedPath: string;
}): string {
    return buildManagedDescriptorPath(input);
}

export function buildManagedDescriptorReferenceForTest(input: {
    modsRoot: string;
    descriptorPath: string;
}): string {
    return buildManagedDescriptorReference(input);
}

async function deployDownloadedModToModsPath(
    workshopId: string,
    downloadedInstallPath: string,
    reportProgress: (progress: number, message: string, progressMode?: QueueProgressMode) => void,
    keepSource = false
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const installRoot = resolveModsInstallRoot();
    const descriptorRoot = resolveDescriptorModsRoot();
    const finalInstallPath = path.join(installRoot, workshopId);
    const finalDescriptorPath = path.join(descriptorRoot, `${workshopId}.mod`);

    try {
        await Promise.all([
            fsp.mkdir(installRoot, { recursive: true }),
            fsp.mkdir(descriptorRoot, { recursive: true })
        ]);
    } catch {
        return {
            ok: false,
            installPath: finalInstallPath,
            message: `Could not create the configured managed mods folders.`
        };
    }

    reportProgress(96, `Deploying ${workshopId} to managed mods folder...`);

    try {
        await removePathIfExists(finalInstallPath);
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
    descriptorContent = upsertQuotedDescriptorField(
        descriptorContent,
        "path",
        buildManagedDescriptorPath({
            modsRoot: descriptorRoot,
            installedPath: finalInstallPath
        })
    );

    try {
        await fsp.writeFile(finalDescriptorPath, descriptorContent, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : "Descriptor write failed";
        return { ok: false, installPath: finalInstallPath, message: `Failed to write descriptor: ${message}` };
    }

    if (!keepSource && path.resolve(downloadedInstallPath) !== path.resolve(finalInstallPath)) {
        await removePathIfExists(downloadedInstallPath);
    }

    return { ok: true, installPath: finalInstallPath, message: `Installed to managed mods folder: ${finalInstallPath}` };
}

// --- Steamworks download (primary) ---

async function runSteamworksInstall(
    entry: { workshopId: string; modName: string },
    job: RunningJob,
    reportProgress: (progress: number, message: string, progressMode?: QueueProgressMode) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const downloadResult = await runSteamworksDownload(entry.workshopId, job, reportProgress);
    if (!downloadResult.ok) return downloadResult;

    // Deploy from Steam's workshop cache to the Stellaris mods folder.
    // keepSource=true because the source is Steam's workshop cache — we must not delete it.
    reportProgress(90, `Deploying ${entry.workshopId} to managed mods folder...`, "determinate");
    const deployed = await deployDownloadedModToModsPath(entry.workshopId, downloadResult.installPath, reportProgress, true);
    if (!deployed.ok) return deployed;

    installPathById.set(entry.workshopId, deployed.installPath);
    await saveInstallState();

    return { ok: true, installPath: deployed.installPath, message: deployed.message };
}

// --- SteamCMD download (fallback) ---

function normalizeSteamCmdProgress(progress: number): number | null {
    if (!Number.isFinite(progress)) return null;
    return Math.max(1, Math.min(95, Math.round(progress)));
}

// Removed duplicate formatSteamCmdSizeLabel

function splitSteamCmdOutputLines(text: string): string[] {
    return text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function formatSteamCmdSizeLabel(totalBytes: number | null): string | null {
    if (!Number.isFinite(totalBytes) || (totalBytes ?? 0) <= 0) {
        return null;
    }

    const units = [
        { unit: "GB", size: 1024 ** 3, decimals: 2 },
        { unit: "MB", size: 1024 ** 2, decimals: 1 },
        { unit: "KB", size: 1024, decimals: 1 }
    ];
    const selected = units.find((entry) => (totalBytes ?? 0) >= entry.size) ?? units[units.length - 1];
    return `${((totalBytes ?? 0) / selected.size).toFixed(selected.decimals)} ${selected.unit}`;
}

async function createSteamCmdLogTailState(logPath: string): Promise<SteamCmdLogTailState> {
    try {
        const stat = await fsp.stat(logPath);
        return {
            path: logPath,
            offset: stat.size,
            remainder: ""
        };
    } catch {
        return {
            path: logPath,
            offset: 0,
            remainder: ""
        };
    }
}

async function readSteamCmdLogTailLines(state: SteamCmdLogTailState): Promise<string[]> {
    try {
        const stat = await fsp.stat(state.path);
        const fileSize = stat.size;
        if (fileSize < state.offset) {
            state.offset = 0;
            state.remainder = "";
        }
        if (fileSize === state.offset) {
            return [];
        }

        const handle = await fsp.open(state.path, "r");
        try {
            const nextChunk = Buffer.alloc(fileSize - state.offset);
            const readResult = await handle.read(nextChunk, 0, nextChunk.length, state.offset);
            state.offset = fileSize;

            const combined = state.remainder + nextChunk.subarray(0, readResult.bytesRead).toString("utf8");
            const parts = combined.split(/\r?\n/);
            state.remainder = parts.pop() ?? "";
            return parts.map((line) => line.trim()).filter((line) => line.length > 0);
        } finally {
            await handle.close();
        }
    } catch {
        return [];
    }
}

function parseSteamCmdContentLogLine(line: string): SteamCmdContentLogEvent | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    const updateStartedMatch = trimmed.match(/update started\s*:\s*download\s+\d+\/(\d+).*stage\s+\d+\/(\d+)/i);
    if (updateStartedMatch) {
        return {
            phase: "downloading",
            downloadBytesTotal: Number.parseInt(updateStartedMatch[1] ?? "", 10),
            stageBytesTotal: Number.parseInt(updateStartedMatch[2] ?? "", 10)
        };
    }

    if (/Workshop update changed\s*:\s*.*Preallocating/i.test(trimmed)) {
        return { phase: "preallocating" };
    }

    if (/Workshop update changed\s*:\s*.*Downloading,Staging/i.test(trimmed)) {
        return { phase: "downloading" };
    }

    if (/Workshop update changed\s*:\s*.*Committing/i.test(trimmed) || /starting commit from /i.test(trimmed)) {
        return { phase: "committing" };
    }

    return null;
}

function buildSteamCmdPhaseProgress(input: {
    workshopId: string;
    previousProgress: number;
    phase: Extract<SteamCmdPhase, "preallocating" | "downloading" | "committing">;
    downloadBytesTotal?: number | null;
    stageBytesTotal?: number | null;
}): SteamCmdPhaseUpdate {
    const downloadSizeLabel = formatSteamCmdSizeLabel(input.downloadBytesTotal ?? null);
    const stageSizeLabel = formatSteamCmdSizeLabel(input.stageBytesTotal ?? null);

    if (input.phase === "preallocating") {
        return {
            progress: 25,
            progressMode: "indeterminate",
            message: stageSizeLabel
                ? `Preparing ${stageSizeLabel} of staged files...`
                : "Preparing staged files..."
        };
    }

    if (input.phase === "committing") {
        return {
            progress: 75,
            progressMode: "indeterminate",
            message: stageSizeLabel
                ? `Committing ${stageSizeLabel} of staged files...`
                : "Committing staged files..."
        };
    }

    const hasDistinctTransferSize = (input.downloadBytesTotal ?? 0) > 0
        && (input.stageBytesTotal ?? 0) > (input.downloadBytesTotal ?? 0) * 1.05;

    let message = "Downloading from Steam...";
    if (downloadSizeLabel && stageSizeLabel && hasDistinctTransferSize) {
        message = `Downloading from Steam... ${downloadSizeLabel} transfer for ${stageSizeLabel} installed data.`;
    } else if (downloadSizeLabel) {
        message = `Downloading from Steam... ${downloadSizeLabel} total.`;
    } else if (stageSizeLabel) {
        message = `Downloading from Steam... Final size ${stageSizeLabel}.`;
    }

    return {
        progress: 50,
        progressMode: "indeterminate",
        message
    };
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
    reportProgress: (progress: number, message: string, progressMode?: QueueProgressMode) => void
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
        await removePathIfExists(candidate);
    }
    const steamCmdLogDir = path.join(path.dirname(steamCmdPath), "logs");
    const [contentLogTail, consoleLogTail] = await Promise.all([
        createSteamCmdLogTailState(path.join(steamCmdLogDir, "content_log.txt")),
        createSteamCmdLogTailState(path.join(steamCmdLogDir, "console_log.txt"))
    ]);

    const args = [
        "+force_install_dir", forceInstallDir,
        "+login", "anonymous",
        "+workshop_download_item", STELLARIS_APP_ID, workshopId, "validate",
        "+quit"
    ];

    const statusHints: string[] = [];
    let explicitFailureMessage: string | null = null;
    let reportedProgress = 0;
    let reportedProgressMode: QueueProgressMode = "determinate";
    const emitSteamCmdProgress = (
        progress: number | null,
        message: string,
        options?: { floor?: number; progressMode?: QueueProgressMode }
    ): void => {
        const floor = options?.floor ?? 0;
        const nextProgress = Math.max(
            reportedProgress,
            floor,
            progress ?? reportedProgress
        );
        reportedProgress = nextProgress;
        if (options?.progressMode) {
            reportedProgressMode = options.progressMode;
        } else if (progress !== null) {
            reportedProgressMode = "determinate";
        }
        reportProgress(nextProgress, message, reportedProgressMode);
    };
    emitSteamCmdProgress(6, `Launching SteamCMD for ${workshopId}...`);

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

    let lastObservedBytes = 0;
    let hasExplicitSteamCmdProgress = false;
    let phaseState: {
        phase: Extract<SteamCmdPhase, "preallocating" | "downloading" | "committing">;
        downloadBytesTotal: number | null;
        stageBytesTotal: number | null;
    } = {
        phase: "downloading",
        downloadBytesTotal: null,
        stageBytesTotal: null
    };
    let lastPhaseSignature = "";
    const applyPhaseEvent = (event: SteamCmdContentLogEvent): void => {
        let didChange = false;

        if (typeof event.downloadBytesTotal === "number" && Number.isFinite(event.downloadBytesTotal) && event.downloadBytesTotal > 0) {
            phaseState.downloadBytesTotal = event.downloadBytesTotal;
            didChange = true;
        }

        if (typeof event.stageBytesTotal === "number" && Number.isFinite(event.stageBytesTotal) && event.stageBytesTotal > 0) {
            phaseState.stageBytesTotal = event.stageBytesTotal;
            didChange = true;
        }

        if (event.phase && phaseState.phase !== event.phase) {
            phaseState.phase = event.phase;
            didChange = true;
        }

        if (!didChange) {
            return;
        }

        const phaseSignature = JSON.stringify([
            phaseState.phase,
            phaseState.downloadBytesTotal,
            phaseState.stageBytesTotal
        ]);
        if (phaseSignature === lastPhaseSignature) {
            return;
        }
        lastPhaseSignature = phaseSignature;

        if (hasExplicitSteamCmdProgress && phaseState.phase === "downloading") {
            return;
        }

        const phaseProgress = buildSteamCmdPhaseProgress({
            workshopId,
            previousProgress: reportedProgress,
            phase: phaseState.phase,
            downloadBytesTotal: phaseState.downloadBytesTotal,
            stageBytesTotal: phaseState.stageBytesTotal
        });
        emitSteamCmdProgress(phaseProgress.progress, phaseProgress.message, {
            floor: phaseProgress.progress,
            progressMode: phaseProgress.progressMode
        });
    };

    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        const child = spawn(steamCmdPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });

        job.process = child;

        let timedOut = false;
        let stalled = false;
        let lastActivityAt = Date.now();
        let stopProgressPoll = false;
        const markActivity = (): void => {
            lastActivityAt = Date.now();
        };
        const timeout = setTimeout(() => {
            timedOut = true;
            try { child.kill(); } catch { /* ignore */ }
        }, STEAMCMD_TIMEOUT_MS);
        const stallWatch = setInterval(() => {
            if (Date.now() - lastActivityAt < STEAMCMD_STALL_MS) {
                return;
            }

            stalled = true;
            try { child.kill(); } catch { /* ignore */ }
        }, 5000);
        const progressPoll = async (): Promise<void> => {
            while (!stopProgressPoll) {
                try {
                    const [contentLogLines, consoleLogLines] = await Promise.all([
                        readSteamCmdLogTailLines(contentLogTail),
                        readSteamCmdLogTailLines(consoleLogTail)
                    ]);

                    for (const line of contentLogLines) {
                        markActivity();
                        const event = parseSteamCmdContentLogLine(line);
                        if (event) {
                            applyPhaseEvent(event);
                        }
                    }

                    for (const line of consoleLogLines) {
                        markActivity();
                        if (new RegExp(`Downloading item\\s+${workshopId}\\s+\\.\\.\\.`, "i").test(line)) {
                            applyPhaseEvent({ phase: "downloading" });
                        }
                    }
                } catch {
                    // ignore transient log and filesystem errors while SteamCMD is active
                }

                if (stopProgressPoll) {
                    break;
                }

                await sleep(STEAMCMD_PROGRESS_POLL_MS);
            }
        };
        void progressPoll();

        child.stdout.on("data", (chunk) => {
            markActivity();
            const text = chunk.toString("utf8");
            for (const trimmed of splitSteamCmdOutputLines(text)) {
                appendStatusHint(trimmed);
            }
        });

        child.stderr.on("data", (chunk) => {
            markActivity();
            const text = chunk.toString("utf8");
            for (const trimmed of splitSteamCmdOutputLines(text)) {
                emitSteamCmdProgress(null, `SteamCMD: ${trimmed}`, {
                    floor: 6,
                    progressMode: "indeterminate"
                });
                appendStatusHint(trimmed);
            }
        });

        child.on("error", (error) => {
            stopProgressPoll = true;
            clearTimeout(timeout);
            clearInterval(stallWatch);
            resolve({ ok: false, message: error.message });
        });

        child.on("close", (code) => {
            stopProgressPoll = true;
            clearTimeout(timeout);
            clearInterval(stallWatch);
            if (timedOut) { resolve({ ok: false, message: "SteamCMD download timed out." }); return; }
            if (stalled) { resolve({ ok: false, message: "SteamCMD download stalled." }); return; }
            if (job.cancelled) { resolve({ ok: false, message: "Download cancelled." }); return; }
            if (code !== 0) { resolve({ ok: false, message: `SteamCMD exited with code ${String(code)}` }); return; }
            resolve({ ok: true, message: "SteamCMD reported success." });
        });
    });

    if (!result.ok) {
        // Clean up the temp dir on failure
        await removePathIfExists(forceInstallDir);
        return { ok: false, installPath: outputCandidates[0] ?? "", message: result.message };
    }

    if (explicitFailureMessage) {
        await removePathIfExists(forceInstallDir);
        return { ok: false, installPath: outputCandidates[0] ?? "", message: `SteamCMD reported download failure: ${explicitFailureMessage}` };
    }

    emitSteamCmdProgress(94, `Verifying downloaded files for ${workshopId}...`, {
        floor: 94,
        progressMode: "determinate"
    });
    const located = await findDownloadedWorkshopPath(outputCandidates);
    if (!located.foundPath) {
        const hint = statusHints.length > 0 ? ` Last SteamCMD output: ${statusHints.join(" | ")}` : "";
        await removePathIfExists(forceInstallDir);
        return {
            ok: false,
            installPath: outputCandidates[0] ?? "",
            message: located.hadEmptyPath
                ? `SteamCMD finished but download folder is empty.${hint}`
                : `SteamCMD finished but download folder was not found.${hint}`
        };
    }

    const deployed = await deployDownloadedModToModsPath(
        workshopId,
        located.foundPath,
        (progress, message, progressMode) => {
            emitSteamCmdProgress(progress, message, {
                floor: progress,
                progressMode
            });
        }
    );

    // Clean up the temp download dir (the whole dl-{workshopId} folder)
    await removePathIfExists(forceInstallDir);

    if (!deployed.ok) return deployed;

    installPathById.set(workshopId, deployed.installPath);
    await saveInstallState();

    return { ok: true, installPath: deployed.installPath, message: deployed.message };
}

async function runUninstall(workshopId: string): Promise<{ ok: boolean; message: string }> {
    const failures: string[] = [];
    const removeStrict = async (targetPath: string): Promise<void> => {
        const result = await removePathIfExists(targetPath, { strict: true });
        if (!result.ok && result.message) {
            failures.push(result.message);
        }
    };

    const knownPath = installPathById.get(workshopId);
    if (knownPath) {
        await removeStrict(knownPath);
        const descriptorPath = path.join(resolveDescriptorModsRoot(), `${workshopId}.mod`);
        await removeStrict(descriptorPath);
    } else {
        const modsRoot = resolveModsInstallRoot();
        const descriptorRoot = resolveDescriptorModsRoot();
        await removeStrict(path.join(modsRoot, workshopId));
        await removeStrict(path.join(descriptorRoot, `${workshopId}.mod`));

        const discovery = discoverSteamLibraries();
        for (const library of discovery.libraries) {
            const candidate = path.join(library.workshopContentPath, workshopId);
            await removeStrict(candidate);
        }
    }

    if (failures.length > 0) {
        return {
            ok: false,
            message: failures[0]
        };
    }

    installPathById.delete(workshopId);
    await saveInstallState();

    return { ok: true, message: "Uninstall completed." };
}

// --- Queue worker ---

async function runJob(entry: QueueEntry): Promise<void> {
    const job: RunningJob = {
        workshopId: entry.workshopId,
        action: entry.action,
        process: null,
        cancelled: false,
        sharedProcess: false
    };

    runningJobs.set(entry.workshopId, job);
    try {
        if (entry.action === "install") {
            const runtime = resolveEffectiveRuntime();
            actionStates.set(entry.workshopId, "installing");
            upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", 3, "Preparing download...");

            let installResult = runtime === "SteamCMD"
                ? await runSteamCmdDownload(entry.workshopId, job, (progress, message, progressMode) => {
                    upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", progress, message, progressMode);
                })
                : runtime === "SteamKit2"
                    ? await runSteamworksInstall(entry, job, (progress, message, progressMode) => {
                        upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", progress, message, progressMode);
                    })
                    : {
                        ok: false,
                        installPath: "",
                        message: "SteamKit2/Steamworks downloads are not available in this build. Select SteamCmd runtime in Settings."
                    };

            if (!installResult.ok && runtime === "SteamKit2") {
                const fallback = getSteamworksFallbackDecision(installResult.message, hasConfiguredSteamCmd());
                if (fallback.shouldFallback) {
                    logInfo(`Download queue: Steamworks install for ${entry.workshopId} is unavailable in this session. Falling back to SteamCmd.`);
                    upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", 4, fallback.message);
                    installResult = await runSteamCmdDownload(entry.workshopId, job, (progress, message, progressMode) => {
                        upsertQueueItem(entry.workshopId, entry.modName, entry.action, "running", progress, message, progressMode);
                    });
                } else if (
                    !hasConfiguredSteamCmd()
                    && isStandaloneSteamworksSessionFailure(installResult.message)
                    && installResult.message === getSteamworksUnavailableMessage()
                ) {
                    installResult = {
                        ok: false,
                        installPath: "",
                        message: "Steamworks for Stellaris is unavailable in this standalone app session, and SteamCmd is not configured."
                    };
                }
            }

            if (job.cancelled) {
                actionStates.set(entry.workshopId, "not-installed");
                upsertQueueItem(entry.workshopId, entry.modName, entry.action, "cancelled", 0, "Install cancelled.");
            } else if (installResult.ok) {
                actionStates.set(entry.workshopId, "installed");
                upsertQueueItem(entry.workshopId, entry.modName, entry.action, "completed", 100, installResult.message);
                logInfo(`Download queue: completed install for ${entry.workshopId}.`);
            } else {
                actionStates.set(entry.workshopId, "error");
                upsertQueueItem(entry.workshopId, entry.modName, entry.action, "failed", 0, installResult.message);
                logError(`Download queue: install failed for ${entry.workshopId}: ${installResult.message}`);
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
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown queue error.";
        actionStates.set(entry.workshopId, "error");
        upsertQueueItem(entry.workshopId, entry.modName, entry.action, "failed", 0, `Unexpected queue error: ${message}`);
        logError(`Download queue: unexpected ${entry.action} error for ${entry.workshopId}: ${message}`);
    } finally {
        runningJobs.delete(entry.workshopId);
        emitSnapshot();
    }
}

async function processQueue(): Promise<void> {
    if (queueWorkerActive) return;
    queueWorkerActive = true;

    try {
        // Keep the worker alive while there is queued work or active jobs.
        // This prevents new items from being stranded if they are queued
        // after the pending list briefly drains but before active jobs finish.
        while (queuePending.length > 0 || runningJobs.size > 0) {
            let launchedJob = false;

            while (queuePending.length > 0) {
                const next = queuePending[0];
                if (!next) break;

                const runtime = next.action === "install" ? resolveEffectiveRuntime() : "SteamCMD";
                const queueMode = next.action === "install"
                    ? resolveInstallQueueMode(runtime)
                    : { mode: "default" as const, concurrency: MAX_CONCURRENT_DOWNLOADS };
                if (runningJobs.size >= queueMode.concurrency) {
                    break;
                }

                const runningActions = Array.from(runningJobs.values(), (job) => job.action);
                if (!canStartQueuedAction(next.action, runningActions)) {
                    break;
                }

                queuePending.shift();

                logInfo(`Download queue: starting ${next.action} for ${next.workshopId} (${runningJobs.size + 1}/${queueMode.concurrency} slots)`);
                // Don't await — fire-and-forget to enable queue throughput.
                const runner = runJob(next);
                void runner.catch((err) => {
                    logError(`Download job failed for ${next.workshopId}: ${err instanceof Error ? err.message : "unknown"}`);
                });
                launchedJob = true;

                // Small delay to stagger process launches
                await sleep(200);
            }

            if (queuePending.length === 0 && runningJobs.size === 0) {
                break;
            }

            if (!launchedJob) {
                await sleep(250);
            }
        }
    } finally {
        queueWorkerActive = false;

        if (queuePending.length > 0) {
            void processQueue();
        }
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

export async function resolveQueueModNameForTest(workshopId: string, modName?: string): Promise<string> {
    return resolveQueueModName(workshopId, modName);
}


export function parseSteamCmdContentLogLineForTest(line: string): SteamCmdContentLogEvent | null {
    return parseSteamCmdContentLogLine(line);
}

export function buildSteamCmdPhaseProgressForTest(input: {
    workshopId: string;
    previousProgress: number;
    phase: Extract<SteamCmdPhase, "preallocating" | "downloading" | "committing">;
    downloadBytesTotal?: number | null;
    stageBytesTotal?: number | null;
}): SteamCmdPhaseUpdate {
    return buildSteamCmdPhaseProgress(input);
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

    const modName = await resolveQueueModName(workshopId, request.modName);
    queuePending.push({
        workshopId,
        modName,
        action: request.action
    });
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
