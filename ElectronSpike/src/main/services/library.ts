import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type {
    CompatibilityTagCatalogResult,
    CompatibilityTagConsensus,
    CompatibilityTagDefinition,
    CompatibilityTagGroupConsensus,
    ConsensusState,
    LibraryActionResult,
    LibraryAchievementStatus,
    LibraryApplyLoadOrderRequest,
    LibraryCompatibilityReportRequest,
    LibraryImportResult,
    LibraryCompatibilitySummary,
    LibraryModItem,
    LibraryMoveDirectionRequest,
    ModsPathMigrationRequest,
    ModsPathMigrationResult,
    LibraryPublishSharedProfileRequest,
    LibraryPublishSharedProfileResult,
    LibraryProfileActivationPreviewResult,
    LibraryReorderRequest,
    LibraryProfile,
    LibraryRenameProfileRequest,
    LibrarySetModEnabledRequest,
    LibrarySetSharedProfileIdRequest,
    LibrarySyncSharedProfileRequest,
    LibrarySyncSharedProfileResult,
    LibrarySharedProfileSyncPreviewResult,
    LibraryLoadOrderChange,
    LibraryLoadOrderPreviewResult,
    LibrarySnapshot,
    SettingsSnapshot,
    ScanLocalModsResult
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { finishModsPathMigration, startModsPathMigration, updateModsPathMigrationProgress } from "./modsPathMigrationState";
import {
    getDefaultModsPath as getSettingsDefaultModsPath,
    loadSettingsSnapshot,
    resolveDescriptorModsPath,
    resolveManagedModsPath,
    saveSettingsSnapshot
} from "./settings";
import { getGameRunningStatus } from "./stellarisProcess";
import { discoverSteamLibraries } from "./steamDiscovery";
import {
    buildManagedDescriptorPath,
    buildManagedDescriptorReference,
    queueDownload,
    upsertQuotedDescriptorField
} from "./downloadManager";

const STEAM_PUBLISHED_DETAILS_URL = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const STELLARISYNC_BASE_URL = process.env.STELLARISYNC_BASE_URL?.trim() || "https://stellarisync.rrmtools.uk";
const STELLARIS_APP_ID = "281990";
const COMMUNITY_CACHE_TTL_MS = 45_000;

interface TableInfoRow {
    name: string;
}

interface DbProfileRow {
    Id: number;
    Name: string;
    IsActive: number;
    CreatedAt: string | null;
    SharedProfileId?: string | null;
    SharedProfileRevision?: number | null;
    SharedProfileUpdatedUtc?: string | null;
}

interface DbModRow {
    Id: number;
    WorkshopId: string;
    Name: string;
    Version: string;
    InstalledPath: string;
    DescriptorPath: string;
    IsEnabled: number;
    LoadOrder: number;
    InstalledAt: string | null;
    LastUpdatedAt: string | null;
    TotalSubscribers?: number | null;
    IsMultiplayerSafe?: number | null;
    Tags?: string | null;
    Description?: string | null;
    ThumbnailUrl?: string | null;
    GameVersion?: string | null;
}

interface SteamPublishedFileDetails {
    publishedfileid?: string;
    time_updated?: number | string;
    subscriptions?: number | string;
    preview_url?: string;
}

interface SteamDetailsResponse {
    response?: {
        publishedfiledetails?: SteamPublishedFileDetails[];
    };
}

interface RemoteCommunityCompatEntry {
    workedCount?: number;
    count?: number;
    notWorkedCount?: number;
    totalReports?: number;
    workedPercentage?: number;
    state?: string;
    tagConsensus?: CompatibilityTagConsensus[];
    groupConsensus?: CompatibilityTagGroupConsensus[];
    lastReportedUtc?: string | null;
}

interface RemoteCommunityTagsResponse {
    tags?: CompatibilityTagDefinition[];
}

export interface LibraryModContextMenuModel {
    modId: number;
    name: string;
    workshopId: string;
    workshopUrl: string | null;
    installedPath: string;
    descriptorPath: string;
    hasUpdate: boolean;
}

interface RemoteSharedProfilePayload {
    id?: string;
    name?: string;
    creator?: string;
    revision?: number | string | null;
    updatedUtc?: string | null;
    mods?: unknown;
}

interface RemoteLoadOrderResolvePayload {
    orderedMods?: unknown;
    appliedRules?: unknown;
    appliedEdges?: unknown;
    warnings?: unknown;
    confidence?: unknown;
}

interface SharedProfilePublishPayload {
    name: string;
    creator: string;
    mods: string[];
}

interface SharedProfilePublishTarget {
    shouldCreate: boolean;
    sharedProfileId: string | null;
}

interface SyncModRow {
    Id: number;
    WorkshopId: string;
    Name?: string;
    IsEnabled: number;
    LoadOrder: number;
    InstalledPath?: string;
    DescriptorPath?: string;
}

interface ManagedModPathRecord {
    id: number;
    workshopId: string;
    name?: string;
    installedPath: string;
    descriptorPath: string;
}

interface ManagedModsMigrationSummary {
    mods: ManagedModPathRecord[];
    movedModCount: number;
    rewrittenDescriptorCount: number;
}

const updateFlagsByWorkshopId = new Map<string, boolean>();
const communityCompatByMod = new Map<string, Record<string, LibraryCompatibilitySummary>>();
let communityTagsCache: CompatibilityTagDefinition[] = [];
let communityFetchedAt = 0;
let communityRefreshInFlight: Promise<void> | null = null;
const STELLARIS_CHECKSUM_FOLDERS = new Set(["common", "events", "map", "localisation_synced"]);

function nowIso(): string {
    return new Date().toISOString();
}

function normalizePathKey(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const candidate of paths) {
        const trimmed = (candidate ?? "").trim();
        if (!trimmed) {
            continue;
        }

        const key = normalizePathKey(trimmed);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(path.normalize(trimmed));
    }

    return deduped;
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

function buildWorkshopUrl(workshopId: string): string | null {
    const normalizedId = sanitizeWorkshopId(workshopId);
    if (!isValidWorkshopId(normalizedId)) {
        return null;
    }

    return `https://steamcommunity.com/sharedfiles/filedetails/?id=${normalizedId}`;
}

function isValidWorkshopId(value: string): boolean {
    return /^\d{6,}$/.test(value);
}

function isValidSharedProfileId(value: string): boolean {
    return /^[a-f0-9]{32}$/i.test(value);
}

function sanitizeSharedProfileId(value: string): string {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return "";
    }

    if (isValidSharedProfileId(raw)) {
        return raw;
    }

    const idParamMatch = raw.match(/[?&](?:id|profileId)=([a-f0-9]{32})\b/i);
    if (idParamMatch) {
        return idParamMatch[1];
    }

    const fallbackMatch = raw.match(/\b([a-f0-9]{32})\b/i);
    return fallbackMatch ? fallbackMatch[1] : raw;
}

export function getSharedProfilePublishTarget(value: string | null | undefined): SharedProfilePublishTarget {
    const sharedProfileId = sanitizeSharedProfileId(value ?? "");
    if (!sharedProfileId || !isValidSharedProfileId(sharedProfileId)) {
        return { shouldCreate: true, sharedProfileId: null };
    }

    return { shouldCreate: false, sharedProfileId };
}

function parseTags(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            return parsed
                .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                .filter((entry) => entry.length > 0);
        }
    } catch {
        // fallback below
    }

    return trimmed
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function toConsensusState(value: string | null | undefined): ConsensusState {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (
        normalized === "trusted"
        || normalized === "disputed"
        || normalized === "insufficient_votes"
        || normalized === "no_data"
    ) {
        return normalized;
    }

    return "insufficient_votes";
}

function normalizePatch(value: string | null | undefined): string | null {
    const token = String(value ?? "").match(/(\d+\.\d+(?:\.\d+)?)/);
    return token ? token[1] : null;
}

function normalizeMajorMinor(value: string | null | undefined): string | null {
    const token = normalizePatch(value)?.match(/(\d+\.\d+)/);
    return token ? token[1] : null;
}

function normalizeLibraryAchievementPath(value: string | null | undefined): string {
    return String(value ?? "")
        .replace(/\\/g, "/")
        .replace(/^\.?\//, "")
        .trim()
        .toLowerCase();
}

function directoryContainsLibraryFiles(directoryPath: string): boolean | null {
    const stack = [directoryPath];

    try {
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) {
                continue;
            }

            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink()) {
                    continue;
                }

                const fullPath = path.join(current, entry.name);
                if (entry.isFile()) {
                    return true;
                }

                if (entry.isDirectory()) {
                    stack.push(fullPath);
                }
            }
        }
    } catch {
        return null;
    }

    return false;
}

function resolveLibraryAchievementStatus(
    installedPath: string | null | undefined,
    checksumFolders: ReadonlySet<string> = STELLARIS_CHECKSUM_FOLDERS
): LibraryAchievementStatus {
    const root = String(installedPath ?? "").trim();
    if (!root) {
        return "unknown";
    }

    try {
        const stats = fs.statSync(root);
        if (!stats.isDirectory()) {
            return "unknown";
        }
    } catch {
        return "unknown";
    }

    let sawAnyFile = false;

    try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isFile()) {
                sawAnyFile = true;
                continue;
            }

            if (!entry.isDirectory()) {
                continue;
            }

            const containsFiles = directoryContainsLibraryFiles(path.join(root, entry.name));
            if (containsFiles === null) {
                return "unknown";
            }

            if (!containsFiles) {
                continue;
            }

            sawAnyFile = true;

            if (checksumFolders.has(normalizeLibraryAchievementPath(entry.name))) {
                return "not-compatible";
            }
        }
    } catch {
        return "unknown";
    }

    return sawAnyFile ? "compatible" : "unknown";
}

export function resolveLibraryAchievementStatusForTest(
    installedPath: string,
    checksumFolders?: string[]
): LibraryAchievementStatus {
    const normalizedChecksumFolders = Array.isArray(checksumFolders)
        ? new Set(
            checksumFolders
                .map((entry) => normalizeLibraryAchievementPath(entry))
                .filter((entry) => entry.length > 0)
        )
        : STELLARIS_CHECKSUM_FOLDERS;

    return resolveLibraryAchievementStatus(installedPath, normalizedChecksumFolders);
}

function toLibraryCompatibilitySummary(entry: RemoteCommunityCompatEntry | null | undefined): LibraryCompatibilitySummary {
    const workedCount = Number(entry?.workedCount ?? entry?.count ?? 0) || 0;
    const notWorkedCount = Number(entry?.notWorkedCount ?? 0) || 0;
    const totalReports = Number(entry?.totalReports ?? workedCount + notWorkedCount) || 0;
    const workedPercentage = Number(entry?.workedPercentage ?? (totalReports > 0 ? Math.round((workedCount * 100) / totalReports) : 0)) || 0;

    return {
        workedCount,
        notWorkedCount,
        totalReports,
        workedPercentage,
        state: toConsensusState(entry?.state),
        tagConsensus: Array.isArray(entry?.tagConsensus) ? entry?.tagConsensus : [],
        groupConsensus: Array.isArray(entry?.groupConsensus) ? entry?.groupConsensus : [],
        lastReportedUtc: typeof entry?.lastReportedUtc === "string" ? entry.lastReportedUtc : null,
    };
}

function getCompatibilitySummaryForVersion(
    byVersion: Record<string, LibraryCompatibilitySummary> | undefined,
    selectedVersion: string | null | undefined
): LibraryCompatibilitySummary | null {
    if (!byVersion || Object.keys(byVersion).length <= 0) {
        return null;
    }

    const selectedPatch = normalizePatch(selectedVersion);
    const selectedMajorMinor = normalizeMajorMinor(selectedVersion);

    if (selectedPatch && byVersion[selectedPatch]) {
        return byVersion[selectedPatch];
    }

    if (selectedMajorMinor && byVersion[selectedMajorMinor]) {
        return byVersion[selectedMajorMinor];
    }

    return null;
}

function normalizeTagDefinitions(value: unknown): CompatibilityTagDefinition[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalized: CompatibilityTagDefinition[] = [];
    const seen = new Set<string>();

    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) {
            continue;
        }

        const key = String((raw as { key?: string }).key ?? "").trim().toLowerCase();
        const label = String((raw as { label?: string }).label ?? "").trim();
        if (!key || !label || seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push({
            key,
            label,
            description: String((raw as { description?: string }).description ?? "").trim() || null,
            conflictGroup: String((raw as { conflictGroup?: string }).conflictGroup ?? "").trim() || null,
            createdBy: String((raw as { createdBy?: string }).createdBy ?? "").trim() === "system" ? "system" : "user",
            createdAtUtc: String((raw as { createdAtUtc?: string }).createdAtUtc ?? "").trim() || nowIso(),
        });
    }

    return normalized.sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 12_000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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

