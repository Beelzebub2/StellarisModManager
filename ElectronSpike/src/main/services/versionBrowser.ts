import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
    VersionBrowserQuery,
    VersionBrowserResult,
    VersionModCard,
    VersionModDetail,
    VersionOption,
    VersionSortMode,
    WorkshopSortMode
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { getActionStateForCard } from "./downloadManager";
import { scrapeSteamWorkshopPage } from "./workshopBrowser";
const STELLARISYNC_BASE_URL = process.env.STELLARISYNC_BASE_URL?.trim() || "https://stellarisync.rrmtools.uk";
const STEAM_PUBLISHED_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const DEFAULT_PAGE_SIZE = 30;
const MIN_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 60;
const MAP_CACHE_TTL_MS = 4 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 20 * 60 * 1000;
const THUMBNAIL_CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_STEAM_PAGE_PROBES_PER_QUERY = 20;
const CACHE_FLUSH_DEBOUNCE_MS = 1_500;

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

interface DetailCacheStore {
    byWorkshopId: Record<string, CachedFileDetails>;
}

interface ResultCacheStore {
    byQueryKey: Record<string, CachedResultEntry>;
}

const cacheRoot = path.join(getLegacyPaths().productDir, "ElectronSpike", "version-browser-cache");
const thumbnailsDir = path.join(cacheRoot, "thumbnails");
const mapsCachePath = path.join(cacheRoot, "maps-cache.json");
const detailsCachePath = path.join(cacheRoot, "details-cache.json");
const resultsCachePath = path.join(cacheRoot, "results-cache.json");

let initialized = false;
let mapsCache: VersionMapsCache | null = null;
let detailCacheById = new Map<string, CachedFileDetails>();
let resultCacheByKey = new Map<string, CachedResultEntry>();
let detailsCacheDirty = false;
let resultCacheDirty = false;
let cacheFlushTimer: ReturnType<typeof setTimeout> | null = null;
const thumbnailWarmInFlight = new Map<string, Promise<void>>();

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

function isValidWorkshopId(value: string): boolean {
    return /^\d{6,}$/.test(value);
}

function sanitizeWorkshopId(value: string): string {
    return value.trim();
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

    const [maps, details, results] = await Promise.all([
        readJsonFile<VersionMapsCache | null>(mapsCachePath, null),
        readJsonFile<DetailCacheStore>(detailsCachePath, { byWorkshopId: {} }),
        readJsonFile<ResultCacheStore>(resultsCachePath, { byQueryKey: {} })
    ]);

    mapsCache = maps;
    detailCacheById = new Map(Object.entries(details.byWorkshopId ?? {}));
    resultCacheByKey = new Map(Object.entries(results.byQueryKey ?? {}));

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

function scheduleCacheFlush(): void {
    if (cacheFlushTimer) {
        return;
    }

    cacheFlushTimer = setTimeout(() => {
        cacheFlushTimer = null;
        void flushDirtyCaches();
    }, CACHE_FLUSH_DEBOUNCE_MS);
}

async function flushDirtyCaches(): Promise<void> {
    const shouldSaveDetails = detailsCacheDirty;
    const shouldSaveResults = resultCacheDirty;

    if (!shouldSaveDetails && !shouldSaveResults) {
        return;
    }

    if (shouldSaveDetails) {
        try {
            await saveDetailsCache();
            detailsCacheDirty = false;
        } catch {
            scheduleCacheFlush();
        }
    }

    if (shouldSaveResults) {
        try {
            await saveResultCache();
            resultCacheDirty = false;
        } catch {
            scheduleCacheFlush();
        }
    }
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

    let detailCacheChanged = false;

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
                detailCacheChanged = true;
            }
        } catch {
            // ignore partial detail fetch failures
        }
    }

    if (detailCacheChanged) {
        detailsCacheDirty = true;
        scheduleCacheFlush();
    }

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

function queueThumbnailWarmup(workshopId: string, previewUrl: string | null): void {
    if (!previewUrl) {
        return;
    }

    const key = `${workshopId}|${previewUrl}`;
    if (thumbnailWarmInFlight.has(key)) {
        return;
    }

    const warmPromise = (async () => {
        await ensureThumbnailCached(workshopId, previewUrl);
    })().finally(() => {
        thumbnailWarmInFlight.delete(key);
    });

    thumbnailWarmInFlight.set(key, warmPromise);
}

async function resolveCardThumbnailUrl(workshopId: string, previewUrl: string | null): Promise<string | null> {
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
        // warmup below
    }

    queueThumbnailWarmup(workshopId, previewUrl);
    return previewUrl;
}

