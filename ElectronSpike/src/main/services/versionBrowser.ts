import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type {
    VersionBrowserQuery,
    VersionBrowserResult,
    VersionModActionRequest,
    VersionModActionResult,
    VersionModCard,
    VersionModDetail,
    VersionOption,
    VersionQueueCommandResult,
    VersionQueueItem,
    VersionQueueSnapshot,
    VersionSortMode,
    WorkshopSortMode
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { loadSettingsSnapshot } from "./settings";
import { discoverSteamLibraries } from "./steamDiscovery";
import { scrapeSteamWorkshopPage } from "./workshopBrowser";

const STELLARIS_APP_ID = "281990";
const STELLARISYNC_BASE_URL = process.env.STELLARISYNC_BASE_URL?.trim() || "https://stellarisync.rrmtools.uk";
const STEAM_PUBLISHED_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const DEFAULT_PAGE_SIZE = 30;
const MIN_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 60;
const MAP_CACHE_TTL_MS = 4 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 20 * 60 * 1000;
const THUMBNAIL_CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;
const STEAMCMD_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_STEAM_PAGE_PROBES_PER_QUERY = 20;

const knownVersions: Readonly<Record<string, string>> = {
    "4.3": "Cetus",
    "4.2": "Corvus",
    "4.1": "Lyra",
    "4.0": "Phoenix",
    "3.14": "Circinus",
    "3.13": "Vela",
    "3.12": "Andromeda",
    "3.11": "Eridanus",
    "3.10": "Pyxis",
    "3.9": "Caelum",
    "3.8": "Gemini",
    "3.7": "Canis Minor",
    "3.6": "Orion",
    "3.5": "Fornax",
    "3.4": "Cepheus",
    "3.3": "Libra",
    "3.2": "Herbert",
    "3.1": "Lem",
    "3.0": "Dick",
    "2.8": "Butler",
    "2.7": "Wells",
    "2.6": "Verne",
    "2.5": "Shelley",
    "2.4": "Lee",
    "2.3": "Wolfe",
    "2.2": "Le Guin",
    "2.1": "Niven",
    "2.0": "Cherryh",
    "1.9": "Boulle",
    "1.8": "Capek",
    "1.6": "Adams",
    "1.5": "Banks",
    "1.4": "Kennedy",
    "1.3": "Heinlein",
    "1.2": "Asimov",
    "1.1": "Clarke",
    "1.0": "Release"
};

interface VersionMapsCache {
    fetchedAt: number;
    versions: Record<string, string>;
    communityCompat: Record<string, Record<string, CommunityCompatEntry>>;
}

interface CommunityCompatEntry {
    count?: number;
    workedCount?: number;
    notWorkedCount?: number;
}

interface SteamFileDetailsResponse {
    response?: {
        publishedfiledetails?: SteamPublishedFileDetails[];
    };
}

interface SteamPreview {
    previewurl?: string;
}

interface SteamTag {
    tag?: string;
}

interface SteamPublishedFileDetails {
    publishedfileid?: string;
    title?: string;
    file_description?: string;
    preview_url?: string;
    previews?: SteamPreview[];
    tags?: SteamTag[];
    lifetime_subscriptions?: string | number;
}

interface CachedFileDetails {
    fetchedAtUtc: string;
    detail: SteamPublishedFileDetails;
}

interface CachedResultCard {
    workshopId: string;
    workshopUrl: string;
    name: string;
    gameVersionBadge: string;
    previewImageUrl: string | null;
    totalSubscribers: number;
    communityWorksCount: number;
    communityNotWorksCount: number;
    communityWorksPercent: number;
}

interface CachedResultEntry {
    cachedAtUtc: string;
    cards: CachedResultCard[];
    steamPage: number;
    exhausted: boolean;
}

interface InstallStateStore {
    byWorkshopId: Record<string, string>;
}

interface DetailCacheStore {
    byWorkshopId: Record<string, CachedFileDetails>;
}

interface ResultCacheStore {
    byQueryKey: Record<string, CachedResultEntry>;
}

interface RunningJob {
    workshopId: string;
    action: "install" | "uninstall";
    process: ChildProcess | null;
    cancelled: boolean;
}

const cacheRoot = path.join(getLegacyPaths().productDir, "ElectronSpike", "version-browser-cache");
const thumbnailsDir = path.join(cacheRoot, "thumbnails");
const mapsCachePath = path.join(cacheRoot, "maps-cache.json");
const detailsCachePath = path.join(cacheRoot, "details-cache.json");
const resultsCachePath = path.join(cacheRoot, "results-cache.json");
const installStatePath = path.join(cacheRoot, "install-state.json");

let initialized = false;
let mapsCache: VersionMapsCache | null = null;
let detailCacheById = new Map<string, CachedFileDetails>();
let resultCacheByKey = new Map<string, CachedResultEntry>();
let installPathById = new Map<string, string>();

const actionStates = new Map<string, VersionModCard["actionState"]>();
const queueItems = new Map<string, VersionQueueItem>();
const queueOrder: string[] = [];
const queuePending: Array<{ workshopId: string; action: "install" | "uninstall" }> = [];
const queueMessages = new Map<string, string>();

let runningJob: RunningJob | null = null;
let queueWorkerActive = false;

function nowIso(): string {
    return new Date().toISOString();
}

function parseSemverParts(value: string): [number, number, number] {
    const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) {
        return [0, 0, 0];
    }

    return [
        Number.parseInt(match[1] ?? "0", 10),
        Number.parseInt(match[2] ?? "0", 10),
        Number.parseInt(match[3] ?? "0", 10)
    ];
}