async function refreshCommunityCache(force = false): Promise<void> {
    if (!force && Date.now() - communityFetchedAt < COMMUNITY_CACHE_TTL_MS) {
        return;
    }

    if (communityRefreshInFlight) {
        await communityRefreshInFlight;
        return;
    }

    communityRefreshInFlight = (async () => {
        const [compatRaw, tagsPayload] = await Promise.all([
            fetchJsonWithTimeout<Record<string, Record<string, RemoteCommunityCompatEntry>>>(`${STELLARISYNC_BASE_URL}/mods/community-compat`),
            fetchJsonWithTimeout<RemoteCommunityTagsResponse>(`${STELLARISYNC_BASE_URL}/mods/community-tags`)
        ]);

        const nextCompat = new Map<string, Record<string, LibraryCompatibilitySummary>>();
        for (const [modId, byVersionRaw] of Object.entries(compatRaw)) {
            if (!isValidWorkshopId(modId) || typeof byVersionRaw !== "object" || byVersionRaw === null) {
                continue;
            }

            const byVersion: Record<string, LibraryCompatibilitySummary> = {};
            for (const [versionKey, entryRaw] of Object.entries(byVersionRaw)) {
                const patchKey = normalizePatch(versionKey) || versionKey.trim();
                if (!patchKey) {
                    continue;
                }

                byVersion[patchKey] = toLibraryCompatibilitySummary(entryRaw);
            }

            nextCompat.set(modId, byVersion);
        }

        communityCompatByMod.clear();
        for (const [modId, byVersion] of nextCompat.entries()) {
            communityCompatByMod.set(modId, byVersion);
        }

        communityTagsCache = normalizeTagDefinitions(tagsPayload?.tags);
        communityFetchedAt = Date.now();
    })()
        .catch(() => {
            // Keep stale cache on failures.
        })
        .finally(() => {
            communityRefreshInFlight = null;
        });

    await communityRefreshInFlight;
}

function normalizeDetectedGameVersion(rawVersion: string | null | undefined): string | null {
    const value = String(rawVersion ?? "").trim();
    if (!value) {
        return null;
    }

    const match = value.match(/(\d+)\.(\d+)(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    return `${match[1]}.${match[2]}`;
}


function openDb(): Database.Database | null {
    const dbPath = getLegacyPaths().modsDbPath;
    if (!fs.existsSync(dbPath)) {
        return null;
    }

    try {
        return new Database(dbPath, { fileMustExist: true });
    } catch {
        return null;
    }
}

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
        return new Set(rows.map((row) => row.name));
    } catch {
        return new Set<string>();
    }
}

function hasTable(db: Database.Database, tableName: string): boolean {
    try {
        const row = db
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
            .get(tableName) as { 1?: number } | undefined;
        return row !== undefined;
    } catch {
        return false;
    }
}

function getWorkshopColumn(columns: Set<string>): string | null {
    if (columns.has("SteamWorkshopId")) {
        return "SteamWorkshopId";
    }

    if (columns.has("WorkshopId")) {
        return "WorkshopId";
    }

    return null;
}

function normalizeLoadOrder(db: Database.Database): void {
    if (!hasTable(db, "Mods")) {
        return;
    }

    const rows = db
        .prepare(
            "SELECT Id, IsEnabled, LoadOrder, Name FROM Mods ORDER BY IsEnabled DESC, LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC"
        )
        .all() as Array<{ Id: number; IsEnabled: number; LoadOrder: number; Name: string }>;

    if (rows.length === 0) {
        return;
    }

    const enabled = rows.filter((row) => row.IsEnabled === 1);
    const disabled = rows.filter((row) => row.IsEnabled !== 1);
    const ordered = enabled.concat(disabled);

    const updateStmt = db.prepare("UPDATE Mods SET LoadOrder = ? WHERE Id = ?");
    const tx = db.transaction((items: Array<{ Id: number }>) => {
        let index = 0;
        for (const item of items) {
            updateStmt.run(index, item.Id);
            index += 1;
        }
    });

    tx(ordered);
}

function normalizeSharedProfileRevision(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeSharedProfileUpdatedUtc(value: unknown): string | null {
    const raw = String(value ?? "").trim();
    return raw || null;
}

function hasRemoteSharedProfileChanged(
    profile: Pick<DbProfileRow, "SharedProfileId" | "SharedProfileRevision" | "SharedProfileUpdatedUtc">,
    sharedProfileId: string,
    remoteProfile: RemoteSharedProfilePayload
): boolean {
    const localSharedProfileId = sanitizeSharedProfileId(profile.SharedProfileId ?? "");
    if (localSharedProfileId !== sharedProfileId) {
        return true;
    }

    const localRevision = normalizeSharedProfileRevision(profile.SharedProfileRevision);
    const remoteRevision = normalizeSharedProfileRevision(remoteProfile.revision);
    if (localRevision !== null || remoteRevision !== null) {
        return localRevision !== remoteRevision;
    }

    const localUpdatedUtc = normalizeSharedProfileUpdatedUtc(profile.SharedProfileUpdatedUtc);
    const remoteUpdatedUtc = normalizeSharedProfileUpdatedUtc(remoteProfile.updatedUtc);
    if (localUpdatedUtc || remoteUpdatedUtc) {
        return localUpdatedUtc !== remoteUpdatedUtc;
    }

    return true;
}

function ensureSharedProfileSyncColumns(db: Database.Database): void {
    const columns = getTableColumns(db, "Profiles");
    if (!columns.has("SharedProfileId")) {
        db.prepare("ALTER TABLE Profiles ADD COLUMN SharedProfileId TEXT NULL").run();
    }

    if (!columns.has("SharedProfileRevision")) {
        db.prepare("ALTER TABLE Profiles ADD COLUMN SharedProfileRevision INTEGER NULL").run();
    }

    if (!columns.has("SharedProfileUpdatedUtc")) {
        db.prepare("ALTER TABLE Profiles ADD COLUMN SharedProfileUpdatedUtc TEXT NULL").run();
    }
}

function getActiveProfileId(db: Database.Database): number | null {
    if (!hasTable(db, "Profiles")) {
        return null;
    }

    const row = db.prepare("SELECT Id FROM Profiles WHERE IsActive = 1 ORDER BY Id ASC LIMIT 1").get() as { Id: number } | undefined;
    return row?.Id ?? null;
}

function saveActiveProfileSnapshot(db: Database.Database): void {
    if (!hasTable(db, "Profiles") || !hasTable(db, "ProfileEntries") || !hasTable(db, "Mods")) {
        return;
    }

    const activeProfileId = getActiveProfileId(db);
    if (!activeProfileId) {
        return;
    }

    const enabledMods = db
        .prepare("SELECT Id FROM Mods WHERE IsEnabled = 1 ORDER BY LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC")
        .all() as Array<{ Id: number }>;

    const deleteStmt = db.prepare("DELETE FROM ProfileEntries WHERE ProfileId = ?");
    const insertStmt = db.prepare(
        "INSERT INTO ProfileEntries (ProfileId, ModId, IsEnabled, LoadOrder) VALUES (?, ?, 1, ?)"
    );

    const tx = db.transaction(() => {
        deleteStmt.run(activeProfileId);
        let order = 0;
        for (const mod of enabledMods) {
            insertStmt.run(activeProfileId, mod.Id, order);
            order += 1;
        }
    });

    tx();
}

function normalizeDescriptorReferenceKey(value: string): string {
    return value.replace(/\\/g, "/").trim().toLowerCase();
}

function resolveDescriptorLoadReference(descriptorModsPath: string, descriptorPath: string, workshopId: string): string {
    const explicitDescriptorPath = String(descriptorPath ?? "").trim();
    if (explicitDescriptorPath) {
        return buildManagedDescriptorReference({
            modsRoot: descriptorModsPath,
            descriptorPath: explicitDescriptorPath
        });
    }

    const normalizedWorkshopId = sanitizeWorkshopId(workshopId ?? "");
    if (!isValidWorkshopId(normalizedWorkshopId)) {
        return "";
    }

    return buildManagedDescriptorReference({
        modsRoot: descriptorModsPath,
        descriptorPath: path.join(descriptorModsPath, `${normalizedWorkshopId}.mod`)
    });
}

function resolveEnabledDescriptorPath(stellarisDir: string, descriptorReference: string): string {
    const trimmed = String(descriptorReference ?? "").trim();
    if (!trimmed) {
        return "";
    }

    const normalized = path.normalize(trimmed);
    return path.isAbsolute(normalized)
        ? normalized
        : path.join(stellarisDir, normalized);
}

function syncDlcLoadFromDb(db: Database.Database, settingsOverride?: SettingsSnapshot): void {
    if (!hasTable(db, "Mods")) {
        return;
    }

    const modColumns = getTableColumns(db, "Mods");
    const workshopColumn = getWorkshopColumn(modColumns);
    if (!workshopColumn) {
        return;
    }

    const settings = settingsOverride ?? loadSettingsSnapshot();
    const descriptorModsPath = resolveDescriptorModsDirectory(settings);
    const stellarisDir = path.dirname(descriptorModsPath);
    const dlcPath = path.join(stellarisDir, "dlc_load.json");

    const enabledRows = db
        .prepare(
            `SELECT ${workshopColumn} AS WorkshopId, DescriptorPath
             FROM Mods
             WHERE IsEnabled = 1
             ORDER BY LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC`
        )
        .all() as Array<{ WorkshopId: string; DescriptorPath: string }>;

    const enabledMods: string[] = [];
    const seen = new Set<string>();
    for (const row of enabledRows) {
        const descriptorReference = resolveDescriptorLoadReference(descriptorModsPath, row.DescriptorPath, row.WorkshopId);
        if (!descriptorReference) {
            continue;
        }

        const normalized = descriptorReference.replace(/\\/g, "/");
        const normalizedKey = normalizeDescriptorReferenceKey(normalized);
        if (seen.has(normalizedKey)) {
            continue;
        }

        seen.add(normalizedKey);
        enabledMods.push(normalized);
    }

    let disabledDlcs: unknown[] = [];
    try {
        if (fs.existsSync(dlcPath)) {
            const existing = JSON.parse(fs.readFileSync(dlcPath, "utf8")) as Record<string, unknown>;
            if (Array.isArray(existing.disabled_dlcs)) {
                disabledDlcs = existing.disabled_dlcs;
            }
        }
    } catch {
        disabledDlcs = [];
    }

    try {
        fs.mkdirSync(path.dirname(dlcPath), { recursive: true });
        fs.writeFileSync(
            dlcPath,
            JSON.stringify({
                disabled_dlcs: disabledDlcs,
                enabled_mods: enabledMods
            }, null, 2),
            "utf8"
        );
    } catch {
        // best effort; do not fail library operations
    }
}

function mapProfileRow(row: DbProfileRow): LibraryProfile {
    return {
        id: row.Id,
        name: row.Name,
        sharedProfileId: row.SharedProfileId?.trim() || null,
        sharedProfileRevision: normalizeSharedProfileRevision(row.SharedProfileRevision),
        sharedProfileUpdatedUtc: normalizeSharedProfileUpdatedUtc(row.SharedProfileUpdatedUtc),
        isActive: row.IsActive === 1,
        createdAtUtc: row.CreatedAt || null
    };
}

function mapModRow(row: DbModRow, defaultGameVersion: string | null): LibraryModItem {
    const workshopId = sanitizeWorkshopId(row.WorkshopId);
    const gameVersion = row.GameVersion?.trim() || defaultGameVersion || null;
    const byVersion = communityCompatByMod.get(workshopId);
    const communityCompatibility = getCompatibilitySummaryForVersion(byVersion, gameVersion);
    const achievementStatus = resolveLibraryAchievementStatus(row.InstalledPath);

    return {
        id: row.Id,
        workshopId,
        name: row.Name,
        version: row.Version,
        gameVersion,
        isEnabled: row.IsEnabled === 1,
        loadOrder: Number(row.LoadOrder) || 0,
        installedAtUtc: row.InstalledAt || null,
        lastUpdatedAtUtc: row.LastUpdatedAt || null,
        installedPath: row.InstalledPath,
        descriptorPath: row.DescriptorPath,
        totalSubscribers: Number(row.TotalSubscribers ?? 0) || 0,
        isMultiplayerSafe: Number(row.IsMultiplayerSafe ?? 0) === 1,
        tags: parseTags(row.Tags),
        description: row.Description?.trim() || null,
        thumbnailUrl: row.ThumbnailUrl?.trim() || null,
        hasUpdate: updateFlagsByWorkshopId.get(workshopId) === true,
        achievementStatus,
        communityCompatibility
    };
}

function readLibrarySnapshot(db: Database.Database): LibrarySnapshot {
    const settings = loadSettingsSnapshot();
    const fallbackGameVersion = normalizeDetectedGameVersion(settings?.lastDetectedGameVersion ?? "")
        || settings?.lastDetectedGameVersion?.trim()
        || null;

    if (!hasTable(db, "Mods")) {
        return {
            mods: [],
            profiles: [],
            activeProfileId: null,
            totalMods: 0,
            enabledMods: 0,
            updatesAvailable: 0,
            compatibilityReporterId: settings?.compatibilityReporterId?.trim() || null,
            lastDetectedGameVersion: settings?.lastDetectedGameVersion?.trim() || null
        };
    }

    const modColumns = getTableColumns(db, "Mods");
    const workshopColumn = getWorkshopColumn(modColumns);
    if (!workshopColumn) {
        return {
            mods: [],
            profiles: [],
            activeProfileId: null,
            totalMods: 0,
            enabledMods: 0,
            updatesAvailable: 0,
            compatibilityReporterId: settings?.compatibilityReporterId?.trim() || null,
            lastDetectedGameVersion: settings?.lastDetectedGameVersion?.trim() || null
        };
    }

    const selectExtras = [
        modColumns.has("TotalSubscribers") ? ", TotalSubscribers" : ", 0 AS TotalSubscribers",
        modColumns.has("IsMultiplayerSafe") ? ", IsMultiplayerSafe" : ", 0 AS IsMultiplayerSafe",
        modColumns.has("Tags") ? ", Tags" : ", NULL AS Tags",
        modColumns.has("Description") ? ", Description" : ", NULL AS Description",
        modColumns.has("ThumbnailUrl") ? ", ThumbnailUrl" : ", NULL AS ThumbnailUrl",
        modColumns.has("GameVersion") ? ", GameVersion" : ", NULL AS GameVersion"
    ].join("");

    const modRows = db
        .prepare(
            `SELECT Id,
                    ${workshopColumn} AS WorkshopId,
                    Name,
                    Version,
                    InstalledPath,
                    DescriptorPath,
                    IsEnabled,
                    LoadOrder,
                    InstalledAt,
                    LastUpdatedAt
                    ${selectExtras}
             FROM Mods
             ORDER BY IsEnabled DESC, LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC`
        )
        .all() as DbModRow[];

    const mods = modRows.map((row) => mapModRow(row, fallbackGameVersion));

    let profiles: LibraryProfile[] = [];
    if (hasTable(db, "Profiles")) {
        const profileColumns = getTableColumns(db, "Profiles");
        const sharedProfileSelection = profileColumns.has("SharedProfileId")
            ? "SharedProfileId"
            : "NULL AS SharedProfileId";
        const sharedProfileRevisionSelection = profileColumns.has("SharedProfileRevision")
            ? "SharedProfileRevision"
            : "NULL AS SharedProfileRevision";
        const sharedProfileUpdatedUtcSelection = profileColumns.has("SharedProfileUpdatedUtc")
            ? "SharedProfileUpdatedUtc"
            : "NULL AS SharedProfileUpdatedUtc";

        const rows = db
            .prepare(
                `SELECT Id,
                        Name,
                        IsActive,
                        CreatedAt,
                        ${sharedProfileSelection},
                        ${sharedProfileRevisionSelection},
                        ${sharedProfileUpdatedUtcSelection}
                 FROM Profiles
                 ORDER BY Name COLLATE NOCASE ASC, Id ASC`
            )
            .all() as DbProfileRow[];

        profiles = rows.map(mapProfileRow);

        if (profiles.length === 0) {
            db.prepare("INSERT INTO Profiles (Name, IsActive, CreatedAt, SharedProfileId) VALUES (?, 1, ?, NULL)")
                .run("Default Profile", nowIso());

            saveActiveProfileSnapshot(db);

            const newRows = db
                .prepare(
                    `SELECT Id,
                            Name,
                            IsActive,
                            CreatedAt,
                            ${sharedProfileSelection},
                            ${sharedProfileRevisionSelection},
                            ${sharedProfileUpdatedUtcSelection}
                     FROM Profiles
                     ORDER BY Name COLLATE NOCASE ASC, Id ASC`
                )
                .all() as DbProfileRow[];

            profiles = newRows.map(mapProfileRow);
        }
    }

    const activeProfileId = profiles.find((profile) => profile.isActive)?.id ?? null;
    const enabledMods = mods.filter((mod) => mod.isEnabled).length;
    const updatesAvailable = mods.filter((mod) => mod.hasUpdate).length;
    return {
        mods,
        profiles,
        activeProfileId,
        totalMods: mods.length,
        enabledMods,
        updatesAvailable,
        compatibilityReporterId: settings?.compatibilityReporterId?.trim() || null,
        lastDetectedGameVersion: settings?.lastDetectedGameVersion?.trim() || null
    };
}

function buildEmptySnapshot(): LibrarySnapshot {
    const settings = loadSettingsSnapshot();
    return {
        mods: [],
        profiles: [],
        activeProfileId: null,
        totalMods: 0,
        enabledMods: 0,
        updatesAvailable: 0,
        compatibilityReporterId: settings?.compatibilityReporterId?.trim() || null,
        lastDetectedGameVersion: settings?.lastDetectedGameVersion?.trim() || null
    };
}

function ensureProfileExists(db: Database.Database): void {
    if (!hasTable(db, "Profiles")) {
        return;
    }

    const countRow = db.prepare("SELECT COUNT(*) AS count FROM Profiles").get() as { count: number };
    if ((countRow?.count ?? 0) > 0) {
        const activeCountRow = db.prepare("SELECT COUNT(*) AS count FROM Profiles WHERE IsActive = 1").get() as { count: number };
        if ((activeCountRow?.count ?? 0) <= 0) {
            const fallback = db
                .prepare("SELECT Id FROM Profiles ORDER BY Name COLLATE NOCASE ASC, Id ASC LIMIT 1")
                .get() as { Id: number } | undefined;
            if (fallback) {
                db.prepare("UPDATE Profiles SET IsActive = 0").run();
                db.prepare("UPDATE Profiles SET IsActive = 1 WHERE Id = ?").run(fallback.Id);
            }
        }
        return;
    }

    ensureSharedProfileSyncColumns(db);
    db.prepare("INSERT INTO Profiles (Name, IsActive, CreatedAt, SharedProfileId) VALUES (?, 1, ?, NULL)")
        .run("Default", nowIso());
}

function ensureLibrarySchema(db: Database.Database): void {
    ensureModsTable(db);
    ensureProfilesTables(db);
    ensureSharedProfileSyncColumns(db);
    ensureProfileExists(db);
}

function openLibraryDb(): Database.Database | null {
    const db = openOrCreateDb();
    if (!db) {
        return null;
    }

    try {
        ensureLibrarySchema(db);
        return db;
    } catch (e) {
        console.error("Failed to ensure library schema:", e);
        db.close();
        return null;
    }
}

async function copyPathReplacingTarget(sourcePath: string, targetPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await deletePathIfExists(targetPath);
    await fsp.cp(sourcePath, targetPath, { recursive: true, force: true });
}

async function deletePathIfExists(targetPath: string): Promise<void> {
    if (!targetPath) {
        return;
    }

    try {
        await fsp.rm(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 6,
            retryDelay: 250
        });
    } catch {
        // best effort
    }
}

