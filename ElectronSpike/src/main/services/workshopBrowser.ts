import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type {
    WorkshopBrowserQuery,
    WorkshopBrowserResult,
    WorkshopModCard,
    WorkshopSortMode
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { logError, logInfo } from "./logger";

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
const installStateCache = new Map<string, string>();

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

async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    await fsp.mkdir(cacheRoot, { recursive: true });
    await fsp.mkdir(thumbnailsDir, { recursive: true });
    initialized = true;
}

function buildBrowseUrl(sortMode: WorkshopSortMode, searchText: string, steamPage: number): string {
    const params = new URLSearchParams({
        appid: STELLARIS_APP_ID,
        searchtext: searchText,
        childpublishedfileid: "0",
        browsesort: sortMode,
        section: "readytouseitems",
        actualsort: sortMode,
        days: "-1",
        p: String(steamPage)
    });
    return `${STEAM_WORKSHOP_BROWSE_URL}?${params.toString()}`;
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

async function scrapeSteamWorkshopPage(
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
    if (!previewUrl) return null;

    const extMatch = previewUrl.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".jpg";
    const filePath = path.join(thumbnailsDir, `${workshopId}${ext}`);

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
        if (!response.ok) return previewUrl;

        const bytes = await response.arrayBuffer();
        await fsp.writeFile(filePath, Buffer.from(bytes));
        return pathToFileURL(filePath).toString();
    } catch {
        return previewUrl;
    }
}

function getInstalledWorkshopIds(): Set<string> {
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

    for (const id of installStateCache.keys()) {
        installedIds.add(id);
    }

    return installedIds;
}

function getActionState(workshopId: string, installedIds: Set<string>): WorkshopModCard["actionState"] {
    return installedIds.has(workshopId) ? "installed" : "not-installed";
}

export async function queryWorkshopMods(query: WorkshopBrowserQuery): Promise<WorkshopBrowserResult> {
    await ensureInitialized();

    const sortMode = query.sortMode ?? "trend";
    const searchText = (query.searchText ?? "").trim();
    const pageSize = clampPageSize(query.pageSize);
    const requestedPage = Math.max(1, Math.trunc(query.page ?? 1));

    // Each Steam page returns ~15-30 items. We fetch multiple Steam pages to fill our app page.
    // Steam pages are 1-based. For app page N, we fetch Steam pages starting at ((N-1) * pagesPerAppPage + 1).
    const steamStartPage = (requestedPage - 1) * STEAM_PAGES_PER_APP_PAGE + 1;

    // If searching by exact workshop ID, handle it directly
    if (searchText && /^\d{6,}$/.test(searchText)) {
        const details = await fetchPublishedFileDetails([searchText]);
        const detail = details.get(searchText);
        const installedIds = getInstalledWorkshopIds();

        if (detail) {
            const title = (detail.title ?? "").trim() || `Workshop Mod ${searchText}`;
            const subs = Number(detail.lifetime_subscriptions ?? 0);
            const previewImageUrl = await ensureThumbnailCached(searchText, detail.preview_url?.trim() || null);
            const tags = (detail.tags ?? []).map((t) => (t.tag ?? "").trim()).filter(Boolean).slice(0, 12);

            return {
                currentPage: 1,
                totalPages: 1,
                totalMatches: 1,
                pageSize,
                cards: [{
                    workshopId: searchText,
                    workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${searchText}`,
                    name: title,
                    previewImageUrl,
                    totalSubscribers: Number.isFinite(subs) ? subs : 0,
                    tags,
                    actionState: getActionState(searchText, installedIds)
                }],
                statusText: `Found mod ${searchText}: ${detail.title ?? "Unknown"}`,
                hasMore: false
            };
        }

        return {
            currentPage: 1,
            totalPages: 1,
            totalMatches: 0,
            pageSize,
            cards: [],
            statusText: `No mod found with ID ${searchText}.`,
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
    const installedIds = getInstalledWorkshopIds();
    const cards: WorkshopModCard[] = [];

    for (const workshopId of workshopIds) {
        const detail = details.get(workshopId);
        if (!detail) continue;

        const title = (detail.title ?? "").trim() || `Workshop Mod ${workshopId}`;
        const subs = Number(detail.lifetime_subscriptions ?? 0);
        const previewImageUrl = await ensureThumbnailCached(workshopId, detail.preview_url?.trim() || null);
        const tags = (detail.tags ?? []).map((t) => (t.tag ?? "").trim()).filter(Boolean).slice(0, 12);

        cards.push({
            workshopId,
            workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
            name: title,
            previewImageUrl,
            totalSubscribers: Number.isFinite(subs) ? subs : 0,
            tags,
            actionState: getActionState(workshopId, installedIds)
        });
    }

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