function compareVersionsDescending(a: string, b: string): number {
    const av = parseSemverParts(a);
    const bv = parseSemverParts(b);

    for (let i = 0; i < 3; i += 1) {
        if (av[i] !== bv[i]) {
            return bv[i] - av[i];
        }
    }

    return b.localeCompare(a);
}

function normalizeMajorMinor(value: string): string | null {
    const match = value.match(/(\d+\.\d+)/);
    return match ? match[1] : null;
}

function normalizePatch(value: string): string | null {
    const match = value.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : null;
}

function clampPageSize(value: number | undefined): number {
    if (!value || Number.isNaN(value)) {
        return DEFAULT_PAGE_SIZE;
    }

    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(value)));
}

function normalizeActionState(state: string | undefined): VersionModCard["actionState"] {
    switch ((state ?? "").trim().toLowerCase()) {
        case "queued":
        case "installing":
        case "installed":
        case "uninstalling":
        case "error":
            return state!.trim().toLowerCase() as VersionModCard["actionState"];
        default:
            return "not-installed";
    }
}

function sanitizeWorkshopId(value: string): string {
    return value.trim();
}

function isValidWorkshopId(value: string): boolean {
    return /^\d{6,}$/.test(value);
}

function stripHtml(value: string): string {
    return value
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

function getQueueItem(workshopId: string): VersionQueueItem | undefined {
    return queueItems.get(workshopId);
}

function isQueueItemActive(item: VersionQueueItem | undefined): boolean {
    if (!item) {
        return false;
    }

    return item.status === "queued" || item.status === "running";
}

function upsertQueueItem(
    workshopId: string,
    action: "install" | "uninstall",
    status: VersionQueueItem["status"],
    progress: number,
    message: string
): VersionQueueItem {
    const existing = queueItems.get(workshopId);
    const next: VersionQueueItem = {
        workshopId,
        action,
        status,
        progress: Math.min(100, Math.max(0, Math.trunc(progress))),
        message,
        updatedAtUtc: nowIso()
    };

    queueItems.set(workshopId, next);
    if (!existing) {
        queueOrder.unshift(workshopId);
    } else if (status === "queued") {
        const index = queueOrder.indexOf(workshopId);
        if (index > 0) {
            queueOrder.splice(index, 1);
            queueOrder.unshift(workshopId);
        }
    }

    queueMessages.set(workshopId, message);
    return next;
}

function removePendingQueueItem(workshopId: string): { workshopId: string; action: "install" | "uninstall" } | null {
    const index = queuePending.findIndex((entry) => entry.workshopId === workshopId);
    if (index < 0) {
        return null;
    }

    const [removed] = queuePending.splice(index, 1);
    return removed ?? null;
}

function getQueueSnapshot(): VersionQueueSnapshot {
    const items = Array.from(new Set(queueOrder))
        .map((workshopId) => queueItems.get(workshopId))
        .filter((item): item is VersionQueueItem => item !== undefined)
        .slice(0, 40);

    const hasActiveWork = items.some((item) => item.status === "queued" || item.status === "running")
        || queuePending.length > 0
        || runningJob !== null;

    return { items, hasActiveWork };
}

function purgeQueueItems(workshopIds: string[]): number {
    const uniqueIds = Array.from(new Set(workshopIds));
    let removed = 0;

    for (const workshopId of uniqueIds) {
        if (!queueItems.has(workshopId)) {
            continue;
        }

        queueItems.delete(workshopId);
        queueMessages.delete(workshopId);

        const orderIndex = queueOrder.indexOf(workshopId);
        if (orderIndex >= 0) {
            queueOrder.splice(orderIndex, 1);
        }

        removed += 1;
    }

    return removed;
}

function buildVersionOptions(includeOlderVersions: boolean): VersionOption[] {
    const preferred = ["4.3", "4.2", "4.1", "4.0", "3.14", "3.13", "3.12", "3.11", "3.10"];
    const all = new Set<string>(preferred);

    for (const version of Object.keys(knownVersions)) {
        if (!includeOlderVersions && compareVersionsDescending(version, "3.0") > 0) {
            continue;
        }

        all.add(version);
    }

    return Array.from(all)
        .sort(compareVersionsDescending)
        .map((version) => {
            const codename = knownVersions[normalizeMajorMinor(version) ?? ""];
            return {
                version,
                displayName: codename ? `${version} - ${codename}` : version
            };
        });
}

function versionMatchesSelection(confirmedVersion: string, selectedVersion: string): boolean {
    const selectedPatch = normalizePatch(selectedVersion);
    if (!selectedPatch) {
        return false;
    }

    const confirmedPatch = normalizePatch(confirmedVersion);
    if (!confirmedPatch) {
        return false;
    }

    const selectedHasPatch = /^\d+\.\d+\.\d+$/.test(selectedPatch);
    if (selectedHasPatch) {
        if (confirmedPatch.startsWith(selectedPatch)) {
            return true;
        }

        // If confirmed data only has major.minor, allow a patch-selected query to match that family.
        const confirmedHasPatch = /^\d+\.\d+\.\d+$/.test(confirmedPatch);
        if (!confirmedHasPatch) {
            const selectedMajorMinor = normalizeMajorMinor(selectedPatch);
            const confirmedMajorMinor = normalizeMajorMinor(confirmedPatch);
            return selectedMajorMinor !== null && selectedMajorMinor === confirmedMajorMinor;
        }

        return false;
    }

    const selectedMajorMinor = normalizeMajorMinor(selectedPatch);
    const confirmedMajorMinor = normalizeMajorMinor(confirmedPatch);
    return selectedMajorMinor !== null && selectedMajorMinor === confirmedMajorMinor;
}

function communityVersionMatchesSelection(
    communityByVersion: Record<string, CommunityCompatEntry> | undefined,
    selectedVersion: string
): boolean {
    if (!communityByVersion) {
        return false;
    }

    const selectedPatch = normalizePatch(selectedVersion);
    if (!selectedPatch) {
        return false;
    }

    const selectedMajorMinor = normalizeMajorMinor(selectedPatch);
    if (!selectedMajorMinor) {
        return false;
    }

    const selectedHasPatch = /^\d+\.\d+\.\d+$/.test(selectedPatch);

    for (const versionKey of Object.keys(communityByVersion)) {
        const keyPatch = normalizePatch(versionKey);
        if (!keyPatch) {
            continue;
        }

        if (selectedHasPatch && keyPatch === selectedPatch) {
            return true;
        }

        const keyMajorMinor = normalizeMajorMinor(keyPatch);
        if (keyMajorMinor && keyMajorMinor === selectedMajorMinor) {
            return true;
        }
    }

    return false;
}

function getCommunityStats(
    communityMap: Record<string, Record<string, CommunityCompatEntry>>,
    workshopId: string,
    selectedVersion: string
): { works: number; notWorks: number; percent: number } {
    const byVersion = communityMap[workshopId] ?? {};
    const selectedPatch = normalizePatch(selectedVersion);
    const selectedMajorMinor = selectedPatch ? normalizeMajorMinor(selectedPatch) : null;

    const versionKey = selectedPatch && byVersion[selectedPatch]
        ? selectedPatch
        : selectedMajorMinor && byVersion[selectedMajorMinor]
            ? selectedMajorMinor
            : null;

    const entry = versionKey ? byVersion[versionKey] : undefined;
    if (!entry) {
        return { works: 0, notWorks: 0, percent: 0 };
    }

    const works = Number(entry.workedCount ?? entry.count ?? 0);
    const notWorks = Number(entry.notWorkedCount ?? 0);
    const total = works + notWorks;
    const percent = total > 0 ? Math.round((works * 100) / total) : 0;
    return { works, notWorks, percent };
}

function computeSortScore(card: CachedResultCard): number {
    const communityWeight = card.communityWorksPercent * 1000;
    const reportWeight = (card.communityWorksCount + card.communityNotWorksCount) * 10;
    const subscriberWeight = Math.min(card.totalSubscribers, 2_000_000) / 100;
    return communityWeight + reportWeight + subscriberWeight;
}

function sortCards(cards: CachedResultCard[], sortMode: VersionSortMode): CachedResultCard[] {
    const cloned = cards.slice();

    if (sortMode === "most-subscribed") {
        return cloned.sort((a, b) => b.totalSubscribers - a.totalSubscribers || b.workshopId.localeCompare(a.workshopId));
    }

    if (sortMode === "most-popular") {
        return cloned.sort((a, b) => {
            const bScore = b.totalSubscribers + (b.communityWorksPercent * 5000);
            const aScore = a.totalSubscribers + (a.communityWorksPercent * 5000);
            return bScore - aScore || b.workshopId.localeCompare(a.workshopId);
        });
    }

    return cloned.sort((a, b) => computeSortScore(b) - computeSortScore(a) || b.workshopId.localeCompare(a.workshopId));
}

function isCacheFresh(isoUtc: string, ttlMs: number): boolean {
    const timestamp = Date.parse(isoUtc);
    if (!Number.isFinite(timestamp)) {
        return false;
    }

    return Date.now() - timestamp < ttlMs;
}

async function fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
        }

        return (await response.json()) as T;
    } finally {
        clearTimeout(timeout);
    }
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
    if (initialized) {
        return;
    }

    await fsp.mkdir(cacheRoot, { recursive: true });
    await fsp.mkdir(thumbnailsDir, { recursive: true });

    const [maps, details, results, installState] = await Promise.all([
        readJsonFile<VersionMapsCache | null>(mapsCachePath, null),
        readJsonFile<DetailCacheStore>(detailsCachePath, { byWorkshopId: {} }),
        readJsonFile<ResultCacheStore>(resultsCachePath, { byQueryKey: {} }),
        readJsonFile<InstallStateStore>(installStatePath, { byWorkshopId: {} })
    ]);

    mapsCache = maps;
    detailCacheById = new Map(Object.entries(details.byWorkshopId ?? {}));
    resultCacheByKey = new Map(Object.entries(results.byQueryKey ?? {}));
    installPathById = new Map(Object.entries(installState.byWorkshopId ?? {}));

    initialized = true;
}