function getManagedModFolderName(mod: ManagedModPathRecord): string {
    const installedBase = path.basename(mod.installedPath || "").trim();
    if (installedBase) {
        return installedBase;
    }

    const descriptorBase = path.parse(mod.descriptorPath || "").name.trim();
    if (descriptorBase) {
        return descriptorBase;
    }

    const workshopId = sanitizeWorkshopId(mod.workshopId || "");
    if (workshopId) {
        return workshopId;
    }

    return `mod-${mod.id}`;
}

function getManagedDescriptorFileName(mod: ManagedModPathRecord, folderName: string): string {
    const descriptorBase = path.basename(mod.descriptorPath || "").trim();
    if (descriptorBase.toLowerCase().endsWith(".mod")) {
        return descriptorBase;
    }

    return `${folderName}.mod`;
}

async function loadDescriptorTemplate(mod: ManagedModPathRecord, folderName: string): Promise<string> {
    const descriptorPath = String(mod.descriptorPath ?? "").trim();
    if (descriptorPath && fs.existsSync(descriptorPath)) {
        return fsp.readFile(descriptorPath, "utf8");
    }

    let descriptorContent = "";
    descriptorContent = upsertQuotedDescriptorField(
        descriptorContent,
        "name",
        String(mod.name ?? "").trim() || folderName
    );

    const workshopId = sanitizeWorkshopId(mod.workshopId ?? "");
    if (isValidWorkshopId(workshopId)) {
        descriptorContent = upsertQuotedDescriptorField(descriptorContent, "remote_file_id", workshopId);
    }

    return descriptorContent;
}

async function migrateManagedMods(input: {
    descriptorModsPath: string;
    currentManagedModsPath: string;
    nextManagedModsPath: string;
    moveExistingMods: boolean;
    mods: ManagedModPathRecord[];
}): Promise<ManagedModsMigrationSummary> {
    const descriptorModsPath = path.resolve(input.descriptorModsPath);
    const nextManagedModsPath = path.resolve(input.nextManagedModsPath);
    await Promise.all([
        fsp.mkdir(descriptorModsPath, { recursive: true }),
        fsp.mkdir(nextManagedModsPath, { recursive: true })
    ]);

    let movedModCount = 0;
    let rewrittenDescriptorCount = 0;
    const migratedMods: ManagedModPathRecord[] = [];
    const totalModCount = input.mods.length;

    updateModsPathMigrationProgress({
        currentModName: null,
        currentPhase: input.moveExistingMods ? "Preparing move" : "Preparing descriptor updates",
        processedModCount: 0,
        totalModCount,
        progressPercent: totalModCount > 0 ? 0 : 100,
        lastMessage: input.moveExistingMods
            ? `Moving managed mods to the new managed mods folder. (0 of ${totalModCount} complete)`
            : `Updating managed mod descriptor paths. (0 of ${totalModCount} complete)`
    });

    for (let index = 0; index < input.mods.length; index += 1) {
        const mod = input.mods[index];
        const folderName = getManagedModFolderName(mod);
        const modDisplayName = String(mod.name ?? "").trim() || folderName;
        const descriptorFileName = getManagedDescriptorFileName(mod, folderName);
        const nextInstalledPath = path.join(nextManagedModsPath, folderName);
        const nextDescriptorPath = path.join(descriptorModsPath, descriptorFileName);
        const currentInstalledPath = String(mod.installedPath ?? "").trim();
        const currentDescriptorPath = String(mod.descriptorPath ?? "").trim();

        updateModsPathMigrationProgress({
            currentModName: modDisplayName,
            currentPhase: input.moveExistingMods ? "Moving files" : "Updating descriptor",
            processedModCount: index,
            totalModCount,
            progressPercent: totalModCount > 0 ? (index / totalModCount) * 100 : 100,
            lastMessage: input.moveExistingMods
                ? `Moving managed mods to the new managed mods folder. (${index} of ${totalModCount} complete)`
                : `Updating managed mod descriptor paths. (${index} of ${totalModCount} complete)`
        });

        if (
            input.moveExistingMods
            && currentInstalledPath
            && fs.existsSync(currentInstalledPath)
            && path.resolve(currentInstalledPath) !== path.resolve(nextInstalledPath)
        ) {
            await copyPathReplacingTarget(currentInstalledPath, nextInstalledPath);
            await deletePathIfExists(currentInstalledPath);
            movedModCount += 1;
        }

        updateModsPathMigrationProgress({
            currentModName: modDisplayName,
            currentPhase: "Writing descriptor",
            processedModCount: index,
            totalModCount,
            progressPercent: totalModCount > 0 ? (index / totalModCount) * 100 : 100
        });

        let descriptorContent = await loadDescriptorTemplate(mod, folderName);
        const workshopId = sanitizeWorkshopId(mod.workshopId ?? "");
        if (isValidWorkshopId(workshopId)) {
            descriptorContent = upsertQuotedDescriptorField(descriptorContent, "remote_file_id", workshopId);
        }
        descriptorContent = upsertQuotedDescriptorField(
            descriptorContent,
            "path",
            buildManagedDescriptorPath({
                modsRoot: descriptorModsPath,
                installedPath: nextInstalledPath
            })
        );

        await fsp.mkdir(path.dirname(nextDescriptorPath), { recursive: true });
        await fsp.writeFile(nextDescriptorPath, descriptorContent, "utf8");
        rewrittenDescriptorCount += 1;

        if (currentDescriptorPath && path.resolve(currentDescriptorPath) !== path.resolve(nextDescriptorPath)) {
            await deletePathIfExists(currentDescriptorPath);
        }

        migratedMods.push({
            ...mod,
            installedPath: nextInstalledPath,
            descriptorPath: nextDescriptorPath
        });

        updateModsPathMigrationProgress({
            currentModName: modDisplayName,
            currentPhase: "Completed",
            processedModCount: index + 1,
            totalModCount,
            progressPercent: totalModCount > 0 ? ((index + 1) / totalModCount) * 100 : 100,
            lastMessage: input.moveExistingMods
                ? `Moving managed mods to the new managed mods folder. (${index + 1} of ${totalModCount} complete)`
                : `Updating managed mod descriptor paths. (${index + 1} of ${totalModCount} complete)`
        });
    }

    return {
        mods: migratedMods,
        movedModCount,
        rewrittenDescriptorCount
    };
}

export async function migrateManagedModsForTest(input: {
    descriptorModsPath: string;
    currentManagedModsPath: string;
    nextManagedModsPath: string;
    moveExistingMods: boolean;
    mods: ManagedModPathRecord[];
}): Promise<ManagedModsMigrationSummary> {
    return migrateManagedMods(input);
}

function fetchDetailsInChunks(ids: string[]): Promise<Map<string, SteamPublishedFileDetails>> {
    const result = new Map<string, SteamPublishedFileDetails>();

    const run = async (): Promise<void> => {
        for (let offset = 0; offset < ids.length; offset += 100) {
            const chunk = ids.slice(offset, offset + 100);
            const formData = new URLSearchParams();
            formData.append("itemcount", String(chunk.length));

            for (let i = 0; i < chunk.length; i += 1) {
                formData.append(`publishedfileids[${i}]`, chunk[i]);
            }

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

            const payload = (await response.json()) as SteamDetailsResponse;
            for (const detail of payload.response?.publishedfiledetails ?? []) {
                const workshopId = sanitizeWorkshopId(String(detail.publishedfileid ?? ""));
                if (isValidWorkshopId(workshopId)) {
                    result.set(workshopId, detail);
                }
            }
        }
    };

    return run().then(() => result);
}

export async function getLibrarySnapshot(): Promise<LibrarySnapshot> {
    await refreshCommunityCache(false);

    const db = openLibraryDb();
    if (!db) {
        return buildEmptySnapshot();
    }

    try {
        return readLibrarySnapshot(db);
    } finally {
        db.close();
    }
}

export function getLibraryModContextMenuModel(modId: number): LibraryModContextMenuModel | null {
    const db = openLibraryDb();
    if (!db) {
        return null;
    }

    try {
        const snapshot = readLibrarySnapshot(db);
        const mod = snapshot.mods.find((candidate) => candidate.id === modId);
        if (!mod) {
            return null;
        }

        return {
            modId: mod.id,
            name: mod.name,
            workshopId: mod.workshopId,
            workshopUrl: buildWorkshopUrl(mod.workshopId),
            installedPath: mod.installedPath,
            descriptorPath: mod.descriptorPath,
            hasUpdate: mod.hasUpdate
        };
    } finally {
        db.close();
    }
}

