import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
    WorkshopBrowserQuery,
    WorkshopBrowserResult,
    WorkshopModCard,
    WorkshopSortMode
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { logError, logInfo } from "./logger";
import { getActionStateForCard } from "./downloadManager";
import {
    fetchRemoteBuffer,
    normalizeRemoteAssetUrl
} from "./remoteAsset";

const STELLARIS_APP_ID = "281990";
const STEAM_WORKSHOP_BROWSE_URL = "https://steamcommunity.com/workshop/browse/";
const STEAM_PUBLISHED_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const DEFAULT_PAGE_SIZE = 30;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 60;
const STEAM_PAGES_PER_APP_PAGE = 2;
const BROWSE_CACHE_TTL_MS = 15 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const THUMBNAIL_CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 18_000;
const THUMBNAIL_FETCH_TIMEOUT_MS = 12_000;
const THUMBNAIL_MAX_BYTES = 6 * 1024 * 1024;
const WORKSHOP_ID_REGEX = /sharedfiles\/filedetails\/\?id=(\d+)/g;

interface SteamFileDetailsResponse {
    response?: {
        publishedfiledetails?: SteamPublishedFileDetail[];
    };
}

interface SteamPublishedFileDetail {
    publishedfileid?: string;
    title?: string;
    file_description?: string;
    preview_url?: string;
    tags?: Array<{ tag?: string }>;
    lifetime_subscriptions?: string | number;
}

interface CachedDetail {
    fetchedAtUtc: string;
    detail: SteamPublishedFileDetail;
}

interface BrowseCacheEntry {
    cachedAtUtc: string;
    workshopIds: string[];
}

const cacheRoot = path.join(getLegacyPaths().productDir, "ElectronSpike", "workshop-browser-cache");
const thumbnailsDir = path.join(cacheRoot, "thumbnails");

let initialized = false;
const detailCache = new Map<string, CachedDetail>();
const browseCache = new Map<string, BrowseCacheEntry>();
const thumbnailWarmInFlight = new Map<string, Promise<void>>();

function nowIso(): string {
    return new Date().toISOString();
}

function isCacheFresh(isoUtc: string, ttlMs: number): boolean {
    const ts = Date.parse(isoUtc);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < ttlMs;
}

function clampPageSize(value: number | undefined): number {
    if (!value || Number.isNaN(value)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(value)));
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

async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    await fsp.mkdir(cacheRoot, { recursive: true });
    await fsp.mkdir(thumbnailsDir, { recursive: true });
    initialized = true;
}

function buildBrowseUrl(sortMode: WorkshopSortMode, searchText: string, steamPage: number): string {
    const steamSort = toSteamBrowseSort(sortMode);
    const params = new URLSearchParams({
        appid: STELLARIS_APP_ID,
        searchtext: searchText,
        childpublishedfileid: "0",
        browsesort: steamSort,
        section: "readytouseitems",
        actualsort: steamSort,
        days: "-1",
        p: String(steamPage)
    });
    return `${STEAM_WORKSHOP_BROWSE_URL}?${params.toString()}`;
}

function toSteamBrowseSort(sortMode: WorkshopSortMode): string {
    switch (sortMode) {
        case "most-subscribed":
            return "totaluniquesubscribers";
        case "most-popular":
            return "playtime_trend";
        case "recent":
            return "mostrecent";
        case "trend":
            return "trend";
        case "relevance":
        default:
            return "textsearch";
    }
}

export function toSteamBrowseSortForTest(sortMode: WorkshopSortMode): string {
    return toSteamBrowseSort(sortMode);
}

function buildBrowseCacheKey(sortMode: WorkshopSortMode, searchText: string, steamPage: number): string {
    return `${sortMode}|${searchText.trim().toLowerCase()}|${steamPage}`;
}

async function fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching ${url}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

function extractWorkshopIds(html: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = WORKSHOP_ID_REGEX.exec(html)) !== null) {
        const id = match[1];
        if (id && isValidWorkshopId(id) && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }

    return ids;
}

export async function scrapeSteamWorkshopPage(
    sortMode: WorkshopSortMode,
    searchText: string,
    steamPage: number
): Promise<string[]> {
    const cacheKey = buildBrowseCacheKey(sortMode, searchText, steamPage);
    const cached = browseCache.get(cacheKey);
    if (cached && isCacheFresh(cached.cachedAtUtc, BROWSE_CACHE_TTL_MS)) {
        return cached.workshopIds;
    }

    const url = buildBrowseUrl(sortMode, searchText, steamPage);
    logInfo(`Workshop browse: fetching page ${steamPage} (sort=${sortMode}, search="${searchText}")`);

    try {
        const html = await fetchHtml(url);
        const ids = extractWorkshopIds(html);

        browseCache.set(cacheKey, {
            cachedAtUtc: nowIso(),
            workshopIds: ids
        });

        return ids;
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`Workshop browse failed for page ${steamPage}: ${msg}`);
        return cached?.workshopIds ?? [];
    }
}