async function saveMapsCache(): Promise<void> {
    if (!mapsCache) {
        return;
    }

    await writeJsonFile(mapsCachePath, mapsCache);
}

async function saveDetailsCache(): Promise<void> {
    await writeJsonFile(detailsCachePath, {
        byWorkshopId: Object.fromEntries(detailCacheById.entries())
    } satisfies DetailCacheStore);
}

async function saveResultCache(): Promise<void> {
    await writeJsonFile(resultsCachePath, {
        byQueryKey: Object.fromEntries(resultCacheByKey.entries())
    } satisfies ResultCacheStore);
}

async function saveInstallState(): Promise<void> {
    await writeJsonFile(installStatePath, {
        byWorkshopId: Object.fromEntries(installPathById.entries())
    } satisfies InstallStateStore);
}

async function ensureVersionMaps(): Promise<VersionMapsCache> {
    await ensureInitialized();

    if (mapsCache && Date.now() - mapsCache.fetchedAt < MAP_CACHE_TTL_MS) {
        return mapsCache;
    }

    try {
        const [versions, communityCompat] = await Promise.all([
            fetchJson<Record<string, string>>(`${STELLARISYNC_BASE_URL}/mods/versions`),
            fetchJson<Record<string, Record<string, CommunityCompatEntry>>>(`${STELLARISYNC_BASE_URL}/mods/community-compat`)
        ]);

        mapsCache = {
            fetchedAt: Date.now(),
            versions,
            communityCompat
        };

        await saveMapsCache();
        return mapsCache;
    } catch {
        if (mapsCache) {
            return mapsCache;
        }

        mapsCache = {
            fetchedAt: Date.now(),
            versions: {},
            communityCompat: {}
        };

        return mapsCache;
    }
}