export async function migrateModsPath(request: ModsPathMigrationRequest): Promise<ModsPathMigrationResult> {
    const currentSettings = loadSettingsSnapshot() ?? {};
    const nextSettings: SettingsSnapshot = {
        ...currentSettings,
        ...(request.settings ?? {})
    };
    nextSettings.modsPath = resolveDescriptorModsDirectory(nextSettings);
    nextSettings.managedModsPath = resolveManagedModsDirectory(nextSettings);

    const descriptorModsPath = nextSettings.modsPath;
    const currentManagedModsPath = resolveManagedModsDirectory(currentSettings);
    const nextManagedModsPath = nextSettings.managedModsPath;
    if (!nextManagedModsPath) {
        return {
            ok: false,
            message: "Managed mods folder is required.",
            settings: nextSettings,
            movedModCount: 0,
            rewrittenDescriptorCount: 0
        };
    }

    if (getGameRunningStatus()) {
        return {
            ok: false,
            message: "Close Stellaris before changing the managed mods folder.",
            settings: nextSettings,
            movedModCount: 0,
            rewrittenDescriptorCount: 0
        };
    }

    if (!startModsPathMigration({
        sourceModsPath: currentManagedModsPath,
        targetModsPath: nextManagedModsPath,
        moveExistingMods: request.moveExistingMods === true
    })) {
        return {
            ok: false,
            message: "A managed mods folder change is already running.",
            settings: nextSettings,
            movedModCount: 0,
            rewrittenDescriptorCount: 0
        };
    }

    let db: Database.Database | null = null;
    let result: ModsPathMigrationResult = {
        ok: false,
        message: "Failed to change managed mods folder.",
        settings: nextSettings,
        movedModCount: 0,
        rewrittenDescriptorCount: 0
    };

    try {
        db = openLibraryDb();
        if (!db) {
            const saveResult = saveSettingsSnapshot(nextSettings);
            result = {
                ...saveResult,
                movedModCount: 0,
                rewrittenDescriptorCount: 0
            };
            return result;
        }

        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            const saveResult = saveSettingsSnapshot(nextSettings);
            result = {
                ...saveResult,
                movedModCount: 0,
                rewrittenDescriptorCount: 0
            };
            return result;
        }

        const trackedMods = db
            .prepare(
                `SELECT Id,
                        ${workshopColumn} AS WorkshopId,
                        Name,
                        InstalledPath,
                        DescriptorPath
                 FROM Mods
                 ORDER BY Id ASC`
            )
            .all() as Array<{ Id: number; WorkshopId: string; Name: string; InstalledPath: string; DescriptorPath: string }>;

        if (trackedMods.length <= 0) {
            const saveResult = saveSettingsSnapshot(nextSettings);
            result = {
                ...saveResult,
                message: saveResult.ok
                    ? `Managed mods folder saved to ${nextManagedModsPath}. No tracked mods needed migration.`
                    : saveResult.message,
                movedModCount: 0,
                rewrittenDescriptorCount: 0
            };
            return result;
        }

        const migration = await migrateManagedMods({
            descriptorModsPath,
            currentManagedModsPath,
            nextManagedModsPath,
            moveExistingMods: request.moveExistingMods === true,
            mods: trackedMods.map((mod) => ({
                id: mod.Id,
                workshopId: mod.WorkshopId,
                name: mod.Name,
                installedPath: mod.InstalledPath,
                descriptorPath: mod.DescriptorPath
            }))
        });

        const updatedAt = nowIso();
        const updateStmt = db.prepare(
            `UPDATE Mods
             SET InstalledPath = ?,
                 DescriptorPath = ?,
                 LastUpdatedAt = ?
             WHERE Id = ?`
        );
        const tx = db.transaction((mods: ManagedModPathRecord[]) => {
            for (const mod of mods) {
                updateStmt.run(mod.installedPath, mod.descriptorPath, updatedAt, mod.id);
            }
        });
        tx(migration.mods);

        const saveResult = saveSettingsSnapshot(nextSettings);
        if (!saveResult.ok) {
            result = {
                ...saveResult,
                movedModCount: migration.movedModCount,
                rewrittenDescriptorCount: migration.rewrittenDescriptorCount
            };
            return result;
        }

        syncDlcLoadFromDb(db, saveResult.settings);

        result = {
            ok: true,
            message: request.moveExistingMods === true
                ? `Updated ${migration.rewrittenDescriptorCount} descriptor file(s) and moved ${migration.movedModCount} mod folder(s) to ${nextManagedModsPath}.`
                : `Updated ${migration.rewrittenDescriptorCount} descriptor file(s) for ${nextManagedModsPath}. Mod folders were not moved.`,
            settings: saveResult.settings,
            movedModCount: migration.movedModCount,
            rewrittenDescriptorCount: migration.rewrittenDescriptorCount
        };
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown managed-mods migration error";
        result = {
            ok: false,
            message: `Failed to change managed mods folder: ${message}`,
            settings: nextSettings,
            movedModCount: 0,
            rewrittenDescriptorCount: 0
        };
        return result;
    } finally {
        finishModsPathMigration({
            ok: result.ok,
            message: result.message
        });
        db?.close();
    }
}

export function createLibraryProfile(nameRaw: string): LibraryActionResult {
    const name = (nameRaw ?? "").trim();
    if (!name) {
        return { ok: false, message: "Profile name is required." };
    }

    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const existing = db.prepare("SELECT Id FROM Profiles WHERE Name = ? COLLATE NOCASE LIMIT 1").get(name) as { Id: number } | undefined;
        if (existing) {
            return { ok: false, message: "A profile with that name already exists." };
        }

        db.prepare("INSERT INTO Profiles (Name, IsActive, CreatedAt, SharedProfileId) VALUES (?, 0, ?, NULL)")
            .run(name, nowIso());
        return { ok: true, message: `Created profile '${name}'.` };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown create-profile error";
        return { ok: false, message: `Failed to create profile: ${message}` };
    } finally {
        db.close();
    }
}

export function renameLibraryProfile(request: LibraryRenameProfileRequest): LibraryActionResult {
    const name = (request.name ?? "").trim();
    if (!name) {
        return { ok: false, message: "Profile name is required." };
    }

    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const row = db.prepare("SELECT Id FROM Profiles WHERE Id = ?").get(request.profileId) as { Id: number } | undefined;
        if (!row) {
            return { ok: false, message: "Profile not found." };
        }

        const duplicate = db
            .prepare("SELECT Id FROM Profiles WHERE Name = ? COLLATE NOCASE AND Id <> ? LIMIT 1")
            .get(name, request.profileId) as { Id: number } | undefined;
        if (duplicate) {
            return { ok: false, message: "A profile with that name already exists." };
        }

        db.prepare("UPDATE Profiles SET Name = ? WHERE Id = ?").run(name, request.profileId);
        return { ok: true, message: "Profile renamed." };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown rename-profile error";
        return { ok: false, message: `Failed to rename profile: ${message}` };
    } finally {
        db.close();
    }
}

export function deleteLibraryProfile(profileId: number): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const countRow = db.prepare("SELECT COUNT(*) AS count FROM Profiles").get() as { count: number };
        if ((countRow?.count ?? 0) <= 1) {
            return { ok: false, message: "At least one profile must remain." };
        }

        const target = db.prepare("SELECT Id, IsActive FROM Profiles WHERE Id = ?").get(profileId) as { Id: number; IsActive: number } | undefined;
        if (!target) {
            return { ok: false, message: "Profile not found." };
        }

        const tx = db.transaction(() => {
            db.prepare("DELETE FROM ProfileEntries WHERE ProfileId = ?").run(profileId);
            db.prepare("DELETE FROM Profiles WHERE Id = ?").run(profileId);

            if (target.IsActive === 1) {
                const fallback = db
                    .prepare("SELECT Id FROM Profiles ORDER BY Name COLLATE NOCASE ASC, Id ASC LIMIT 1")
                    .get() as { Id: number } | undefined;
                if (fallback) {
                    db.prepare("UPDATE Profiles SET IsActive = 0").run();
                    db.prepare("UPDATE Profiles SET IsActive = 1 WHERE Id = ?").run(fallback.Id);

                    db.prepare("UPDATE Mods SET IsEnabled = 0").run();
                    const entries = db
                        .prepare("SELECT ModId, IsEnabled, LoadOrder FROM ProfileEntries WHERE ProfileId = ? ORDER BY LoadOrder ASC, Id ASC")
                        .all(fallback.Id) as Array<{ ModId: number; IsEnabled: number; LoadOrder: number }>;

                    const applyStmt = db.prepare("UPDATE Mods SET IsEnabled = ?, LoadOrder = ? WHERE Id = ?");
                    for (const entry of entries) {
                        applyStmt.run(entry.IsEnabled, entry.LoadOrder, entry.ModId);
                    }
                    normalizeLoadOrder(db);
                    saveActiveProfileSnapshot(db);
                    syncDlcLoadFromDb(db);
                }
            }
        });

        tx();
        return { ok: true, message: "Profile deleted." };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown delete-profile error";
        return { ok: false, message: `Failed to delete profile: ${message}` };
    } finally {
        db.close();
    }
}

export function previewLibraryProfileActivation(profileId: number): LibraryProfileActivationPreviewResult {
    const db = openLibraryDb();
    if (!db) {
        return buildProfileActivationPreviewFailure("mods.db is not available.");
    }

    try {
        const target = db.prepare("SELECT Id, Name FROM Profiles WHERE Id = ?").get(profileId) as { Id: number; Name: string } | undefined;
        if (!target) {
            return buildProfileActivationPreviewFailure("Profile not found.");
        }

        const activeProfileId = getActiveProfileId(db);
        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return buildProfileActivationPreviewFailure("Could not determine workshop ID column in Mods table.");
        }

        const localRows = db
            .prepare(`SELECT Id, ${workshopColumn} AS WorkshopId, Name, IsEnabled, LoadOrder FROM Mods`)
            .all() as SyncModRow[];
        const currentRows = localRows
            .filter((row) => row.IsEnabled === 1)
            .sort((a, b) => a.LoadOrder - b.LoadOrder || String(a.Name || "").localeCompare(String(b.Name || "")));
        const profileRows = db
            .prepare(
                `SELECT m.Id, m.${workshopColumn} AS WorkshopId, m.Name, pe.IsEnabled, pe.LoadOrder
                 FROM ProfileEntries pe
                 INNER JOIN Mods m ON m.Id = pe.ModId
                 WHERE pe.ProfileId = ? AND pe.IsEnabled = 1
                 ORDER BY pe.LoadOrder ASC, pe.Id ASC`
            )
            .all(profileId) as SyncModRow[];
        const wantedSet = new Set(profileRows.map((row) => row.Id));
        const rowsToEnable = profileRows.filter((row) => {
            const current = localRows.find((entry) => entry.Id === row.Id);
            return !current || current.IsEnabled !== 1;
        });
        const rowsToDisable = localRows.filter((row) => row.IsEnabled === 1 && !wantedSet.has(row.Id));
        const preview = buildLoadOrderPreview(
            currentRows,
            profileRows,
            profileRows.map((row) => sanitizeWorkshopId(row.WorkshopId)).filter(isValidWorkshopId),
            activeProfileId === profileId
                ? `Profile '${target.Name}' is already active. Review the current enabled load order.`
                : `Review profile '${target.Name}' before it changes enabled mods or load order.`,
            {
                profileName: target.Name,
                confidence: "high"
            }
        );

        return {
            ...preview,
            enableModNames: rowsToEnable.map((row) => row.Name?.trim() || row.WorkshopId || `Mod ${row.Id}`),
            disableModNames: rowsToDisable.map((row) => row.Name?.trim() || row.WorkshopId || `Mod ${row.Id}`)
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown activate-profile preview error";
        return buildProfileActivationPreviewFailure(`Failed to preview profile activation: ${message}`);
    } finally {
        db.close();
    }
}

export function activateLibraryProfile(profileId: number): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const target = db.prepare("SELECT Id, Name FROM Profiles WHERE Id = ?").get(profileId) as { Id: number; Name: string } | undefined;
        if (!target) {
            return { ok: false, message: "Profile not found." };
        }

        const tx = db.transaction(() => {
            db.prepare("UPDATE Profiles SET IsActive = 0").run();
            db.prepare("UPDATE Profiles SET IsActive = 1 WHERE Id = ?").run(profileId);

            db.prepare("UPDATE Mods SET IsEnabled = 0").run();

            const entries = db
                .prepare("SELECT ModId, IsEnabled, LoadOrder FROM ProfileEntries WHERE ProfileId = ? ORDER BY LoadOrder ASC, Id ASC")
                .all(profileId) as Array<{ ModId: number; IsEnabled: number; LoadOrder: number }>;

            const updateStmt = db.prepare("UPDATE Mods SET IsEnabled = ?, LoadOrder = ? WHERE Id = ?");
            for (const entry of entries) {
                updateStmt.run(entry.IsEnabled, entry.LoadOrder, entry.ModId);
            }

            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();
        return { ok: true, message: `Activated profile: ${target.Name}` };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown activate-profile error";
        return { ok: false, message: `Failed to activate profile: ${message}` };
    } finally {
        db.close();
    }
}