async function scrapeMultiplePages(
    sortMode: WorkshopSortMode,
    searchText: string,
    steamStartPage: number,
    count: number
): Promise<string[]> {
    const allIds: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < count; i++) {
        const pageIds = await scrapeSteamWorkshopPage(sortMode, searchText, steamStartPage + i);
        if (pageIds.length === 0) break;

        for (const id of pageIds) {
            if (!seen.has(id)) {
                seen.add(id);
                allIds.push(id);
            }
        }
    }

    return allIds;
}

async function fetchPublishedFileDetails(ids: string[]): Promise<Map<string, SteamPublishedFileDetail>> {
    const result = new Map<string, SteamPublishedFileDetail>();
    if (ids.length === 0) return result;

    const missingIds: string[] = [];
    for (const id of ids) {
        const cached = detailCache.get(id);
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

        for (let i = 0; i < chunk.length; i++) {
            formData.append(`publishedfileids[${i}]`, chunk[i]);
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

            const response = await fetch(STEAM_PUBLISHED_DETAILS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: formData.toString(),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) continue;

            const payload = (await response.json()) as SteamFileDetailsResponse;
            for (const detail of payload.response?.publishedfiledetails ?? []) {
                const workshopId = String(detail.publishedfileid ?? "").trim();
                if (!workshopId) continue;

                result.set(workshopId, detail);
                detailCache.set(workshopId, { fetchedAtUtc: nowIso(), detail });
            }
        } catch {
            // ignore partial fetch failures
        }
    }

    return result;
}

async function ensureThumbnailCached(workshopId: string, previewUrl: string | null): Promise<string | null> {
    const safePreviewUrl = normalizeRemoteAssetUrl(previewUrl ?? "");
    if (!safePreviewUrl) return null;

    const filePath = path.join(thumbnailsDir, ensureThumbnailFileName(workshopId, safePreviewUrl));

    try {
        const stat = await fsp.stat(filePath);
        if (Date.now() - stat.mtimeMs < THUMBNAIL_CACHE_TTL_MS) {
            return pathToFileURL(filePath).toString();
        }
    } catch {
        // download below
    }

    try {
        const result = await fetchRemoteBuffer(safePreviewUrl, {
            timeoutMs: THUMBNAIL_FETCH_TIMEOUT_MS,
            maxBytes: THUMBNAIL_MAX_BYTES
        });
        if (!result) {
            return null;
        }

        if (!result.buffer) {
            return result.safeUrl;
        }

        await fsp.writeFile(filePath, result.buffer);
        return pathToFileURL(filePath).toString();
    } catch {
        return safePreviewUrl;
    }
}

function ensureThumbnailFileName(workshopId: string, previewUrl: string): string {
    const extMatch = previewUrl.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".jpg";
    return `${workshopId}${ext}`;
}

function queueThumbnailWarmup(workshopId: string, previewUrl: string | null): void {
    const safePreviewUrl = normalizeRemoteAssetUrl(previewUrl ?? "");
    if (!safePreviewUrl) {
        return;
    }

    const key = `${workshopId}|${safePreviewUrl}`;
    if (thumbnailWarmInFlight.has(key)) {
        return;
    }

    const warmPromise = (async () => {
        await ensureThumbnailCached(workshopId, safePreviewUrl);
    })().finally(() => {
        thumbnailWarmInFlight.delete(key);
    });

    thumbnailWarmInFlight.set(key, warmPromise);
}

async function resolveCardThumbnailUrl(workshopId: string, previewUrl: string | null): Promise<string | null> {
    const safePreviewUrl = normalizeRemoteAssetUrl(previewUrl ?? "");
    if (!safePreviewUrl) {
        return null;
    }

    const filePath = path.join(thumbnailsDir, ensureThumbnailFileName(workshopId, safePreviewUrl));
    try {
        const stat = await fsp.stat(filePath);
        if (Date.now() - stat.mtimeMs < THUMBNAIL_CACHE_TTL_MS) {
            return pathToFileURL(filePath).toString();
        }
    } catch {
        // warmup below
    }

    queueThumbnailWarmup(workshopId, safePreviewUrl);
    return safePreviewUrl;
}