function getInstalledWorkshopIdsFromDb(): Set<string> {
    const installedIds = new Set<string>();
    const dbPath = getLegacyPaths().modsDbPath;

    if (!fs.existsSync(dbPath)) {
        return installedIds;
    }

    let db: Database.Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });

        const columns = db.prepare("PRAGMA table_info(Mods)").all() as Array<{ name: string }>;
        const workshopColumn = columns.some((column) => column.name === "SteamWorkshopId")
            ? "SteamWorkshopId"
            : columns.some((column) => column.name === "WorkshopId")
                ? "WorkshopId"
                : null;

        if (!workshopColumn) {
            return installedIds;
        }

        const rows = db
            .prepare(
                `SELECT DISTINCT ${workshopColumn} AS WorkshopId
                 FROM Mods
                 WHERE ${workshopColumn} IS NOT NULL AND ${workshopColumn} <> ''`
            )
            .all() as Array<{ WorkshopId: string }>;

        for (const row of rows) {
            if (row.WorkshopId?.trim()) {
                installedIds.add(row.WorkshopId.trim());
            }
        }
    } catch {
        // ignore db read failures
    } finally {
        db?.close();
    }

    return installedIds;
}

function getEffectiveInstalledIds(): Set<string> {
    const dbIds = getInstalledWorkshopIdsFromDb();
    for (const id of installPathById.keys()) {
        dbIds.add(id);
    }

    return dbIds;
}

async function fetchPublishedFileDetails(ids: string[]): Promise<Map<string, SteamPublishedFileDetails>> {
    const result = new Map<string, SteamPublishedFileDetails>();
    if (ids.length === 0) {
        return result;
    }

    const missingIds: string[] = [];
    for (const id of ids) {
        const cached = detailCacheById.get(id);
        if (cached && isCacheFresh(cached.fetchedAtUtc, DETAIL_CACHE_TTL_MS)) {
            result.set(id, cached.detail);
        } else {
            missingIds.push(id);
        }
    }

    for (let offset = 0; offset < missingIds.length; offset += 100) {
        const chunk = missingIds.slice(offset, offset + 100);
        const formData = new URLSearchParams();
        formData.append("itemcount", String(chunk.length));

        for (let i = 0; i < chunk.length; i += 1) {
            formData.append(`publishedfileids[${i}]`, chunk[i]);
        }

        try {
            const response = await fetch(STEAM_PUBLISHED_DETAILS_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: formData.toString()
            });

            if (!response.ok) {
                continue;
            }

            const payload = (await response.json()) as SteamFileDetailsResponse;
            for (const detail of payload.response?.publishedfiledetails ?? []) {
                const workshopId = String(detail.publishedfileid ?? "").trim();
                if (!workshopId) {
                    continue;
                }

                result.set(workshopId, detail);
                detailCacheById.set(workshopId, {
                    fetchedAtUtc: nowIso(),
                    detail
                });
            }
        } catch {
            // ignore partial detail fetch failures
        }
    }

    await saveDetailsCache();
    return result;
}

function ensureThumbnailFileName(workshopId: string, previewUrl: string): string {
    const extMatch = previewUrl.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".jpg";
    return `${workshopId}${ext}`;
}

async function ensureThumbnailCached(workshopId: string, previewUrl: string | null): Promise<string | null> {
    if (!previewUrl) {
        return null;
    }

    const fileName = ensureThumbnailFileName(workshopId, previewUrl);
    const filePath = path.join(thumbnailsDir, fileName);

    try {
        const stat = await fsp.stat(filePath);
        if (Date.now() - stat.mtimeMs < THUMBNAIL_CACHE_TTL_MS) {
            return pathToFileURL(filePath).toString();
        }
    } catch {
        // download below
    }

    try {
        const response = await fetch(previewUrl, { method: "GET" });
        if (!response.ok) {
            return previewUrl;
        }

        const bytes = await response.arrayBuffer();
        await fsp.writeFile(filePath, Buffer.from(bytes));
        return pathToFileURL(filePath).toString();
    } catch {
        return previewUrl;
    }
}

function getActionStateForCard(workshopId: string, installedIds: Set<string>): VersionModCard["actionState"] {
    const mapped = normalizeActionState(actionStates.get(workshopId));
    if (mapped === "not-installed") {
        return installedIds.has(workshopId) ? "installed" : "not-installed";
    }

    return mapped;
}

function buildQueryCacheKey(query: VersionBrowserQuery): string {
    const selectedVersion = (query.selectedVersion || "4.3").trim();
    const searchText = (query.searchText ?? "").trim().toLowerCase();
    const sortMode = query.sortMode ?? "relevance";
    const older = query.showOlderVersions === true ? "old" : "recent";
    return `${selectedVersion}|${searchText}|${sortMode}|${older}`;
}

function hydrateCardsFromCache(cached: CachedResultCard[], installedIds: Set<string>): VersionModCard[] {
    return cached.map((card) => ({
        ...card,
        actionState: getActionStateForCard(card.workshopId, installedIds)
    }));
}

function asCachedCard(card: VersionModCard): CachedResultCard {
    return {
        workshopId: card.workshopId,
        workshopUrl: card.workshopUrl,
        name: card.name,
        gameVersionBadge: card.gameVersionBadge,
        previewImageUrl: card.previewImageUrl,
        totalSubscribers: card.totalSubscribers,
        communityWorksCount: card.communityWorksCount,
        communityNotWorksCount: card.communityNotWorksCount,
        communityWorksPercent: card.communityWorksPercent
    };
}