export function setLibraryProfileSharedId(request: LibrarySetSharedProfileIdRequest): LibraryActionResult {
    const sharedProfileId = (request.sharedProfileId ?? "").trim();
    if (!sharedProfileId) {
        return { ok: false, message: "Shared profile ID is required." };
    }

    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const row = db.prepare("SELECT Id FROM Profiles WHERE Id = ?").get(request.profileId) as { Id: number } | undefined;
        if (!row) {
            return { ok: false, message: "Profile not found." };
        }

        db.prepare(`
            UPDATE Profiles
            SET SharedProfileId = ?,
                SharedProfileRevision = NULL,
                SharedProfileUpdatedUtc = NULL
            WHERE Id = ?
        `).run(sharedProfileId, request.profileId);
        return { ok: true, message: "Shared profile ID saved." };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown shared-id error";
        return { ok: false, message: `Failed to update shared profile ID: ${message}` };
    } finally {
        db.close();
    }
}

export async function publishLibrarySharedProfile(
    request: LibraryPublishSharedProfileRequest
): Promise<LibraryPublishSharedProfileResult> {
    const db = openLibraryDb();
    if (!db) {
        return {
            ok: false,
            message: "mods.db is not available.",
            sharedProfileId: null,
            created: false
        };
    }

    try {
        const profile = db
            .prepare("SELECT Id, Name, SharedProfileId FROM Profiles WHERE Id = ?")
            .get(request.profileId) as { Id: number; Name: string; SharedProfileId?: string | null } | undefined;
        if (!profile) {
            return {
                ok: false,
                message: "Profile not found.",
                sharedProfileId: null,
                created: false
            };
        }

        const creator = loadSettingsSnapshot()?.publicProfileUsername?.trim() || "";
        if (!creator) {
            return {
                ok: false,
                message: "Public username is required for sharing. Set it in Settings > General.",
                sharedProfileId: null,
                created: false
            };
        }

        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return {
                ok: false,
                message: "Could not determine workshop ID column in Mods table.",
                sharedProfileId: null,
                created: false
            };
        }

        if (getActiveProfileId(db) === request.profileId) {
            saveActiveProfileSnapshot(db);
        }

        const publishTarget = getSharedProfilePublishTarget(profile.SharedProfileId ?? "");
        const profileMods = db
            .prepare(
                `SELECT m.${workshopColumn} AS WorkshopId
                 FROM ProfileEntries pe
                 INNER JOIN Mods m ON m.Id = pe.ModId
                 WHERE pe.ProfileId = ? AND pe.IsEnabled = 1
                 ORDER BY pe.LoadOrder ASC, pe.Id ASC`
            )
            .all(request.profileId) as Array<{ WorkshopId: string }>;
        const mods = normalizeSharedProfileMods(profileMods.map((row) => row.WorkshopId));
        if (mods.length <= 0) {
            return {
                ok: false,
                message: "Profile has no enabled mods to share.",
                sharedProfileId: publishTarget.sharedProfileId,
                created: false
            };
        }

        const payload: SharedProfilePublishPayload = {
            name: profile.Name?.trim() || "Shared Profile",
            creator,
            mods
        };
        const endpoint = publishTarget.shouldCreate || !publishTarget.sharedProfileId
            ? `${STELLARISYNC_BASE_URL}/profiles`
            : `${STELLARISYNC_BASE_URL}/profiles/${encodeURIComponent(publishTarget.sharedProfileId)}/update`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);

        let remoteProfile: RemoteSharedProfilePayload;
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                let reason = `Request failed with HTTP ${response.status}.`;
                try {
                    const errorPayload = await response.json() as { error?: string };
                    if (typeof errorPayload.error === "string" && errorPayload.error.trim()) {
                        reason = errorPayload.error.trim();
                    }
                } catch {
                    // keep fallback HTTP message
                }

                throw new Error(reason);
            }

            remoteProfile = (await response.json()) as RemoteSharedProfilePayload;
        } finally {
            clearTimeout(timeout);
        }

        const sharedProfileId = sanitizeSharedProfileId(remoteProfile.id ?? publishTarget.sharedProfileId ?? "");
        if (!sharedProfileId || !isValidSharedProfileId(sharedProfileId)) {
            return {
                ok: false,
                message: "Stellarisync did not return a valid shared profile ID.",
                sharedProfileId: null,
                created: false
            };
        }

        db.prepare(`
            UPDATE Profiles
            SET SharedProfileId = ?,
                SharedProfileRevision = ?,
                SharedProfileUpdatedUtc = ?
            WHERE Id = ?
        `).run(
            sharedProfileId,
            normalizeSharedProfileRevision(remoteProfile.revision),
            normalizeSharedProfileUpdatedUtc(remoteProfile.updatedUtc),
            request.profileId
        );

        const created = publishTarget.shouldCreate || publishTarget.sharedProfileId !== sharedProfileId;
        const remoteName = String(remoteProfile.name ?? payload.name).trim() || payload.name;
        return {
            ok: true,
            message: created
                ? `Shared profile '${remoteName}' published to Stellarisync.`
                : `Shared profile '${remoteName}' updated on Stellarisync.`,
            sharedProfileId,
            created
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown shared profile publish error";
        return {
            ok: false,
            message: `Failed to publish shared profile: ${message}`,
            sharedProfileId: null,
            created: false
        };
    } finally {
        db.close();
    }
}

function buildSharedProfileSyncFailure(message: string): LibrarySyncSharedProfileResult {
    return {
        ok: false,
        message,
        profileName: null,
        missingWorkshopIds: [],
        enabledCount: 0,
        disabledCount: 0,
        syncedLoadOrderCount: 0
    };
}

function normalizeSharedProfileMods(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const rawEntry of value) {
        const workshopId = sanitizeWorkshopId(typeof rawEntry === "string" ? rawEntry : "");
        if (!isValidWorkshopId(workshopId) || seen.has(workshopId)) {
            continue;
        }

        seen.add(workshopId);
        ordered.push(workshopId);
    }

    return ordered;
}

async function fetchSharedProfile(sharedProfileId: string, sinceRaw?: string): Promise<RemoteSharedProfilePayload> {
    const url = new URL(`${STELLARISYNC_BASE_URL}/profiles/${encodeURIComponent(sharedProfileId)}`);
    const since = String(sinceRaw ?? "").trim();
    if (since) {
        url.searchParams.set("since", since);
    }

    const response = await fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        let reason = `Request failed with HTTP ${response.status}.`;
        try {
            const payload = await response.json() as { error?: string };
            if (typeof payload.error === "string" && payload.error.trim()) {
                reason = payload.error.trim();
            }
        } catch {
            // keep fallback message
        }

        throw new Error(reason);
    }

    return (await response.json()) as RemoteSharedProfilePayload;
}

function buildLoadOrderPreviewFailure(message: string): LibraryLoadOrderPreviewResult {
    return {
        ok: false,
        message,
        orderedWorkshopIds: [],
        changes: [],
        appliedRules: [],
        appliedEdges: [],
        warnings: [],
        confidence: "low"
    };
}

function buildSharedProfileSyncPreviewFailure(message: string): LibrarySharedProfileSyncPreviewResult {
    return {
        ...buildLoadOrderPreviewFailure(message),
        profileName: null,
        missingWorkshopIds: [],
        enableModNames: [],
        disableModNames: [],
        remoteRevision: null,
        remoteUpdatedUtc: null
    };
}

function buildProfileActivationPreviewFailure(message: string): LibraryProfileActivationPreviewResult {
    return {
        ...buildLoadOrderPreviewFailure(message),
        profileName: null,
        enableModNames: [],
        disableModNames: []
    };
}

function normalizeRemoteStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);
}

function normalizeResolveConfidence(value: unknown): "high" | "medium" | "low" {
    const text = String(value ?? "").trim().toLowerCase();
    return text === "high" || text === "medium" || text === "low" ? text : "low";
}

async function fetchLoadOrderResolve(mods: string[], gameVersion: string | null): Promise<RemoteLoadOrderResolvePayload> {
    const response = await fetch(`${STELLARISYNC_BASE_URL}/mods/load-order-resolve`, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            gameVersion: gameVersion || undefined,
            mods
        })
    });

    if (!response.ok) {
        let reason = `Request failed with HTTP ${response.status}.`;
        try {
            const payload = await response.json() as { error?: string };
            if (typeof payload.error === "string" && payload.error.trim()) {
                reason = payload.error.trim();
            }
        } catch {
            // keep fallback message
        }

        throw new Error(reason);
    }

    return (await response.json()) as RemoteLoadOrderResolvePayload;
}

function getEnabledLoadOrderRows(db: Database.Database, workshopColumn: string): SyncModRow[] {
    return db
        .prepare(
            `SELECT Id, ${workshopColumn} AS WorkshopId, Name, IsEnabled, LoadOrder
             FROM Mods
             WHERE IsEnabled = 1
             ORDER BY LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC`
        )
        .all() as SyncModRow[];
}

function buildLoadOrderPreview(
    currentRows: SyncModRow[],
    proposedRows: SyncModRow[],
    orderedWorkshopIds: string[],
    message: string,
    extras?: Partial<LibraryLoadOrderPreviewResult>
): LibraryLoadOrderPreviewResult {
    const currentIndexById = new Map<number, number>();
    currentRows.forEach((row, index) => currentIndexById.set(row.Id, index));

    const changes: LibraryLoadOrderChange[] = [];
    proposedRows.forEach((row, index) => {
        const fromIndex = currentIndexById.has(row.Id) ? currentIndexById.get(row.Id) ?? -1 : -1;
        if (fromIndex === index) {
            return;
        }

        changes.push({
            modId: row.Id,
            workshopId: sanitizeWorkshopId(row.WorkshopId),
            name: row.Name?.trim() || row.WorkshopId || `Mod ${row.Id}`,
            fromIndex,
            toIndex: index
        });
    });

    return {
        ok: true,
        message,
        orderedWorkshopIds,
        changes,
        appliedRules: extras?.appliedRules ?? [],
        appliedEdges: extras?.appliedEdges ?? [],
        warnings: extras?.warnings ?? [],
        confidence: extras?.confidence ?? "medium",
        profileName: extras?.profileName ?? null
    };
}

function buildProposedRowsFromWorkshopIds(currentRows: SyncModRow[], orderedWorkshopIds: string[]): SyncModRow[] {
    const byWorkshopId = new Map<string, SyncModRow>();
    for (const row of currentRows) {
        const workshopId = sanitizeWorkshopId(row.WorkshopId);
        if (isValidWorkshopId(workshopId) && !byWorkshopId.has(workshopId)) {
            byWorkshopId.set(workshopId, row);
        }
    }

    const seen = new Set<number>();
    const proposedRows: SyncModRow[] = [];
    for (const rawWorkshopId of orderedWorkshopIds) {
        const workshopId = sanitizeWorkshopId(rawWorkshopId);
        const row = byWorkshopId.get(workshopId);
        if (!row || seen.has(row.Id)) {
            continue;
        }

        seen.add(row.Id);
        proposedRows.push(row);
    }

    for (const row of currentRows) {
        if (!seen.has(row.Id)) {
            seen.add(row.Id);
            proposedRows.push(row);
        }
    }

    return proposedRows;
}

function applyConfirmedLoadOrder(db: Database.Database, orderedWorkshopIds: string[]): number {
    const modColumns = getTableColumns(db, "Mods");
    const workshopColumn = getWorkshopColumn(modColumns);
    if (!workshopColumn) {
        throw new Error("Could not determine workshop ID column in Mods table.");
    }

    const currentRows = getEnabledLoadOrderRows(db, workshopColumn);
    const proposedRows = buildProposedRowsFromWorkshopIds(currentRows, orderedWorkshopIds);
    const updateStmt = db.prepare("UPDATE Mods SET LoadOrder = ? WHERE Id = ?");

    for (let i = 0; i < proposedRows.length; i++) {
        updateStmt.run(i, proposedRows[i].Id);
    }

    normalizeLoadOrder(db);
    saveActiveProfileSnapshot(db);
    syncDlcLoadFromDb(db);
    return proposedRows.length;
}

export async function getLibraryLoadOrderSuggestion(): Promise<LibraryLoadOrderPreviewResult> {
    const db = openLibraryDb();
    if (!db) {
        return buildLoadOrderPreviewFailure("mods.db is not available.");
    }

    try {
        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return buildLoadOrderPreviewFailure("Could not determine workshop ID column in Mods table.");
        }

        const currentRows = getEnabledLoadOrderRows(db, workshopColumn);
        const currentWorkshopIds = currentRows
            .map((row) => sanitizeWorkshopId(row.WorkshopId))
            .filter(isValidWorkshopId);

        if (currentWorkshopIds.length < 2) {
            return buildLoadOrderPreviewFailure("At least two enabled Workshop mods are required for load-order suggestions.");
        }

        const settings = loadSettingsSnapshot();
        const gameVersion = normalizeDetectedGameVersion(settings?.lastDetectedGameVersion);
        const payload = await fetchLoadOrderResolve(currentWorkshopIds, gameVersion);
        const orderedWorkshopIds = normalizeRemoteStringArray(payload.orderedMods)
            .map(sanitizeWorkshopId)
            .filter(isValidWorkshopId);
        const proposedRows = buildProposedRowsFromWorkshopIds(currentRows, orderedWorkshopIds);
        const preview = buildLoadOrderPreview(
            currentRows,
            proposedRows,
            proposedRows.map((row) => sanitizeWorkshopId(row.WorkshopId)).filter(isValidWorkshopId),
            "Review the suggested Stellarisync load order before applying it.",
            {
                appliedRules: normalizeRemoteStringArray(payload.appliedRules),
                appliedEdges: normalizeRemoteStringArray(payload.appliedEdges),
                warnings: normalizeRemoteStringArray(payload.warnings),
                confidence: normalizeResolveConfidence(payload.confidence)
            }
        );

        if (preview.changes.length === 0) {
            return {
                ...preview,
                message: "Stellarisync found no load-order changes for the enabled mods."
            };
        }

        return preview;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown load-order suggestion error";
        return buildLoadOrderPreviewFailure(`Failed to get load-order suggestion: ${message}`);
    } finally {
        db.close();
    }
}