function buildQueryCacheKey(query: VersionBrowserQuery): string {
    const selectedVersion = (query.selectedVersion || "4.3").trim();
    const searchText = (query.searchText ?? "").trim().toLowerCase();
    const sortMode = query.sortMode ?? "relevance";
    const older = query.showOlderVersions === true ? "old" : "recent";
    return `${selectedVersion}|${searchText}|${sortMode}|${older}`;
}

function hydrateCardsFromCache(cached: CachedResultCard[]): VersionModCard[] {
    return cached.map((card) => ({
        ...card,
        actionState: getActionStateForCard(card.workshopId)
    }));
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

    if (confirmedVersion || (communityEntry && Object.keys(communityEntry).length > 0)) {
        return false;
    }

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
    let resultEntryChanged = false;

    if (!cached || !isCacheFresh(cached.cachedAtUtc, RESULT_CACHE_TTL_MS)) {
        cached = {
            cachedAtUtc: nowIso(),
            cards: [],
            steamPage: 1,
            exhausted: false
        };
        resultEntryChanged = true;
    } else {
        cached.cards = Array.isArray(cached.cards) ? cached.cards : [];
        cached.steamPage = Number.isFinite(cached.steamPage) && cached.steamPage > 0 ? Math.trunc(cached.steamPage) : 1;
        cached.exhausted = cached.exhausted === true;
    }

    const seenIds = new Set<string>(cached.cards.map((card) => card.workshopId));

    let pageRequests = 0;
    while (!cached.exhausted && cached.cards.length < targetCount && pageRequests < MAX_STEAM_PAGE_PROBES_PER_QUERY) {
        const pageIds = await scrapeSteamWorkshopPage(sortMode, searchText, cached.steamPage);
        cached.steamPage += 1;
        resultEntryChanged = true;
        pageRequests += 1;

        if (pageIds.length === 0) {
            cached.exhausted = true;
            resultEntryChanged = true;
            break;
        }

        const candidateIds = pageIds
            .filter((workshopId) => isValidWorkshopId(workshopId) && !seenIds.has(workshopId));

        if (candidateIds.length === 0) {
            continue;
        }

        const details = await fetchPublishedFileDetails(candidateIds);
        const pageCards = await Promise.all(candidateIds.map(async (workshopId) => {
            const detail = details.get(workshopId);
            if (!detail || !isVersionCompatible(workshopId, maps, selectedVersion, detail)) {
                seenIds.add(workshopId);
                return null;
            }

            const title = (detail.title ?? "").trim() || `Workshop Mod ${workshopId}`;
            const subscribersRaw = Number(detail.lifetime_subscriptions ?? 0);
            const totalSubscribers = Number.isFinite(subscribersRaw) ? subscribersRaw : 0;
            const community = getCommunityStats(maps.communityCompat, workshopId, selectedVersion);
            const previewImageUrl = await resolveCardThumbnailUrl(workshopId, detail.preview_url?.trim() || null);

            return {
                workshopId,
                workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
                name: title,
                gameVersionBadge: normalizeMajorMinor(maps.versions[workshopId] ?? selectedVersion) ?? selectedVersion,
                previewImageUrl,
                totalSubscribers,
                communityWorksCount: community.works,
                communityNotWorksCount: community.notWorks,
                communityWorksPercent: community.percent
            } satisfies CachedResultCard;
        }));

        for (const card of pageCards) {
            if (!card) {
                continue;
            }

            cached.cards.push(card);
            seenIds.add(card.workshopId);
            resultEntryChanged = true;

            if (cached.cards.length >= targetCount) {
                break;
            }
        }

        if (pageIds.length < 10) {
            cached.exhausted = true;
            resultEntryChanged = true;
        }
    }

    if (resultEntryChanged) {
        cached.cachedAtUtc = nowIso();
        resultCacheByKey.set(key, cached);
        resultCacheDirty = true;
        scheduleCacheFlush();
    }

    return cached.cards;
}

// --- Exported API ---

export function getVersionOptions(showOlderVersions: boolean): VersionOption[] {
    return buildVersionOptions(showOlderVersions);
}

export function clearVersionResultCache(): void {
    resultCacheByKey.clear();
    mapsCache = null;
    resultCacheDirty = true;
    scheduleCacheFlush();
}

export async function queryVersionMods(query: VersionBrowserQuery): Promise<VersionBrowserResult> {
    await ensureInitialized();

    const selectedVersion = (query.selectedVersion || "4.3").trim();
    const pageSize = clampPageSize(query.pageSize);
    const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));
    const targetCount = (requestedPage * pageSize) + 1;

    const cachedCards = await getCardsWithResultCache(query, targetCount);
    const cards = hydrateCardsFromCache(cachedCards);

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
        actionState: getActionStateForCard(workshopId),
        queueMessage: null
    };
}