function toWorkshopSortMode(sortMode: VersionSortMode | undefined): WorkshopSortMode {
    switch (sortMode) {
        case "most-popular":
            return "most-popular";
        case "most-subscribed":
            return "most-subscribed";
        case "relevance":
        default:
            return "relevance";
    }
}

function extractMajorMinorVersionTokens(text: string): Set<string> {
    const tokens = new Set<string>();
    const versionTokenRegex = /(^|[^\d])(\d+\.\d+(?:\.\d+)?)(?=$|[^\d])/g;
    let match: RegExpExecArray | null;

    while ((match = versionTokenRegex.exec(text)) !== null) {
        const rawToken = (match[2] ?? "").trim();
        if (!rawToken) {
            continue;
        }

        const majorMinor = normalizeMajorMinor(rawToken);
        if (majorMinor) {
            tokens.add(majorMinor);
        }
    }

    return tokens;
}

function getStrongSignalVersionTokens(detail: SteamPublishedFileDetails): Set<string> {
    const strongParts: string[] = [];

    if (detail.title) {
        strongParts.push(detail.title);
    }

    if (Array.isArray(detail.tags)) {
        for (const tag of detail.tags) {
            if (tag?.tag) {
                strongParts.push(tag.tag);
            }
        }
    }

    return extractMajorMinorVersionTokens(strongParts.join(" "));
}

function getAllDetailVersionTokens(detail: SteamPublishedFileDetails): Set<string> {
    const allParts: string[] = [];

    if (detail.title) {
        allParts.push(detail.title);
    }
    if (detail.file_description) {
        allParts.push(stripHtml(detail.file_description));
    }
    if (Array.isArray(detail.tags)) {
        for (const tag of detail.tags) {
            if (tag?.tag) {
                allParts.push(tag.tag);
            }
        }
    }

    return extractMajorMinorVersionTokens(allParts.join(" "));
}

function isVersionCompatible(
    workshopId: string,
    maps: VersionMapsCache,
    selectedVersion: string,
    detail: SteamPublishedFileDetails | undefined
): boolean {
    const selectedMajorMinor = normalizeMajorMinor(selectedVersion);

    // Strong version signals from title/tags should always gate compatibility.
    // Example: a title explicitly stating "For 4.3" should never appear in 4.2.
    if (detail && selectedMajorMinor) {
        const strongTokens = getStrongSignalVersionTokens(detail);
        if (strongTokens.size > 0 && !strongTokens.has(selectedMajorMinor)) {
            return false;
        }
    }

    const confirmedVersion = maps.versions[workshopId];
    const communityEntry = maps.communityCompat[workshopId];

    if (confirmedVersion && versionMatchesSelection(confirmedVersion, selectedVersion)) {
        return true;
    }

    if (communityVersionMatchesSelection(communityEntry, selectedVersion)) {
        return true;
    }

    // If we have explicit compatibility data for this mod and it didn't match, treat it as incompatible.
    if (confirmedVersion || (communityEntry && Object.keys(communityEntry).length > 0)) {
        return false;
    }

    // Fallback for mods not present in compatibility maps: inspect title/description/tags for version tokens.
    if (!detail) {
        return false;
    }

    const detailTokens = getAllDetailVersionTokens(detail);
    if (detailTokens.size === 0) {
        return true;
    }

    return selectedMajorMinor ? detailTokens.has(selectedMajorMinor) : false;
}

async function getCardsWithResultCache(query: VersionBrowserQuery, targetCount: number): Promise<CachedResultCard[]> {
    const selectedVersion = (query.selectedVersion || "4.3").trim();
    const maps = await ensureVersionMaps();
    await ensureInitialized();

    const key = buildQueryCacheKey(query);
    const searchText = (query.searchText ?? "").trim();
    const sortMode = toWorkshopSortMode(query.sortMode);

    let cached = resultCacheByKey.get(key);
    if (!cached || !isCacheFresh(cached.cachedAtUtc, RESULT_CACHE_TTL_MS)) {
        cached = {
            cachedAtUtc: nowIso(),
            cards: [],
            steamPage: 1,
            exhausted: false
        };
    } else {
        cached.cards = Array.isArray(cached.cards) ? cached.cards : [];
        cached.steamPage = Number.isFinite(cached.steamPage) && cached.steamPage > 0 ? Math.trunc(cached.steamPage) : 1;
        cached.exhausted = cached.exhausted === true;
    }

    const seenIds = new Set<string>(cached.cards.map((card) => card.workshopId));

    // Fetch additional Steam pages in small batches until we can fill the requested UI page.
    let pageRequests = 0;
    while (!cached.exhausted && cached.cards.length < targetCount && pageRequests < MAX_STEAM_PAGE_PROBES_PER_QUERY) {
        const pageIds = await scrapeSteamWorkshopPage(sortMode, searchText, cached.steamPage);
        cached.steamPage += 1;
        pageRequests += 1;

        if (pageIds.length === 0) {
            cached.exhausted = true;
            break;
        }

        const candidateIds = pageIds
            .filter((workshopId) => isValidWorkshopId(workshopId) && !seenIds.has(workshopId));

        if (candidateIds.length === 0) {
            continue;
        }

        const details = await fetchPublishedFileDetails(candidateIds);
        for (const workshopId of candidateIds) {
            const detail = details.get(workshopId);
            if (!detail || !isVersionCompatible(workshopId, maps, selectedVersion, detail)) {
                seenIds.add(workshopId);
                continue;
            }

            const title = (detail.title ?? "").trim() || `Workshop Mod ${workshopId}`;
            const subscribersRaw = Number(detail.lifetime_subscriptions ?? 0);
            const totalSubscribers = Number.isFinite(subscribersRaw) ? subscribersRaw : 0;
            const community = getCommunityStats(maps.communityCompat, workshopId, selectedVersion);
            const previewImageUrl = await ensureThumbnailCached(workshopId, detail.preview_url?.trim() || null);

            cached.cards.push({
                workshopId,
                workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
                name: title,
                gameVersionBadge: normalizeMajorMinor(maps.versions[workshopId] ?? selectedVersion) ?? selectedVersion,
                previewImageUrl,
                totalSubscribers,
                communityWorksCount: community.works,
                communityNotWorksCount: community.notWorks,
                communityWorksPercent: community.percent
            });

            seenIds.add(workshopId);
            if (cached.cards.length >= targetCount) {
                break;
            }
        }

        if (pageIds.length < 10) {
            cached.exhausted = true;
        }
    }

    cached.cachedAtUtc = nowIso();
    resultCacheByKey.set(key, cached);

    await saveResultCache();
    return cached.cards;
}