export function applyLibraryLoadOrderSuggestion(request: LibraryApplyLoadOrderRequest): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const orderedWorkshopIds = Array.isArray(request.orderedWorkshopIds)
            ? request.orderedWorkshopIds.map(sanitizeWorkshopId).filter(isValidWorkshopId)
            : [];
        if (orderedWorkshopIds.length < 2) {
            return { ok: false, message: "A confirmed ordered workshop ID list is required." };
        }

        const tx = db.transaction(() => applyConfirmedLoadOrder(db, orderedWorkshopIds));
        const appliedCount = tx();
        return { ok: true, message: `Applied suggested load order to ${appliedCount} enabled mod(s).` };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown load-order apply error";
        return { ok: false, message: `Failed to apply load order: ${message}` };
    } finally {
        db.close();
    }
}

export async function previewLibrarySharedProfileSync(
    request: LibrarySyncSharedProfileRequest
): Promise<LibrarySharedProfileSyncPreviewResult> {
    const sharedProfileId = sanitizeSharedProfileId(request.sharedProfileId ?? "");
    if (!sharedProfileId) {
        return buildSharedProfileSyncPreviewFailure("Shared profile ID is required.");
    }

    if (!isValidSharedProfileId(sharedProfileId)) {
        return buildSharedProfileSyncPreviewFailure("Invalid shared profile ID format.");
    }

    const db = openLibraryDb();
    if (!db) {
        return buildSharedProfileSyncPreviewFailure("mods.db is not available.");
    }

    try {
        const profile = db
            .prepare(`
                SELECT Id, SharedProfileId, SharedProfileRevision, SharedProfileUpdatedUtc
                FROM Profiles
                WHERE Id = ?
            `)
            .get(request.profileId) as DbProfileRow | undefined;
        if (!profile) {
            return buildSharedProfileSyncPreviewFailure("Profile not found.");
        }

        const remoteProfile = await fetchSharedProfile(sharedProfileId, request.sharedProfileSince);
        const profileName = typeof remoteProfile.name === "string" && remoteProfile.name.trim()
            ? remoteProfile.name.trim()
            : null;
        if (!hasRemoteSharedProfileChanged(profile, sharedProfileId, remoteProfile)) {
            return {
                ...buildSharedProfileSyncPreviewFailure("No remote changes found."),
                ok: true,
                profileName,
                remoteRevision: normalizeSharedProfileRevision(remoteProfile.revision),
                remoteUpdatedUtc: normalizeSharedProfileUpdatedUtc(remoteProfile.updatedUtc)
            };
        }

        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return buildSharedProfileSyncPreviewFailure("Could not determine workshop ID column in Mods table.");
        }

        const remoteMods = normalizeSharedProfileMods(remoteProfile.mods);
        const settings = loadSettingsSnapshot();
        const descriptorModsPath = resolveDescriptorModsDirectory(settings);
        const managedModsPath = resolveManagedModsDirectory(settings);
        const workshopRoots = getWorkshopContentRoots(settings?.steamCmdDownloadPath);
        const localRows = db
            .prepare(
                `SELECT Id, ${workshopColumn} AS WorkshopId, Name, IsEnabled, LoadOrder, InstalledPath, DescriptorPath
                 FROM Mods`
            )
            .all() as SyncModRow[];
        const currentRows = localRows
            .filter((row) => row.IsEnabled === 1)
            .sort((a, b) => a.LoadOrder - b.LoadOrder || String(a.Name || "").localeCompare(String(b.Name || "")));

        const localByWorkshopId = new Map<string, SyncModRow>();
        for (const row of localRows) {
            const workshopId = sanitizeWorkshopId(row.WorkshopId);
            if (isValidWorkshopId(workshopId) && !localByWorkshopId.has(workshopId)) {
                localByWorkshopId.set(workshopId, row);
            }
        }

        const missingWorkshopIds: string[] = [];
        const wantedRows: SyncModRow[] = [];
        const wantedSet = new Set(remoteMods);
        for (const workshopId of remoteMods) {
            const local = localByWorkshopId.get(workshopId);
            if (!local || !isWorkshopModInstalledLocally(workshopId, local, descriptorModsPath, managedModsPath, workshopRoots)) {
                missingWorkshopIds.push(workshopId);
                continue;
            }

            wantedRows.push(local);
        }

        const rowsToDisable = localRows.filter((row) => {
            const workshopId = sanitizeWorkshopId(row.WorkshopId);
            return row.IsEnabled === 1 && !wantedSet.has(workshopId);
        });
        const rowsToEnable = wantedRows.filter((row) => row.IsEnabled !== 1);
        const preview = buildLoadOrderPreview(
            currentRows,
            wantedRows,
            wantedRows.map((row) => sanitizeWorkshopId(row.WorkshopId)).filter(isValidWorkshopId),
            "Review the shared profile sync before it changes enabled mods or load order.",
            {
                profileName,
                confidence: "high"
            }
        );

        return {
            ...preview,
            missingWorkshopIds,
            enableModNames: rowsToEnable.map((row) => row.Name?.trim() || row.WorkshopId || `Mod ${row.Id}`),
            disableModNames: rowsToDisable.map((row) => row.Name?.trim() || row.WorkshopId || `Mod ${row.Id}`),
            remoteRevision: normalizeSharedProfileRevision(remoteProfile.revision),
            remoteUpdatedUtc: normalizeSharedProfileUpdatedUtc(remoteProfile.updatedUtc)
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown shared-profile preview error";
        return buildSharedProfileSyncPreviewFailure(`Failed to preview shared profile: ${message}`);
    } finally {
        db.close();
    }
}

export async function syncLibrarySharedProfile(
    request: LibrarySyncSharedProfileRequest
): Promise<LibrarySyncSharedProfileResult> {
    const sharedProfileId = sanitizeSharedProfileId(request.sharedProfileId ?? "");
    if (!sharedProfileId) {
        return buildSharedProfileSyncFailure("Shared profile ID is required.");
    }

    if (!isValidSharedProfileId(sharedProfileId)) {
        return buildSharedProfileSyncFailure("Invalid shared profile ID format.");
    }

    const db = openLibraryDb();
    if (!db) {
        return buildSharedProfileSyncFailure("mods.db is not available.");
    }

    try {
        const profile = db
            .prepare(`
                SELECT Id, SharedProfileId, SharedProfileRevision, SharedProfileUpdatedUtc
                FROM Profiles
                WHERE Id = ?
            `)
            .get(request.profileId) as DbProfileRow | undefined;
        if (!profile) {
            return buildSharedProfileSyncFailure("Profile not found.");
        }

        const remoteProfile = await fetchSharedProfile(sharedProfileId, request.sharedProfileSince);
        const profileName = typeof remoteProfile.name === "string" && remoteProfile.name.trim()
            ? remoteProfile.name.trim()
            : null;

        if (!hasRemoteSharedProfileChanged(profile, sharedProfileId, remoteProfile)) {
            return {
                ok: true,
                message: "No remote changes found.",
                profileName,
                missingWorkshopIds: [],
                enabledCount: 0,
                disabledCount: 0,
                syncedLoadOrderCount: 0
            };
        }

        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return buildSharedProfileSyncFailure("Could not determine workshop ID column in Mods table.");
        }

        const remoteMods = normalizeSharedProfileMods(remoteProfile.mods);
        const settings = loadSettingsSnapshot();
        const descriptorModsPath = resolveDescriptorModsDirectory(settings);
        const managedModsPath = resolveManagedModsDirectory(settings);
        const workshopRoots = getWorkshopContentRoots(settings?.steamCmdDownloadPath);
        const localRows = db
            .prepare(
                `SELECT Id, ${workshopColumn} AS WorkshopId, IsEnabled, LoadOrder, InstalledPath, DescriptorPath
                 FROM Mods`
            )
            .all() as SyncModRow[];

        const localByWorkshopId = new Map<string, SyncModRow>();
        for (const row of localRows) {
            const workshopId = sanitizeWorkshopId(row.WorkshopId);
            if (isValidWorkshopId(workshopId) && !localByWorkshopId.has(workshopId)) {
                localByWorkshopId.set(workshopId, row);
            }
        }

        const missingWorkshopIds: string[] = [];
        const wantedRows: SyncModRow[] = [];
        const wantedSet = new Set(remoteMods);

        for (const workshopId of remoteMods) {
            const local = localByWorkshopId.get(workshopId);
            if (!local || !isWorkshopModInstalledLocally(workshopId, local, descriptorModsPath, managedModsPath, workshopRoots)) {
                missingWorkshopIds.push(workshopId);
                continue;
            }

            wantedRows.push(local);
        }

        const rowsToDisable = localRows.filter((row) => {
            const workshopId = sanitizeWorkshopId(row.WorkshopId);
            return row.IsEnabled === 1 && !wantedSet.has(workshopId);
        });

        let enabledCount = 0;
        let disabledCount = 0;

        const tx = db.transaction(() => {
            db.prepare(`
                UPDATE Profiles
                SET SharedProfileId = ?,
                    SharedProfileRevision = ?,
                    SharedProfileUpdatedUtc = ?
                WHERE Id = ?
            `).run(
                sharedProfileId,
                normalizeSharedProfileRevision(remoteProfile.revision),
                normalizeSharedProfileUpdatedUtc(remoteProfile.updatedUtc),
                request.profileId
            );

            const setEnabledAndOrderStmt = db.prepare("UPDATE Mods SET IsEnabled = ?, LoadOrder = ? WHERE Id = ?");
            for (const row of rowsToDisable) {
                setEnabledAndOrderStmt.run(0, row.LoadOrder, row.Id);
                disabledCount += 1;
            }

            let order = 0;
            for (const row of wantedRows) {
                if (row.IsEnabled !== 1) {
                    enabledCount += 1;
                }

                setEnabledAndOrderStmt.run(1, order, row.Id);
                order += 1;
            }

            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();

        const missingCount = missingWorkshopIds.length;
        const syncedLoadOrderCount = wantedRows.length;
        const profileLabel = profileName ? ` '${profileName}'` : "";

        return {
            ok: true,
            message: missingCount > 0
                ? `Shared profile${profileLabel} synced. Enabled ${enabledCount}, disabled ${disabledCount}, synced load order for ${syncedLoadOrderCount} mod(s). ${missingCount} mod(s) are missing locally.`
                : `Shared profile${profileLabel} synced. Enabled ${enabledCount}, disabled ${disabledCount}, synced load order for ${syncedLoadOrderCount} mod(s).`,
            profileName,
            missingWorkshopIds,
            enabledCount,
            disabledCount,
            syncedLoadOrderCount
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown shared-profile sync error";
        return buildSharedProfileSyncFailure(`Failed to sync shared profile: ${message}`);
    } finally {
        db.close();
    }
}

export function setLibraryModEnabled(request: LibrarySetModEnabledRequest): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const row = db.prepare("SELECT Id FROM Mods WHERE Id = ?").get(request.modId) as { Id: number } | undefined;
        if (!row) {
            return { ok: false, message: "Mod not found." };
        }

        const tx = db.transaction(() => {
            db.prepare("UPDATE Mods SET IsEnabled = ? WHERE Id = ?").run(request.isEnabled ? 1 : 0, request.modId);
            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();
        return {
            ok: true,
            message: request.isEnabled ? "Mod enabled." : "Mod disabled."
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown enable-toggle error";
        return { ok: false, message: `Failed to toggle mod state: ${message}` };
    } finally {
        db.close();
    }
}

export function moveLibraryMod(request: LibraryMoveDirectionRequest): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const enabledMods = db
            .prepare("SELECT Id, LoadOrder, IsEnabled FROM Mods WHERE IsEnabled = 1 ORDER BY LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC")
            .all() as Array<{ Id: number; LoadOrder: number; IsEnabled: number }>;

        const index = enabledMods.findIndex((entry) => entry.Id === request.modId);
        if (index < 0) {
            return { ok: false, message: "Only enabled mods can be reordered." };
        }

        const nextIndex = request.direction === "up" ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= enabledMods.length) {
            return { ok: false, message: "Mod is already at the edge of the load order." };
        }

        const current = enabledMods[index];
        const adjacent = enabledMods[nextIndex];

        const tx = db.transaction(() => {
            db.prepare("UPDATE Mods SET LoadOrder = ? WHERE Id = ?").run(adjacent.LoadOrder, current.Id);
            db.prepare("UPDATE Mods SET LoadOrder = ? WHERE Id = ?").run(current.LoadOrder, adjacent.Id);
            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();
        return { ok: true, message: "Load order updated." };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown load-order error";
        return { ok: false, message: `Failed to move mod: ${message}` };
    } finally {
        db.close();
    }
}

export async function uninstallLibraryMod(modId: number): Promise<LibraryActionResult> {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return { ok: false, message: "Could not determine workshop ID column in Mods table." };
        }

        const mod = db
            .prepare(
                `SELECT Id, ${workshopColumn} AS WorkshopId, Name, InstalledPath, DescriptorPath
                 FROM Mods WHERE Id = ?`
            )
            .get(modId) as
            | { Id: number; WorkshopId: string; Name: string; InstalledPath: string; DescriptorPath: string }
            | undefined;

        if (!mod) {
            return { ok: false, message: "Mod not found." };
        }

        await deletePathIfExists(mod.InstalledPath);
        await deletePathIfExists(mod.DescriptorPath);

        const tx = db.transaction(() => {
            if (hasTable(db, "ProfileEntries")) {
                db.prepare("DELETE FROM ProfileEntries WHERE ModId = ?").run(modId);
            }

            db.prepare("DELETE FROM Mods WHERE Id = ?").run(modId);
            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();
        updateFlagsByWorkshopId.delete(sanitizeWorkshopId(mod.WorkshopId));
        return { ok: true, message: `Removed mod: ${mod.Name}` };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown uninstall error";
        return { ok: false, message: `Failed to remove mod: ${message}` };
    } finally {
        db.close();
    }
}

export async function checkLibraryUpdates(): Promise<LibraryActionResult> {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return { ok: false, message: "Could not determine workshop ID column in Mods table." };
        }

        const rows = db
            .prepare(
                `SELECT ${workshopColumn} AS WorkshopId,
                        COALESCE(LastUpdatedAt, InstalledAt) AS LocalUpdatedUtc
                 FROM Mods
                 WHERE ${workshopColumn} IS NOT NULL AND ${workshopColumn} <> ''`
            )
            .all() as Array<{ WorkshopId: string; LocalUpdatedUtc: string | null }>;

        const workshopIds = rows
            .map((entry) => sanitizeWorkshopId(entry.WorkshopId))
            .filter((entry) => isValidWorkshopId(entry));

        if (workshopIds.length === 0) {
            updateFlagsByWorkshopId.clear();
            return { ok: true, message: "No installed workshop mods to check." };
        }

        const localUpdatedById = new Map<string, number>();
        for (const row of rows) {
            const id = sanitizeWorkshopId(row.WorkshopId);
            if (!isValidWorkshopId(id)) {
                continue;
            }

            const localUpdated = Date.parse(row.LocalUpdatedUtc ?? "");
            localUpdatedById.set(id, Number.isFinite(localUpdated) ? localUpdated : 0);
        }

        const details = await fetchDetailsInChunks(workshopIds);
        let updatesAvailable = 0;

        const hasThumbnailCol = modColumns.has("ThumbnailUrl");
        const hasSubscribersCol = modColumns.has("TotalSubscribers");

        const enrichStmt = db.prepare(
            `UPDATE Mods
             SET TotalSubscribers = COALESCE(?, TotalSubscribers)
                 ${hasThumbnailCol ? ", ThumbnailUrl = COALESCE(NULLIF(?, ''), ThumbnailUrl)" : ""}
             WHERE ${workshopColumn} = ?`
        );

        const enrichTx = db.transaction(() => {
            for (const workshopId of workshopIds) {
                const detail = details.get(workshopId);
                if (!detail) continue;

                const subs = Number(detail.subscriptions ?? 0);
                const subsValue = Number.isFinite(subs) && subs > 0 ? subs : null;
                const thumbValue = hasThumbnailCol
                    ? (detail.preview_url?.trim() || null)
                    : undefined;

                if (hasSubscribersCol && (subsValue !== null || thumbValue !== undefined)) {
                    enrichStmt.run(
                        ...(hasThumbnailCol
                            ? [subsValue, thumbValue, workshopId]
                            : [subsValue, workshopId])
                    );
                }
            }
        });

        for (const workshopId of workshopIds) {
            const detail = details.get(workshopId);
            const remoteRaw = Number(detail?.time_updated ?? 0);
            const remoteUpdated = Number.isFinite(remoteRaw) ? remoteRaw * 1000 : 0;
            const localUpdated = localUpdatedById.get(workshopId) ?? 0;
            const hasUpdate = remoteUpdated > localUpdated + 60_000;
            updateFlagsByWorkshopId.set(workshopId, hasUpdate);
            if (hasUpdate) {
                updatesAvailable += 1;
            }
        }

        enrichTx();

        return {
            ok: true,
            message: updatesAvailable > 0
                ? `${updatesAvailable} mod update(s) available.`
                : "All installed mods are up to date."
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown update-check error";
        return { ok: false, message: `Failed to check for updates: ${message}` };
    } finally {
        db.close();
    }
}

export async function exportLibraryMods(filePath: string): Promise<LibraryActionResult> {
    const targetPath = (filePath ?? "").trim();
    if (!targetPath) {
        return { ok: false, message: "A destination path is required." };
    }

    const snapshot = await getLibrarySnapshot();
    const sorted = snapshot.mods
        .slice()
        .sort((a, b) => a.loadOrder - b.loadOrder || a.name.localeCompare(b.name));

    const payload = {
        Version: "1.0",
        ExportedAt: nowIso(),
        GameVersion: snapshot.lastDetectedGameVersion,
        Mods: sorted.map((mod) => ({
            WorkshopId: mod.workshopId,
            Name: mod.name,
            IsEnabled: mod.isEnabled,
            LoadOrder: mod.loadOrder
        }))
    };

    try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
        return { ok: true, message: `Exported ${payload.Mods.length} mods.` };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown export error";
        return { ok: false, message: `Failed to export mods: ${message}` };
    }
}