export async function queryWorkshopMods(query: WorkshopBrowserQuery): Promise<WorkshopBrowserResult> {
    await ensureInitialized();

    const sortMode = query.sortMode ?? "trend";
    const searchText = (query.searchText ?? "").trim();
    const normalizedSearchWorkshopId = sanitizeWorkshopId(searchText);
    const pageSize = clampPageSize(query.pageSize);
    const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));

    // Each Steam page returns ~15-30 items. We fetch multiple Steam pages to fill our app page.
    // Steam pages are 1-based. For app page N, we fetch Steam pages starting at ((N-1) * pagesPerAppPage + 1).
    const steamStartPage = (requestedPage - 1) * STEAM_PAGES_PER_APP_PAGE + 1;

    // If searching by exact workshop ID, handle it directly
    if (isValidWorkshopId(normalizedSearchWorkshopId)) {
        const details = await fetchPublishedFileDetails([normalizedSearchWorkshopId]);
        const detail = details.get(normalizedSearchWorkshopId);

        if (detail) {
            const title = (detail.title ?? "").trim() || `Workshop Mod ${normalizedSearchWorkshopId}`;
            const subs = Number(detail.lifetime_subscriptions ?? 0);
            const previewImageUrl = await resolveCardThumbnailUrl(normalizedSearchWorkshopId, detail.preview_url?.trim() || null);
            const tags = (detail.tags ?? []).map((t) => (t.tag ?? "").trim()).filter(Boolean).slice(0, 12);

            return {
                currentPage: 1,
                totalPages: 1,
                totalMatches: 1,
                pageSize,
                cards: [{
                    workshopId: normalizedSearchWorkshopId,
                    workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${normalizedSearchWorkshopId}`,
                    name: title,
                    previewImageUrl,
                    totalSubscribers: Number.isFinite(subs) ? subs : 0,
                    tags,
                    actionState: getActionStateForCard(normalizedSearchWorkshopId)
                }],
                statusText: `Found mod ${normalizedSearchWorkshopId}: ${detail.title ?? "Unknown"}`,
                hasMore: false
            };
        }

        return {
            currentPage: 1,
            totalPages: 1,
            totalMatches: 0,
            pageSize,
            cards: [],
            statusText: `No mod found with ID ${normalizedSearchWorkshopId}.`,
            hasMore: false
        };
    }

    // Scrape Steam Workshop HTML pages
    const workshopIds = await scrapeMultiplePages(sortMode, searchText, steamStartPage, STEAM_PAGES_PER_APP_PAGE);

    if (workshopIds.length === 0) {
        return {
            currentPage: requestedPage,
            totalPages: requestedPage,
            totalMatches: 0,
            pageSize,
            cards: [],
            statusText: searchText
                ? `No mods found for "${searchText}".`
                : "No mods found. Steam Workshop may be temporarily unavailable.",
            hasMore: false
        };
    }

    // Fetch metadata for all scraped IDs
    const details = await fetchPublishedFileDetails(workshopIds);
    const cards = (await Promise.all(workshopIds.map(async (workshopId) => {
        const detail = details.get(workshopId);
        if (!detail) {
            return null;
        }

        const title = (detail.title ?? "").trim() || `Workshop Mod ${workshopId}`;
        const subs = Number(detail.lifetime_subscriptions ?? 0);
        const previewImageUrl = await resolveCardThumbnailUrl(workshopId, detail.preview_url?.trim() || null);
        const tags = (detail.tags ?? []).map((t) => (t.tag ?? "").trim()).filter(Boolean).slice(0, 12);

        return {
            workshopId,
            workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
            name: title,
            previewImageUrl,
            totalSubscribers: Number.isFinite(subs) ? subs : 0,
            tags,
            actionState: getActionStateForCard(workshopId)
        } satisfies WorkshopModCard;
    }))).filter((card): card is WorkshopModCard => card !== null);

    // Trim to requested page size
    const pagedCards = cards.slice(0, pageSize);

    // We assume there are more pages if we got a decent number of results
    const hasMore = workshopIds.length >= 10;

    // We don't know the exact total from scraping, so we estimate
    const estimatedTotalPages = hasMore ? requestedPage + 1 : requestedPage;

    const statusText = searchText
        ? `Found ${pagedCards.length} mod(s) for "${searchText}" — page ${requestedPage}.`
        : `Showing ${pagedCards.length} mod(s) — page ${requestedPage}.`;

    return {
        currentPage: requestedPage,
        totalPages: estimatedTotalPages,
        totalMatches: pagedCards.length,
        pageSize,
        cards: pagedCards,
        statusText,
        hasMore
    };
}

export function clearWorkshopCache(): void {
    browseCache.clear();
    detailCache.clear();
    logInfo("Workshop browse cache cleared.");
}