function resolveDownloadBasePath(): string {
    const settings = loadSettingsSnapshot();
    const configured = settings?.steamCmdDownloadPath?.trim();
    if (configured) {
        return configured;
    }

    return path.join(getLegacyPaths().productDir, "SteamCmdDownloads");
}

function dedupeResolvedPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of paths) {
        const normalized = path.resolve(value);
        if (seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
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
            if (entries.length > 0) {
                return { foundPath: candidate, hadEmptyPath: false };
            }

            hadEmptyPath = true;
        } catch {
            // ignore missing/unreadable candidate path
        }
    }

    return {
        foundPath: null,
        hadEmptyPath
    };
}

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

function upsertQuotedDescriptorField(content: string, key: string, value: string): string {
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const line = `${key}="${escapedValue}"`;
    const re = new RegExp(`^\\s*${key}\\s*=\\s*"[^"]*"\\s*$`, "m");

    if (re.test(content)) {
        return content.replace(re, line);
    }

    const trimmed = content.trimEnd();
    return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
}

async function deployDownloadedModToModsPath(
    workshopId: string,
    downloadedInstallPath: string,
    reportProgress: (progress: number, message: string) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const modsRoot = resolveModsInstallRoot();
    const finalInstallPath = path.join(modsRoot, workshopId);
    const finalDescriptorPath = path.join(modsRoot, `${workshopId}.mod`);

    try {
        await fsp.mkdir(modsRoot, { recursive: true });
    } catch {
        return {
            ok: false,
            installPath: finalInstallPath,
            message: `Could not create mods path: ${modsRoot}`
        };
    }

    reportProgress(96, `Deploying ${workshopId} to mods path...`);

    try {
        await removeDirectoryIfExists(finalInstallPath);
        await fsp.cp(downloadedInstallPath, finalInstallPath, { recursive: true, force: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Copy failed";
        return {
            ok: false,
            installPath: finalInstallPath,
            message: `Failed to deploy mod files to mods path: ${message}`
        };
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
        return {
            ok: false,
            installPath: finalInstallPath,
            message: `Failed to write descriptor in mods path: ${message}`
        };
    }

    // Best effort: don't keep duplicate Steam workshop content when deployment succeeded.
    if (path.resolve(downloadedInstallPath) !== path.resolve(finalInstallPath)) {
        await removeDirectoryIfExists(downloadedInstallPath);
    }

    return {
        ok: true,
        installPath: finalInstallPath,
        message: `Installed to mods path: ${finalInstallPath}`
    };
}

async function removeDirectoryIfExists(targetPath: string): Promise<void> {
    try {
        await fsp.rm(targetPath, { recursive: true, force: true });
    } catch {
        // best effort
    }
}

function parseSteamCmdProgress(line: string): number | null {
    const match = line.match(/(\d{1,3}\.\d{2})%/);
    if (!match) {
        return null;
    }

    const parsed = Number.parseFloat(match[1]);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Math.max(1, Math.min(95, Math.round(parsed)));
}

function extractSteamCmdFailureDetail(line: string): string | null {
    const explicit = line.match(/ERROR!\s*Download item\s+\d+\s+failed\s*\([^)]*\)\.?/i);
    if (explicit) {
        return explicit[0].trim();
    }

    const failedDownload = line.match(/Download item\s+\d+\s+failed\s*\([^)]*\)\.?/i);
    if (failedDownload) {
        return `ERROR! ${failedDownload[0].trim()}`;
    }

    const genericError = line.match(/ERROR!\s*[^|\r\n]+/i);
    if (genericError) {
        return genericError[0].trim();
    }

    return null;
}