export async function importLibraryMods(filePath: string): Promise<LibraryImportResult> {
    const sourcePath = (filePath ?? "").trim();
    if (!sourcePath) {
        return {
            ok: false,
            message: "A source path is required.",
            queuedCount: 0,
            ignoredCount: 0,
            sourcePath: null
        };
    }

    if (!fs.existsSync(sourcePath)) {
        return {
            ok: false,
            message: "Import file was not found.",
            queuedCount: 0,
            ignoredCount: 0,
            sourcePath
        };
    }

    try {
        const raw = fs.readFileSync(sourcePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        const modsRaw = (parsed.Mods ?? parsed.mods) as Array<Record<string, unknown>> | undefined;
        const entries = Array.isArray(modsRaw) ? modsRaw : [];

        let queuedCount = 0;
        let ignoredCount = 0;

        for (const entry of entries) {
            const workshopId = sanitizeWorkshopId(String(entry.WorkshopId ?? entry.workshopId ?? ""));
            if (!isValidWorkshopId(workshopId)) {
                ignoredCount += 1;
                continue;
            }

            const result = await queueDownload({
                workshopId,
                modName: String(entry.Name ?? entry.name ?? workshopId),
                action: "install"
            });
            if (result.ok) {
                queuedCount += 1;
            } else {
                ignoredCount += 1;
            }
        }

        return {
            ok: true,
            message: ignoredCount > 0
                ? `Queued ${queuedCount} mod(s) from import; ignored ${ignoredCount} invalid or duplicate entr${ignoredCount === 1 ? "y" : "ies"}.`
                : `Queued ${queuedCount} mod(s) from import.`,
            queuedCount,
            ignoredCount,
            sourcePath
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown import error";
        return {
            ok: false,
            message: `Failed to import mod list: ${message}`,
            queuedCount: 0,
            ignoredCount: 0,
            sourcePath
        };
    }
}

function getOrCreateCompatibilityReporterId(): string | null {
    let reporterId = loadSettingsSnapshot()?.compatibilityReporterId?.trim() || null;
    if (reporterId) {
        return reporterId;
    }

    reporterId = crypto.randomUUID();
    const currentSettings = loadSettingsSnapshot();
    if (!currentSettings) {
        return reporterId;
    }

    currentSettings.compatibilityReporterId = reporterId;
    saveSettingsSnapshot(currentSettings);
    return reporterId;
}

function normalizeSelectedTags(value: string[] | undefined): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawTag of value) {
        const key = String(rawTag ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
        if (!key || key.length < 2 || key.length > 50 || seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(key);
    }

    return normalized;
}

export async function getCompatibilityTags(): Promise<CompatibilityTagCatalogResult> {
    try {
        const payload = await fetchJsonWithTimeout<RemoteCommunityTagsResponse>(`${STELLARISYNC_BASE_URL}/mods/community-tags`);
        const tags = normalizeTagDefinitions(payload?.tags);
        communityTagsCache = tags;
        return {
            ok: true,
            message: tags.length > 0 ? `Loaded ${tags.length} compatibility tag(s).` : "No compatibility tags available.",
            tags,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown tags error";
        return {
            ok: false,
            message: `Failed to load compatibility tags: ${message}`,
            tags: communityTagsCache,
        };
    }
}

export async function reportLibraryCompatibility(request: LibraryCompatibilityReportRequest): Promise<LibraryActionResult> {
    const workshopId = sanitizeWorkshopId(request.workshopId);
    let gameVersion = (request.gameVersion ?? "").trim();

    if (!isValidWorkshopId(workshopId)) {
        return { ok: false, message: "Invalid workshop id." };
    }

    if (!gameVersion) {
        gameVersion = loadSettingsSnapshot()?.lastDetectedGameVersion?.trim() || "";
    }

    if (!gameVersion) {
        return { ok: false, message: "Game version is required for compatibility reporting." };
    }

    const reporterId = getOrCreateCompatibilityReporterId();
    if (!reporterId) {
        return { ok: false, message: "Could not determine compatibility reporter identity." };
    }

    const tagsOnly = request.tagsOnly === true;
    const outcome = tagsOnly
        ? undefined
        : request.outcome
            ? request.outcome
            : request.worked === false
                ? "not_worked"
                : "worked";
    const selectedTags = normalizeSelectedTags(request.selectedTags);

    try {
        const requestBody: Record<string, unknown> = {
            modId: workshopId,
            gameVersion,
            selectedTags,
            reporterId,
            reporter: reporterId,
            tagsOnly,
        };

        if (outcome) {
            requestBody.worked = outcome === "worked";
            requestBody.outcome = outcome;
        }

        const response = await fetch(`${STELLARISYNC_BASE_URL}/mods/community-compat/report`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            let errorMessage = `Compatibility report failed with HTTP ${response.status}.`;
            try {
                const errorPayload = await response.json() as { error?: string };
                if (typeof errorPayload?.error === "string" && errorPayload.error.trim().length > 0) {
                    errorMessage = errorPayload.error.trim();
                }
            } catch {
                // keep fallback HTTP status message
            }

            return {
                ok: false,
                message: errorMessage
            };
        }

        const payload = await response.json() as {
            state?: string;
            confidencePercent?: number;
            totalReports?: number;
            previousOutcome?: "worked" | "not_worked" | null;
        };

        await refreshCommunityCache(true);

        const consensusState = toConsensusState(payload?.state);
        const confidence = Number(payload?.confidencePercent ?? 0) || 0;
        const totalReports = Number(payload?.totalReports ?? 0) || 0;
        const statusText = consensusState === "trusted"
            ? `Trusted consensus (${confidence}%).`
            : consensusState === "disputed"
                ? `Disputed community feedback (${confidence}% lead).`
                : "More reports are needed for consensus.";

        if (tagsOnly) {
            const previousOutcomeLabel = payload?.previousOutcome === "not_worked"
                ? "Broken for me"
                : "Works for me";
            return {
                ok: true,
                message: selectedTags.length > 0
                    ? `Saved tags for your '${previousOutcomeLabel}' vote. ${statusText} (${totalReports} total report(s)).`
                    : `Removed all tags from your '${previousOutcomeLabel}' vote. ${statusText} (${totalReports} total report(s)).`
            };
        }

        return {
            ok: true,
            message: outcome === "worked"
                ? `Submitted 'Works for me' report. ${statusText} (${totalReports} total report(s)).`
                : `Submitted 'Broken for me' report. ${statusText} (${totalReports} total report(s)).`
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown compatibility-report error";
        return { ok: false, message: `Failed to submit compatibility report: ${message}` };
    }
}

/* ============================================================
   LOCAL MOD SCANNING
   ============================================================ */

interface ParsedModDescriptor {
    name: string;
    modPath: string;
    remoteFileId: string;
    supportedVersion: string;
    tags: string[];
}

function parseModDescriptor(filePath: string): ParsedModDescriptor | null {
    try {
        const content = fs.readFileSync(filePath, "utf8");

        const extractQuoted = (key: string): string => {
            const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
            return match ? match[1] : "";
        };

        const name = extractQuoted("name");
        if (!name) return null;

        const modPath = extractQuoted("path");
        const remoteFileId = extractQuoted("remote_file_id");
        const supportedVersion = extractQuoted("supported_version");

        const tagsMatch = content.match(/tags\s*=\s*\{([^}]*)\}/s);
        const tags: string[] = [];
        if (tagsMatch) {
            const tagRegex = /"([^"]*)"/g;
            let tm: RegExpExecArray | null;
            while ((tm = tagRegex.exec(tagsMatch[1])) !== null) {
                if (tm[1].trim()) tags.push(tm[1].trim());
            }
        }

        return { name, modPath, remoteFileId, supportedVersion, tags };
    } catch {
        return null;
    }
}

function readDlcEnabledMods(stellarisDir: string): Set<string> {
    const dlcPath = path.join(stellarisDir, "dlc_load.json");
    if (!fs.existsSync(dlcPath)) return new Set();

    try {
        const raw = JSON.parse(fs.readFileSync(dlcPath, "utf8")) as Record<string, unknown>;
        const enabled = raw.enabled_mods;
        if (!Array.isArray(enabled)) return new Set();
        return new Set(
            enabled
                .map((entry) => normalizeDescriptorReferenceKey(String(entry)))
                .filter((entry) => entry.length > 0)
        );
    } catch {
        return new Set();
    }
}

interface DescriptorCandidate {
    descriptorPath: string;
    source: "local" | "workshop";
    workshopIdHint: string;
    workshopRootDir: string | null;
}

function openOrCreateDb(): Database.Database | null {
    const dbPath = getLegacyPaths().modsDbPath;
    try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        return new Database(dbPath);
    } catch {
        return null;
    }
}

function ensureModsTable(db: Database.Database): void {
    if (hasTable(db, "Mods")) return;

    db.exec(`CREATE TABLE Mods (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        SteamWorkshopId TEXT NOT NULL DEFAULT '',
        Name TEXT NOT NULL DEFAULT '',
        Version TEXT NOT NULL DEFAULT '',
        InstalledPath TEXT NOT NULL DEFAULT '',
        DescriptorPath TEXT NOT NULL DEFAULT '',
        IsEnabled INTEGER NOT NULL DEFAULT 0,
        LoadOrder INTEGER NOT NULL DEFAULT 0,
        InstalledAt TEXT NULL,
        LastUpdatedAt TEXT NULL,
        TotalSubscribers INTEGER NULL DEFAULT 0,
        IsMultiplayerSafe INTEGER NULL DEFAULT 0,
        Tags TEXT NULL,
        Description TEXT NULL,
        ThumbnailUrl TEXT NULL,
        GameVersion TEXT NULL
    )`);
}

function ensureProfilesTables(db: Database.Database): void {
    if (!hasTable(db, "Profiles")) {
        db.exec(`CREATE TABLE Profiles (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL,
            IsActive INTEGER NOT NULL DEFAULT 0,
            CreatedAt TEXT NULL,
            SharedProfileId TEXT NULL,
            SharedProfileRevision INTEGER NULL,
            SharedProfileUpdatedUtc TEXT NULL
        )`);
    }

    if (!hasTable(db, "ProfileEntries")) {
        db.exec(`CREATE TABLE ProfileEntries (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            ProfileId INTEGER NOT NULL,
            ModId INTEGER NOT NULL,
            IsEnabled INTEGER NOT NULL DEFAULT 0,
            LoadOrder INTEGER NOT NULL DEFAULT 0
        )`);
    }
}

function getDefaultModsDirectory(): string {
    return getSettingsDefaultModsPath();
}

function resolveDescriptorModsDirectory(settings?: SettingsSnapshot | null): string {
    return resolveDescriptorModsPath(settings);
}

function resolveManagedModsDirectory(settings?: SettingsSnapshot | null): string {
    return resolveManagedModsPath(settings);
}

function listLocalDescriptorFiles(modsPath: string): string[] {
    if (!fs.existsSync(modsPath)) {
        return [];
    }

    try {
        return fs.readdirSync(modsPath)
            .filter((entry) => entry.toLowerCase().endsWith(".mod"))
            .map((entry) => path.join(modsPath, entry));
    } catch {
        return [];
    }
}

function getWorkshopContentRoots(steamCmdDownloadPath: string | undefined): string[] {
    const discovery = discoverSteamLibraries();
    const roots: string[] = discovery.discoveredWorkshopPaths.slice();

    const configuredPath = (steamCmdDownloadPath ?? "").trim();
    if (configuredPath) {
        roots.push(configuredPath);
        roots.push(path.join(configuredPath, "steamapps", "workshop", "content", STELLARIS_APP_ID));
        roots.push(path.join(configuredPath, "workshop", "content", STELLARIS_APP_ID));
    }

    const deduped = dedupePaths(roots);
    const valid: string[] = [];
    for (const root of deduped) {
        try {
            if (fs.statSync(root).isDirectory()) {
                valid.push(root);
            }
        } catch {
            // ignore missing or inaccessible directories
        }
    }

    return valid;
}

function listWorkshopDescriptorFiles(workshopRoots: string[]): DescriptorCandidate[] {
    const candidates: DescriptorCandidate[] = [];
    for (const workshopRoot of workshopRoots) {
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(workshopRoot, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const workshopIdHint = entry.name.trim();
            const rootDir = path.join(workshopRoot, entry.name);
            const descriptorPath = path.join(rootDir, "descriptor.mod");
            if (!fs.existsSync(descriptorPath)) {
                continue;
            }

            candidates.push({
                descriptorPath,
                source: "workshop",
                workshopIdHint,
                workshopRootDir: rootDir
            });
        }
    }

    return candidates;
}

function getEnabledWorkshopIds(enabledMods: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const value of enabledMods) {
        const normalized = value.replace(/\\/g, "/").trim().toLowerCase();
        if (!normalized) {
            continue;
        }

        const ugcMatch = normalized.match(/ugc_(\d+)\.mod$/);
        if (ugcMatch) {
            result.add(ugcMatch[1]);
            continue;
        }

        const descriptorMatch = normalized.match(new RegExp(`/workshop/content/${STELLARIS_APP_ID}/(\\d+)/descriptor\\.mod$`));
        if (descriptorMatch) {
            result.add(descriptorMatch[1]);
        }
    }

    return result;
}

function resolveInstalledPath(
    descriptor: ParsedModDescriptor,
    stellarisDir: string,
    workshopRootDir: string | null
): string {
    if (descriptor.modPath) {
        const resolved = path.isAbsolute(descriptor.modPath)
            ? descriptor.modPath
            : path.join(stellarisDir, descriptor.modPath);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    if (workshopRootDir && fs.existsSync(workshopRootDir)) {
        return workshopRootDir;
    }

    return "";
}

function isWorkshopModInstalledLocally(
    workshopId: string,
    localRow: SyncModRow | undefined,
    descriptorModsPath: string,
    managedModsPath: string,
    workshopRoots: string[]
): boolean {
    const normalizedId = sanitizeWorkshopId(workshopId);
    if (!isValidWorkshopId(normalizedId)) {
        return false;
    }

    const candidatePaths: string[] = [];
    const installedPath = (localRow?.InstalledPath ?? "").trim();
    const descriptorPath = (localRow?.DescriptorPath ?? "").trim();

    if (installedPath) {
        candidatePaths.push(installedPath);
    }
    if (descriptorPath) {
        candidatePaths.push(descriptorPath);
    }

    candidatePaths.push(
        path.join(managedModsPath, normalizedId),
        path.join(descriptorModsPath, `${normalizedId}.mod`)
    );

    for (const root of workshopRoots) {
        candidatePaths.push(
            path.join(root, normalizedId),
            path.join(root, normalizedId, "descriptor.mod")
        );
    }

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return true;
        }
    }

    return false;
}

export function scanLocalMods(): ScanLocalModsResult {
    const settings = loadSettingsSnapshot();
    const descriptorModsPath = resolveDescriptorModsDirectory(settings);
    const stellarisDir = path.dirname(descriptorModsPath);
    const enabledMods = readDlcEnabledMods(stellarisDir);
    const enabledWorkshopIds = getEnabledWorkshopIds(enabledMods);

    const localDescriptors = listLocalDescriptorFiles(descriptorModsPath).map((descriptorPath) => ({
        descriptorPath,
        source: "local" as const,
        workshopIdHint: "",
        workshopRootDir: null
    }));

    const workshopRoots = getWorkshopContentRoots(settings?.steamCmdDownloadPath);
    const workshopDescriptors = listWorkshopDescriptorFiles(workshopRoots);

    const candidatesByPath = new Map<string, DescriptorCandidate>();
    for (const candidate of [...localDescriptors, ...workshopDescriptors]) {
        candidatesByPath.set(normalizePathKey(candidate.descriptorPath), candidate);
    }

    // Also explicitly add any descriptors found in dlc_load.json
    for (const enabledModPath of enabledMods) {
        const fullPath = resolveEnabledDescriptorPath(stellarisDir, enabledModPath);
        const normPath = normalizePathKey(fullPath);
        if (!candidatesByPath.has(normPath) && fs.existsSync(fullPath)) {
            candidatesByPath.set(normPath, {
                descriptorPath: fullPath,
                source: "local",
                workshopIdHint: "",
                workshopRootDir: null
            });
        }
    }

    const descriptorCandidates = Array.from(candidatesByPath.values());

    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "Failed to open or create mods database.", discovered: 0, added: 0, alreadyKnown: 0 };
    }

    if (descriptorCandidates.length === 0) {
        db.close();
        return {
            ok: true,
            message: "No descriptor files found in local mods or workshop content.",
            discovered: 0,
            added: 0,
            alreadyKnown: 0
        };
    }

    try {
        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return { ok: false, message: "Could not determine workshop ID column.", discovered: 0, added: 0, alreadyKnown: 0 };
        }

        let added = 0;
        let alreadyKnown = 0;
        let discovered = 0;

        const maxOrderRow = db.prepare("SELECT MAX(LoadOrder) AS maxOrder FROM Mods").get() as { maxOrder: number | null } | undefined;
        let nextOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

        const checkByWorkshopId = db.prepare(`SELECT Id FROM Mods WHERE ${workshopColumn} = ? LIMIT 1`);
        const checkByDescriptor = db.prepare("SELECT Id FROM Mods WHERE DescriptorPath = ? LIMIT 1");

        const updateExistingStmt = db.prepare(
            `UPDATE Mods
             SET Name = ?,
                 Version = ?,
                 InstalledPath = CASE WHEN ? <> '' THEN ? ELSE InstalledPath END,
                 LastUpdatedAt = ?,
                 GameVersion = ?,
                 Tags = ?
             WHERE Id = ?`
        );

        const insertStmt = db.prepare(
            `INSERT INTO Mods (${workshopColumn}, Name, Version, InstalledPath, DescriptorPath, IsEnabled, LoadOrder, InstalledAt, GameVersion, Tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const tx = db.transaction(() => {
            for (const candidate of descriptorCandidates) {
                const descriptor = parseModDescriptor(candidate.descriptorPath);
                if (!descriptor) continue;

                discovered += 1;

                const parsedWorkshopId = sanitizeWorkshopId(descriptor.remoteFileId);
                const hintedWorkshopId = sanitizeWorkshopId(candidate.workshopIdHint);
                const workshopId = isValidWorkshopId(parsedWorkshopId)
                    ? parsedWorkshopId
                    : (isValidWorkshopId(hintedWorkshopId) ? hintedWorkshopId : "");

                const installedPath = resolveInstalledPath(descriptor, stellarisDir, candidate.workshopRootDir);
                const descriptorLoadReference = normalizeDescriptorReferenceKey(
                    resolveDescriptorLoadReference(descriptorModsPath, candidate.descriptorPath, workshopId)
                );
                const isEnabled = enabledMods.has(descriptorLoadReference)
                    || (workshopId.length > 0 && enabledWorkshopIds.has(workshopId));
                const tagsJson = descriptor.tags.length > 0 ? JSON.stringify(descriptor.tags) : null;

                let existing: { Id: number } | undefined;

                if (workshopId && isValidWorkshopId(workshopId)) {
                    existing = checkByWorkshopId.get(workshopId) as { Id: number } | undefined;
                }

                if (!existing) {
                    existing = checkByDescriptor.get(candidate.descriptorPath) as { Id: number } | undefined;
                }

                if (existing) {
                    updateExistingStmt.run(
                        descriptor.name,
                        descriptor.supportedVersion || "",
                        installedPath,
                        installedPath,
                        nowIso(),
                        descriptor.supportedVersion || null,
                        tagsJson,
                        existing.Id
                    );
                    alreadyKnown += 1;
                    continue;
                }

                insertStmt.run(
                    workshopId || "",
                    descriptor.name,
                    descriptor.supportedVersion || "",
                    installedPath,
                    candidate.descriptorPath,
                    isEnabled ? 1 : 0,
                    nextOrder,
                    nowIso(),
                    descriptor.supportedVersion || null,
                    tagsJson
                );

                nextOrder += 1;
                added += 1;
            }
        });

        tx();

        if (added > 0 || alreadyKnown > 0) {
            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        }

        const sourcesUsed = [
            localDescriptors.length > 0 ? "local descriptors" : "",
            workshopDescriptors.length > 0 ? "workshop descriptors" : ""
        ].filter((entry) => entry.length > 0).join(" + ");

        return {
            ok: true,
            message: added > 0
                ? `Scan complete (${sourcesUsed || "no sources"}). Found ${discovered} mod(s): ${added} new, ${alreadyKnown} already tracked.`
                : `Scan complete (${sourcesUsed || "no sources"}). All ${discovered} discovered mod(s) are already tracked.`,
            discovered,
            added,
            alreadyKnown
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown scan error";
        return { ok: false, message: `Scan failed: ${message}`, discovered: 0, added: 0, alreadyKnown: 0 };
    } finally {
        db.close();
    }
}

export function reorderLibraryMod(request: LibraryReorderRequest): LibraryActionResult {
    const db = openLibraryDb();
    if (!db) {
        return { ok: false, message: "mods.db is not available." };
    }

    try {
        const enabledMods = db
            .prepare("SELECT Id, LoadOrder, IsEnabled FROM Mods WHERE IsEnabled = 1 ORDER BY LoadOrder ASC, Name COLLATE NOCASE ASC, Id ASC")
            .all() as Array<{ Id: number; LoadOrder: number; IsEnabled: number }>;

        const sourceIndex = enabledMods.findIndex((entry) => entry.Id === request.modId);
        if (sourceIndex < 0) {
            return { ok: false, message: "Only enabled mods can be reordered." };
        }

        if (request.targetIndex < 0 || request.targetIndex >= enabledMods.length) {
            return { ok: false, message: "Invalid target position." };
        }

        if (sourceIndex === request.targetIndex) {
            return { ok: true, message: "No change needed." };
        }

        const [movedMod] = enabledMods.splice(sourceIndex, 1);
        enabledMods.splice(request.targetIndex, 0, movedMod);

        const tx = db.transaction(() => {
            const updateStmt = db.prepare("UPDATE Mods SET LoadOrder = ? WHERE Id = ?");
            // Re-assign a sequential load order so it perfectly matches the new array
            for (let i = 0; i < enabledMods.length; i++) {
                updateStmt.run(i, enabledMods[i].Id);
            }
            normalizeLoadOrder(db);
            saveActiveProfileSnapshot(db);
            syncDlcLoadFromDb(db);
        });

        tx();
        return { ok: true, message: "Load order updated." };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown load-order error";
        return { ok: false, message: `Failed to reorder mod: ${message}` };
    } finally {
        db.close();
    }
}