async function runSteamCmdDownload(
    workshopId: string,
    reportProgress: (progress: number, message: string) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    const settings = loadSettingsSnapshot();
    const steamCmdPath = settings?.steamCmdPath?.trim() ?? "";
    if (!steamCmdPath || !fs.existsSync(steamCmdPath)) {
        return {
            ok: false,
            installPath: "",
            message: "SteamCMD path is not configured or executable is missing."
        };
    }

    const forceInstallDir = resolveDownloadBasePath();
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

    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        const child = spawn(steamCmdPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
        });

        if (runningJob && runningJob.workshopId === workshopId) {
            runningJob.process = child;
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
            if (timedOut) {
                resolve({ ok: false, message: "SteamCMD download timed out." });
                return;
            }

            if (runningJob?.cancelled) {
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

    if (!result.ok) {
        return {
            ok: false,
            installPath: outputCandidates[0] ?? "",
            message: result.message
        };
    }

    if (explicitFailureMessage) {
        return {
            ok: false,
            installPath: outputCandidates[0] ?? "",
            message: `SteamCMD reported download failure: ${explicitFailureMessage}`
        };
    }

    const located = await findDownloadedWorkshopPath(outputCandidates);
    if (!located.foundPath) {
        const hint = statusHints.length > 0
            ? ` Last SteamCMD output: ${statusHints.join(" | ")}`
            : "";

        return {
            ok: false,
            installPath: outputCandidates[0] ?? "",
            message: located.hadEmptyPath
                ? `SteamCMD finished but download folder is empty.${hint}`
                : `SteamCMD finished but download folder was not found.${hint}`
        };
    }

    const deployed = await deployDownloadedModToModsPath(workshopId, located.foundPath, reportProgress);
    if (!deployed.ok) {
        return deployed;
    }

    installPathById.set(workshopId, deployed.installPath);
    await saveInstallState();

    return {
        ok: true,
        installPath: deployed.installPath,
        message: deployed.message
    };
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

    return {
        ok: true,
        message: "Uninstall completed."
    };
}

async function processQueue(): Promise<void> {
    if (queueWorkerActive) {
        return;
    }

    queueWorkerActive = true;

    while (queuePending.length > 0) {
        const next = queuePending.shift();
        if (!next) {
            break;
        }

        runningJob = {
            workshopId: next.workshopId,
            action: next.action,
            process: null,
            cancelled: false
        };

        if (next.action === "install") {
            actionStates.set(next.workshopId, "installing");
            upsertQueueItem(next.workshopId, next.action, "running", 3, "Preparing download...");
        } else {
            actionStates.set(next.workshopId, "uninstalling");
            upsertQueueItem(next.workshopId, next.action, "running", 10, "Removing mod files...");
        }

        if (next.action === "install") {
            const installResult = await runSteamCmdDownload(next.workshopId, (progress, message) => {
                upsertQueueItem(next.workshopId, next.action, "running", progress, message);
            });

            if (runningJob?.cancelled) {
                actionStates.set(next.workshopId, "not-installed");
                upsertQueueItem(next.workshopId, next.action, "cancelled", 0, "Install cancelled.");
            } else if (installResult.ok) {
                actionStates.set(next.workshopId, "installed");
                upsertQueueItem(next.workshopId, next.action, "completed", 100, installResult.message);
            } else {
                actionStates.set(next.workshopId, "error");
                upsertQueueItem(next.workshopId, next.action, "failed", 0, installResult.message);
            }
        } else {
            const uninstallResult = await runUninstall(next.workshopId);
            if (runningJob?.cancelled) {
                actionStates.set(next.workshopId, "installed");
                upsertQueueItem(next.workshopId, next.action, "cancelled", 0, "Uninstall cancelled.");
            } else if (uninstallResult.ok) {
                actionStates.set(next.workshopId, "not-installed");
                upsertQueueItem(next.workshopId, next.action, "completed", 100, uninstallResult.message);
            } else {
                actionStates.set(next.workshopId, "error");
                upsertQueueItem(next.workshopId, next.action, "failed", 0, uninstallResult.message);
            }
        }

        runningJob = null;
    }

    queueWorkerActive = false;
}

function getActionStateForRequest(workshopId: string): VersionModCard["actionState"] {
    return normalizeActionState(actionStates.get(workshopId));
}

export function getVersionOptions(showOlderVersions: boolean): VersionOption[] {
    return buildVersionOptions(showOlderVersions);
}

export function clearVersionResultCache(): void {
    resultCacheByKey.clear();
    mapsCache = null;
}

export async function queryVersionMods(query: VersionBrowserQuery): Promise<VersionBrowserResult> {
    await ensureInitialized();

    const selectedVersion = (query.selectedVersion || "4.3").trim();
    const pageSize = clampPageSize(query.pageSize);
    const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));
    const targetCount = (requestedPage * pageSize) + 1;

    const cachedCards = await getCardsWithResultCache(query, targetCount);
    const installedIds = getEffectiveInstalledIds();
    const cards = hydrateCardsFromCache(cachedCards, installedIds);

    const hasMore = cards.length > (requestedPage * pageSize);
    const totalPages = hasMore
        ? requestedPage + 1
        : Math.max(1, Math.ceil(cards.length / pageSize));
    const boundedPage = Math.min(requestedPage, totalPages);
    const offset = (boundedPage - 1) * pageSize;
    const paged = cards.slice(offset, offset + pageSize);
    const totalMatches = hasMore
        ? Math.max(cards.length, (boundedPage * pageSize) + 1)
        : cards.length;

    const statusText = totalMatches === 0
        ? `No mods found for ${selectedVersion}.`
        : `Loaded ${totalMatches}${hasMore ? "+" : ""} mod(s) for ${selectedVersion}. Showing page ${boundedPage} of ${totalPages}.`;

    return {
        selectedVersion,
        currentPage: boundedPage,
        totalPages,
        totalMatches,
        pageSize,
        cards: paged,
        statusText
    };
}

export function queueVersionModAction(request: VersionModActionRequest): VersionModActionResult {
    const workshopId = sanitizeWorkshopId(request.workshopId);
    if (!isValidWorkshopId(workshopId)) {
        return {
            ok: false,
            workshopId,
            actionState: "error",
            message: "Invalid workshop id."
        };
    }

    const current = getQueueItem(workshopId);
    if (current && (current.status === "queued" || current.status === "running")) {
        return {
            ok: false,
            workshopId,
            actionState: getActionStateForRequest(workshopId),
            message: `Mod ${workshopId} is already in queue.`
        };
    }

    queuePending.push({ workshopId, action: request.action });
    if (request.action === "install") {
        actionStates.set(workshopId, "queued");
        upsertQueueItem(workshopId, request.action, "queued", 0, "Queued for install.");
    } else {
        actionStates.set(workshopId, "uninstalling");
        upsertQueueItem(workshopId, request.action, "queued", 0, "Queued for uninstall.");
    }

    void processQueue();

    return {
        ok: true,
        workshopId,
        actionState: getActionStateForRequest(workshopId),
        message: request.action === "install"
            ? `Queued ${workshopId} for installation.`
            : `Queued ${workshopId} for uninstall.`
    };
}

export function cancelVersionModAction(workshopIdRaw: string): VersionModActionResult {
    const workshopId = sanitizeWorkshopId(workshopIdRaw);
    if (!isValidWorkshopId(workshopId)) {
        return {
            ok: false,
            workshopId,
            actionState: "error",
            message: "Invalid workshop id."
        };
    }

    const pendingRemoved = removePendingQueueItem(workshopId);
    if (pendingRemoved) {
        const cancelledAction = pendingRemoved.action;
        actionStates.set(workshopId, cancelledAction === "install" ? "not-installed" : "installed");
        upsertQueueItem(workshopId, cancelledAction, "cancelled", 0, "Queued operation cancelled.");
        return {
            ok: true,
            workshopId,
            actionState: getActionStateForRequest(workshopId),
            message: `Cancelled queued operation for ${workshopId}.`
        };
    }

    if (runningJob && runningJob.workshopId === workshopId) {
        runningJob.cancelled = true;
        if (runningJob.process) {
            try {
                runningJob.process.kill();
            } catch {
                // ignore kill errors
            }
        }

        return {
            ok: true,
            workshopId,
            actionState: getActionStateForRequest(workshopId),
            message: `Cancel requested for ${workshopId}.`
        };
    }

    return {
        ok: false,
        workshopId,
        actionState: getActionStateForRequest(workshopId),
        message: `No active queued operation found for ${workshopId}.`
    };
}

export function cancelAllVersionModActions(): VersionQueueCommandResult {
    let affected = 0;

    for (const pending of queuePending.splice(0, queuePending.length)) {
        actionStates.set(pending.workshopId, pending.action === "install" ? "not-installed" : "installed");
        upsertQueueItem(pending.workshopId, pending.action, "cancelled", 0, "Queued operation cancelled.");
        affected += 1;
    }

    if (runningJob) {
        runningJob.cancelled = true;
        if (runningJob.process) {
            try {
                runningJob.process.kill();
            } catch {
                // ignore kill errors
            }
        }
        affected += 1;
    }

    return {
        ok: true,
        message: affected > 0 ? `Cancelled ${affected} queue operation(s).` : "No active queue operations to cancel.",
        affected
    };
}

export function clearVersionQueueHistory(workshopIdsRaw?: string[]): VersionQueueCommandResult {
    const requestedIds = Array.isArray(workshopIdsRaw)
        ? workshopIdsRaw.map((value) => sanitizeWorkshopId(String(value ?? ""))).filter((value) => value.length > 0)
        : [];

    const requestedSet = requestedIds.length > 0 ? new Set(requestedIds) : null;
    const targets: string[] = [];

    for (const workshopId of Array.from(new Set(queueOrder))) {
        if (requestedSet && !requestedSet.has(workshopId)) {
            continue;
        }

        const item = queueItems.get(workshopId);
        if (!item || isQueueItemActive(item)) {
            continue;
        }

        targets.push(workshopId);
    }

    const removed = purgeQueueItems(targets);
    return {
        ok: true,
        message: removed > 0 ? `Cleared ${removed} queue history item(s).` : "No finished queue history to clear.",
        affected: removed
    };
}

export function getVersionQueueSnapshot(): VersionQueueSnapshot {
    return getQueueSnapshot();
}

export async function getVersionModDetail(workshopIdRaw: string, selectedVersion: string): Promise<VersionModDetail | null> {
    await ensureInitialized();

    const workshopId = sanitizeWorkshopId(workshopIdRaw);
    if (!isValidWorkshopId(workshopId)) {
        return null;
    }

    const maps = await ensureVersionMaps();
    const detailsMap = await fetchPublishedFileDetails([workshopId]);
    const detail = detailsMap.get(workshopId);
    if (!detail) {
        return null;
    }

    const previewImageUrl = await ensureThumbnailCached(workshopId, detail.preview_url?.trim() || null);
    const additionalPreviewUrls = (detail.previews ?? [])
        .map((entry) => (entry.previewurl ?? "").trim())
        .filter((value) => value.length > 0)
        .slice(0, 6);

    const tags = (detail.tags ?? [])
        .map((entry) => (entry.tag ?? "").trim())
        .filter((value) => value.length > 0)
        .slice(0, 24);

    const subscribersRaw = Number(detail.lifetime_subscriptions ?? 0);
    const totalSubscribers = Number.isFinite(subscribersRaw) ? subscribersRaw : 0;
    const community = getCommunityStats(maps.communityCompat, workshopId, selectedVersion);
    const gameVersionBadge = normalizeMajorMinor(maps.versions[workshopId] ?? selectedVersion) ?? selectedVersion;

    return {
        workshopId,
        workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
        title: (detail.title ?? "").trim() || `Workshop Mod ${workshopId}`,
        descriptionText: stripHtml(detail.file_description ?? "No description available."),
        previewImageUrl,
        additionalPreviewUrls,
        tags,
        totalSubscribers,
        gameVersionBadge,
        communityWorksCount: community.works,
        communityNotWorksCount: community.notWorks,
        communityWorksPercent: community.percent,
        actionState: getActionStateForRequest(workshopId),
        queueMessage: queueMessages.get(workshopId) ?? null
    };
}
