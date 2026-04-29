import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type {
    MergeFilePlan,
    MergePlan,
    MergeSourceMod,
    ModMergerApplyAutoRequest,
    ModMergerApplyAutoResult,
    ModMergerAnalyzeRequest,
    ModMergerAnalyzeResult,
    ModMergerBuildRequest,
    ModMergerBuildResult,
    ModMergerExportReportResult,
    ModMergerReadFilePreviewRequest,
    ModMergerReadFilePreviewResult,
    ModMergerResolutionResult,
    ModMergerSetResolutionRequest,
    ModMergerSummary
} from "../../shared/types";
import { getLegacyPaths } from "./paths";
import { resolveDescriptorModsPath, resolveManagedModsPath, loadSettingsSnapshot } from "./settings";
import { analyzeMergeSources, selectLoadOrderWinner, summarizeMergePlan } from "./modMerger/fileScanner";
import {
    buildMergedDescriptorContent,
    MERGED_MOD_FOLDER_NAME,
    normalizeGeneratedText
} from "./modMerger/descriptorWriter";
import { buildMergeReport, writeMergeArtifacts } from "./modMerger/mergeReportWriter";
import {
    finishModMergerProgress,
    startModMergerProgress,
    updateModMergerProgress
} from "./modMergerProgressState";
import { applyAutoResolutions, buildAutomationSummary } from "./modMerger/autoResolver";

interface DbModMergeRow {
    Id: number;
    WorkshopId: string;
    Name: string;
    InstalledPath: string;
    DescriptorPath: string;
    IsEnabled: number;
    LoadOrder: number;
    GameVersion: string | null;
}

interface DbProfileRow {
    Id: number;
    Name: string;
}

let currentPlan: MergePlan | null = null;
const MAX_MERGER_FILE_PREVIEW_BYTES = 256 * 1024;

function buildEmptySummary(): ModMergerSummary {
    return {
        enabledModCount: 0,
        scannedFileCount: 0,
        conflictingFileCount: 0,
        scriptConflictCount: 0,
        scriptObjectConflictCount: 0,
        localisationConflictCount: 0,
        assetConflictCount: 0,
        autoResolvedCount: 0,
        unresolvedCount: 0
    };
}

function resolveAppVersion(): string {
    const candidates = [
        path.join(__dirname, "..", "..", "..", "package.json"),
        path.join(process.cwd(), "package.json")
    ];

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
            const version = String(parsed?.version ?? "").trim();
            if (version) {
                return version;
            }
        } catch {
            // try next candidate
        }
    }

    return "0.1.0";
}

function compareNormalizedPaths(left: string, right: string): boolean {
    const normalize = (value: string) => {
        const resolved = path.resolve(value);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };

    return normalize(left) === normalize(right);
}

function isPathInside(basePath: string, candidatePath: string): boolean {
    const resolvedBase = path.resolve(basePath);
    const resolvedCandidate = path.resolve(candidatePath);
    const normalizedBase = process.platform === "win32" ? resolvedBase.toLowerCase() : resolvedBase;
    const normalizedCandidate = process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
    return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}${path.sep}`);
}

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        return new Set(rows.map((row) => row.name));
    } catch {
        return new Set<string>();
    }
}

function hasTable(db: Database.Database, tableName: string): boolean {
    try {
        const row = db
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
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

function openLibraryDb(): Database.Database | null {
    const dbPath = getLegacyPaths().modsDbPath;
    if (!fs.existsSync(dbPath)) {
        return null;
    }

    try {
        return new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
        return null;
    }
}

function resolveRequestedProfileId(db: Database.Database, profileId?: number | null): number | null {
    if (Number.isFinite(profileId)) {
        const exists = db.prepare("SELECT Id FROM Profiles WHERE Id = ? LIMIT 1").get(profileId) as { Id: number } | undefined;
        if (exists?.Id) {
            return exists.Id;
        }
    }

    const active = db.prepare("SELECT Id FROM Profiles WHERE IsActive = 1 ORDER BY Id ASC LIMIT 1").get() as { Id: number } | undefined;
    return active?.Id ?? null;
}

function loadSourceModsFromLibrary(request?: ModMergerAnalyzeRequest): {
    profileId: number | null;
    profileName: string | null;
    sourceMods: MergeSourceMod[];
    warnings: string[];
    gameVersion: string | null;
} {
    const warnings: string[] = [];
    const db = openLibraryDb();
    if (!db) {
        return {
            profileId: null,
            profileName: null,
            sourceMods: [],
            warnings,
            gameVersion: null
        };
    }

    try {
        if (!hasTable(db, "Mods")) {
            return {
                profileId: null,
                profileName: null,
                sourceMods: [],
                warnings,
                gameVersion: null
            };
        }

        const modColumns = getTableColumns(db, "Mods");
        const workshopColumn = getWorkshopColumn(modColumns);
        if (!workshopColumn) {
            return {
                profileId: null,
                profileName: null,
                sourceMods: [],
                warnings,
                gameVersion: null
            };
        }

        const hasProfiles = hasTable(db, "Profiles");
        const hasProfileEntries = hasTable(db, "ProfileEntries");
        const targetProfileId = hasProfiles ? resolveRequestedProfileId(db, request?.profileId) : null;
        let profileName: string | null = null;
        if (targetProfileId !== null) {
            const row = db.prepare("SELECT Id, Name FROM Profiles WHERE Id = ? LIMIT 1").get(targetProfileId) as DbProfileRow | undefined;
            profileName = row?.Name?.trim() || null;
        }

        const isEnabledExpression = targetProfileId !== null && hasProfileEntries
            ? "COALESCE(pe.IsEnabled, m.IsEnabled)"
            : "m.IsEnabled";
        const loadOrderExpression = targetProfileId !== null && hasProfileEntries
            ? "COALESCE(pe.LoadOrder, m.LoadOrder)"
            : "m.LoadOrder";
        const gameVersionSelection = modColumns.has("GameVersion") ? "m.GameVersion" : "NULL AS GameVersion";
        const profileJoin = targetProfileId !== null && hasProfileEntries
            ? "LEFT JOIN ProfileEntries pe ON pe.ModId = m.Id AND pe.ProfileId = ?"
            : "";

        const sql = `
            SELECT m.Id,
                   m.${workshopColumn} AS WorkshopId,
                   m.Name,
                   m.InstalledPath,
                   m.DescriptorPath,
                   ${isEnabledExpression} AS IsEnabled,
                   ${loadOrderExpression} AS LoadOrder,
                   ${gameVersionSelection}
            FROM Mods m
            ${profileJoin}
            ORDER BY ${isEnabledExpression} DESC, ${loadOrderExpression} ASC, m.Name COLLATE NOCASE ASC, m.Id ASC
        `;

        const rows = (targetProfileId !== null && hasProfileEntries)
            ? db.prepare(sql).all(targetProfileId) as DbModMergeRow[]
            : db.prepare(sql).all() as DbModMergeRow[];

        const includeDisabled = request?.includeDisabled === true;
        const filteredRows = includeDisabled
            ? rows
            : rows.filter((row) => Number(row.IsEnabled) === 1);

        const sourceMods = filteredRows.map((row) => ({
            modId: row.Id,
            workshopId: String(row.WorkshopId ?? "").trim(),
            name: String(row.Name ?? "").trim() || `Mod ${row.Id}`,
            loadOrder: Number(row.LoadOrder ?? 0) || 0,
            installedPath: String(row.InstalledPath ?? "").trim(),
            descriptorPath: String(row.DescriptorPath ?? "").trim(),
            isEnabled: Number(row.IsEnabled ?? 0) === 1,
            gameVersion: String(row.GameVersion ?? "").trim() || null
        }));

        const gameVersion = sourceMods
            .map((sourceMod) => sourceMod.gameVersion ?? null)
            .find((value) => value !== null) ?? null;

        return {
            profileId: targetProfileId,
            profileName,
            sourceMods,
            warnings,
            gameVersion
        };
    } finally {
        db.close();
    }
}

function isTextMergeablePlan(filePlan: MergeFilePlan): boolean {
    return filePlan.fileType !== "asset";
}

function refreshFilePlanSeverity(filePlan: MergeFilePlan): void {
    if (filePlan.strategy === "ignore" || filePlan.resolutionState === "ignored") {
        filePlan.severity = "info";
        return;
    }

    const hasConflict = filePlan.entries.length > 1
        && new Set(filePlan.entries.map((entry) => entry.sha256)).size > 1;
    if (!hasConflict) {
        filePlan.severity = "info";
        return;
    }

    const normalizedPath = filePlan.virtualPath.toLowerCase();
    if (normalizedPath.startsWith("map/") || normalizedPath.startsWith("sound/")) {
        filePlan.severity = "critical";
        return;
    }

    if (
        filePlan.fileType === "script"
        || filePlan.fileType === "event"
        || filePlan.fileType === "localisation"
        || filePlan.fileType === "interface"
    ) {
        filePlan.severity = "risky";
        return;
    }

    filePlan.severity = "warning";
}

function updateCurrentPlanSummary(plan: MergePlan): ModMergerSummary {
    const summary = summarizeMergePlan(plan);
    plan.unresolvedConflictCount = summary.unresolvedCount;
    plan.automation = buildAutomationSummary(plan);
    return summary;
}

function getCurrentPlanOrEmpty(): { plan: MergePlan | null; summary: ModMergerSummary } {
    if (!currentPlan) {
        return {
            plan: null,
            summary: buildEmptySummary()
        };
    }

    return {
        plan: currentPlan,
        summary: updateCurrentPlanSummary(currentPlan)
    };
}

async function ensureCleanDirectory(directoryPath: string): Promise<void> {
    await fsp.rm(directoryPath, {
        recursive: true,
        force: true,
        maxRetries: 6,
        retryDelay: 250
    });
    await fsp.mkdir(directoryPath, { recursive: true });
}

function validateBuildPlan(plan: MergePlan, gamePath?: string | null): string | null {
    if (!plan.filePlans.length) {
        return "The merge plan has no files to build.";
    }

    const outputModPath = path.resolve(plan.outputModPath);
    for (const sourceMod of plan.sourceMods) {
        if (!sourceMod.installedPath) {
            continue;
        }

        if (isPathInside(sourceMod.installedPath, outputModPath)) {
            return "The merged output folder cannot live inside a source mod folder.";
        }
    }

    if (gamePath && isPathInside(gamePath, outputModPath)) {
        return "The merged output folder cannot live inside the Stellaris game folder.";
    }

    return null;
}

function resolveBuildOutputTarget(rootPath: string, virtualPath: string): string {
    const targetPath = path.resolve(rootPath, ...virtualPath.split("/"));
    if (!isPathInside(rootPath, targetPath)) {
        throw new Error(`Unsafe virtual path rejected: ${virtualPath}`);
    }

    return targetPath;
}

function isGeneratedMergeStrategy(filePlan: MergeFilePlan): boolean {
    return filePlan.strategy === "manual-text-merge"
        || filePlan.strategy === "localisation-key-merge"
        || filePlan.strategy === "script-object-merge";
}

async function buildMergedModFromPlan(input: {
    plan: MergePlan;
    appVersion: string;
    gameVersion?: string | null;
    cleanOutputFolder?: boolean;
    onProgress?: (input: {
        phase?: string | null;
        currentItemLabel?: string | null;
        processedItemCount?: number;
        totalItemCount?: number;
        progressPercent?: number;
        message?: string | null;
    }) => void;
}): Promise<ModMergerBuildResult> {
    const validationMessage = validateBuildPlan(input.plan, loadSettingsSnapshot()?.gamePath ?? null);
    if (validationMessage) {
        return {
            ok: false,
            message: validationMessage,
            outputModPath: input.plan.outputModPath,
            descriptorPath: input.plan.descriptorPath,
            reportPath: null,
            manifestPath: null,
            copiedFileCount: 0,
            generatedFileCount: 0,
            unresolvedConflictCount: input.plan.unresolvedConflictCount
        };
    }

    const outputModPath = path.resolve(input.plan.outputModPath);
    const descriptorPath = path.resolve(input.plan.descriptorPath);

    try {
        input.onProgress?.({
            phase: "Preparing output folder",
            processedItemCount: 0,
            totalItemCount: input.plan.filePlans.length,
            progressPercent: 5,
            message: "Preparing the merged mod output folder."
        });

        if (input.cleanOutputFolder !== false) {
            await ensureCleanDirectory(outputModPath);
        } else {
            await fsp.mkdir(outputModPath, { recursive: true });
        }

        await fsp.mkdir(path.dirname(descriptorPath), { recursive: true });

        let copiedFileCount = 0;
        let generatedFileCount = 0;

        const sortedFilePlans = input.plan.filePlans
            .slice()
            .sort((left, right) => left.virtualPath.localeCompare(right.virtualPath));
        const actionableFilePlans = sortedFilePlans.filter((filePlan) =>
            !(filePlan.strategy === "ignore" || filePlan.resolutionState === "ignored")
        );
        const totalActionableFiles = actionableFilePlans.length;
        let processedFilePlans = 0;

        for (const filePlan of sortedFilePlans) {
            if (filePlan.strategy === "ignore" || filePlan.resolutionState === "ignored") {
                continue;
            }

            input.onProgress?.({
                phase: "Copying merged files",
                currentItemLabel: filePlan.virtualPath,
                processedItemCount: processedFilePlans,
                totalItemCount: totalActionableFiles,
                progressPercent: totalActionableFiles > 0
                    ? Math.round(10 + (processedFilePlans / totalActionableFiles) * 70)
                    : 80,
                message: `Writing ${filePlan.virtualPath}.`
            });

            const targetPath = resolveBuildOutputTarget(outputModPath, filePlan.virtualPath);
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });

            const generatedText = filePlan.generatedOutput ?? filePlan.outputPreview ?? null;
            if (isGeneratedMergeStrategy(filePlan) && generatedText !== null) {
                await fsp.writeFile(targetPath, normalizeGeneratedText(generatedText), "utf8");
                generatedFileCount += 1;
                processedFilePlans += 1;
                continue;
            }

            const winner = filePlan.winner;
            if (!winner?.realPath || !fs.existsSync(winner.realPath)) {
                return {
                    ok: false,
                    message: `Missing winner file for ${filePlan.virtualPath}. Re-run analysis and try again.`,
                    outputModPath,
                    descriptorPath,
                    reportPath: null,
                    manifestPath: null,
                    copiedFileCount,
                    generatedFileCount,
                    unresolvedConflictCount: input.plan.unresolvedConflictCount
                };
            }

            await fsp.copyFile(winner.realPath, targetPath);
            copiedFileCount += 1;
            processedFilePlans += 1;
        }

        input.onProgress?.({
            phase: "Writing descriptors",
            processedItemCount: processedFilePlans,
            totalItemCount: totalActionableFiles,
            progressPercent: 88,
            message: "Writing merged descriptor files."
        });

        const descriptorContent = buildMergedDescriptorContent({
            descriptorRoot: path.dirname(descriptorPath),
            outputModPath,
            outputModName: input.plan.outputModName,
            gameVersion: input.gameVersion
        });

        await Promise.all([
            fsp.writeFile(path.join(outputModPath, "descriptor.mod"), descriptorContent, "utf8"),
            fsp.writeFile(descriptorPath, descriptorContent, "utf8")
        ]);
        generatedFileCount += 2;

        const summary = updateCurrentPlanSummary(input.plan);
        input.onProgress?.({
            phase: "Writing merge artifacts",
            processedItemCount: processedFilePlans,
            totalItemCount: totalActionableFiles,
            progressPercent: 96,
            message: "Writing the merge manifest and report."
        });
        const { manifestPath, reportPath } = await writeMergeArtifacts(outputModPath, input.plan, summary, {
            appVersion: input.appVersion,
            gameVersion: input.gameVersion,
            warnings: input.plan.warnings
        });
        generatedFileCount += 2;

        return {
            ok: true,
            message: `Merged mod built at ${outputModPath}.`,
            outputModPath,
            descriptorPath,
            reportPath,
            manifestPath,
            copiedFileCount,
            generatedFileCount,
            unresolvedConflictCount: input.plan.unresolvedConflictCount
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown build error";
        return {
            ok: false,
            message: `Failed to build merged mod: ${message}`,
            outputModPath,
            descriptorPath,
            reportPath: null,
            manifestPath: null,
            copiedFileCount: 0,
            generatedFileCount: 0,
            unresolvedConflictCount: input.plan.unresolvedConflictCount
        };
    }
}

export async function analyzeModMergerSourcesForTest(input: {
    profileId: number | null;
    profileName: string | null;
    sourceMods: MergeSourceMod[];
    descriptorRoot: string;
    outputRoot: string;
    outputModName: string;
    gameVersion?: string | null;
}): Promise<ModMergerAnalyzeResult> {
    const analysis = await analyzeMergeSources({
        profileId: input.profileId,
        profileName: input.profileName,
        sourceMods: input.sourceMods,
        descriptorRoot: input.descriptorRoot,
        outputRoot: input.outputRoot,
        outputModName: input.outputModName
    });

    return {
        ok: true,
        message: `Analyzed ${analysis.summary.enabledModCount} mod(s).`,
        plan: analysis.plan,
        summary: analysis.summary,
        warnings: analysis.warnings
    };
}

export async function buildMergedModForTest(input: {
    plan: MergePlan;
    descriptorRoot: string;
    outputRoot: string;
    appVersion: string;
    gameVersion?: string | null;
    cleanOutputFolder?: boolean;
}): Promise<ModMergerBuildResult> {
    const plan: MergePlan = {
        ...input.plan,
        outputModPath: path.join(path.resolve(input.outputRoot), MERGED_MOD_FOLDER_NAME),
        descriptorPath: path.join(path.resolve(input.descriptorRoot), `${MERGED_MOD_FOLDER_NAME}.mod`)
    };

    if (!compareNormalizedPaths(plan.outputModPath, input.plan.outputModPath)) {
        plan.outputModPath = input.plan.outputModPath;
    }
    if (!compareNormalizedPaths(plan.descriptorPath, input.plan.descriptorPath)) {
        plan.descriptorPath = input.plan.descriptorPath;
    }

    return buildMergedModFromPlan({
        plan,
        appVersion: input.appVersion,
        gameVersion: input.gameVersion,
        cleanOutputFolder: input.cleanOutputFolder
    });
}

export function applyAutoResolutionsForTest(
    plan: MergePlan,
    request?: ModMergerApplyAutoRequest
): { plan: MergePlan; summary: ModMergerSummary } {
    const summary = applyAutoResolutions(plan, request?.scope ?? "safe");
    return {
        plan,
        summary
    };
}

export async function modMergerAnalyze(request?: ModMergerAnalyzeRequest): Promise<ModMergerAnalyzeResult> {
    const settings = loadSettingsSnapshot() ?? {};
    const descriptorRoot = resolveDescriptorModsPath(settings);
    const outputRoot = resolveManagedModsPath(settings);
    const { profileId, profileName, sourceMods, warnings, gameVersion } = loadSourceModsFromLibrary(request);

    if (sourceMods.length <= 0) {
        currentPlan = null;
        return {
            ok: false,
            message: "No mods are available for merger analysis in the selected profile.",
            plan: null,
            summary: buildEmptySummary(),
            warnings
        };
    }

    startModMergerProgress({
        operation: "analyze",
        totalItemCount: sourceMods.length,
        phase: "Preparing analysis",
        message: "Analyzing enabled mods..."
    });

    try {
        const analysis = await analyzeMergeSources({
            profileId,
            profileName,
            sourceMods,
            descriptorRoot,
            outputRoot,
            outputModName: String(request?.outputModName ?? "").trim() || "SMM Merged Mod",
            onProgress: updateModMergerProgress
        });

        const mergedWarnings = [...warnings, ...analysis.warnings];
        analysis.plan.warnings = mergedWarnings;
        currentPlan = analysis.plan;

        const conflictCount = analysis.summary.conflictingFileCount;
        const message = `Analyzed ${analysis.summary.enabledModCount} mod(s); found ${conflictCount} conflicting file(s).`;
        finishModMergerProgress({
            ok: true,
            message
        });

        return {
            ok: true,
            message,
            plan: analysis.plan,
            summary: analysis.summary,
            warnings: mergedWarnings
        };
    } catch (error) {
        finishModMergerProgress({
            ok: false,
            message: error instanceof Error ? error.message : "Unknown merger analysis error"
        });
        throw error;
    }
}

function buildFilePreviewFailure(
    request: ModMergerReadFilePreviewRequest,
    message: string
): ModMergerReadFilePreviewResult {
    return {
        ok: false,
        message,
        virtualPath: String(request?.virtualPath ?? ""),
        modId: request?.modId ?? null,
        modName: null,
        sourcePath: null,
        sizeBytes: 0,
        truncated: false,
        content: null
    };
}

async function readTextPreview(filePath: string): Promise<{
    content: string | null;
    sizeBytes: number;
    truncated: boolean;
    message: string;
}> {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
        return {
            content: null,
            sizeBytes: stat.size,
            truncated: false,
            message: "This source is not a regular file."
        };
    }

    const bytesToRead = Math.min(stat.size, MAX_MERGER_FILE_PREVIEW_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const handle = await fsp.open(filePath, "r");
    try {
        await handle.read(buffer, 0, bytesToRead, 0);
    } finally {
        await handle.close();
    }

    if (buffer.includes(0)) {
        return {
            content: null,
            sizeBytes: stat.size,
            truncated: stat.size > MAX_MERGER_FILE_PREVIEW_BYTES,
            message: "Binary file preview is unavailable."
        };
    }

    return {
        content: buffer.toString("utf8"),
        sizeBytes: stat.size,
        truncated: stat.size > MAX_MERGER_FILE_PREVIEW_BYTES,
        message: stat.size > MAX_MERGER_FILE_PREVIEW_BYTES
            ? "Preview is truncated to the first 256 KiB."
            : "Preview loaded."
    };
}

export function modMergerGetPlan(): MergePlan | null {
    return currentPlan;
}

async function readFilePreviewFromPlan(
    plan: MergePlan,
    request: ModMergerReadFilePreviewRequest
): Promise<ModMergerReadFilePreviewResult> {
    const virtualPath = String(request?.virtualPath ?? "").trim();
    const filePlan = plan.filePlans.find((candidate) => candidate.virtualPath === virtualPath);
    if (!filePlan) {
        return buildFilePreviewFailure(request, `Could not find merge entry for ${virtualPath || "the selected file"}.`);
    }

    const requestedModId = request.modId ?? null;
    const entry = requestedModId !== null && requestedModId !== undefined
        ? filePlan.entries.find((candidate) => candidate.modId === requestedModId)
        : filePlan.winner || filePlan.entries[0];
    if (!entry) {
        return buildFilePreviewFailure(request, "No source file is available for this merge entry.");
    }

    if (!entry.realPath || !fs.existsSync(entry.realPath)) {
        return {
            ok: false,
            message: "Source file is missing. Re-run the merger scan.",
            virtualPath: filePlan.virtualPath,
            modId: entry.modId,
            modName: entry.modName,
            sourcePath: entry.realPath || null,
            sizeBytes: 0,
            truncated: false,
            content: null
        };
    }

    try {
        const preview = await readTextPreview(entry.realPath);
        return {
            ok: preview.content !== null,
            message: preview.message,
            virtualPath: filePlan.virtualPath,
            modId: entry.modId,
            modName: entry.modName,
            sourcePath: entry.realPath,
            sizeBytes: preview.sizeBytes,
            truncated: preview.truncated,
            content: preview.content
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read source preview.";
        return {
            ok: false,
            message,
            virtualPath: filePlan.virtualPath,
            modId: entry.modId,
            modName: entry.modName,
            sourcePath: entry.realPath,
            sizeBytes: 0,
            truncated: false,
            content: null
        };
    }
}

export async function readModMergerFilePreviewForTest(
    plan: MergePlan,
    request: ModMergerReadFilePreviewRequest
): Promise<ModMergerReadFilePreviewResult> {
    return readFilePreviewFromPlan(plan, request);
}

export async function modMergerReadFilePreview(
    request: ModMergerReadFilePreviewRequest
): Promise<ModMergerReadFilePreviewResult> {
    if (!currentPlan) {
        return buildFilePreviewFailure(request, "No merge plan is loaded.");
    }

    return readFilePreviewFromPlan(currentPlan, request);
}

export function modMergerSetResolution(request: ModMergerSetResolutionRequest): ModMergerResolutionResult {
    if (!currentPlan) {
        return {
            ok: false,
            message: "No merge plan is loaded.",
            plan: null,
            summary: buildEmptySummary()
        };
    }

    const filePlan = currentPlan.filePlans.find((candidate) => candidate.virtualPath === request.virtualPath);
    if (!filePlan) {
        return {
            ok: false,
            message: `Could not find merge entry for ${request.virtualPath}.`,
            plan: currentPlan,
            summary: updateCurrentPlanSummary(currentPlan)
        };
    }

    if (request.strategy === "ignore") {
        filePlan.strategy = "ignore";
        filePlan.resolutionState = "ignored";
        filePlan.outputPreview = null;
        filePlan.generatedOutput = null;
        filePlan.decisionType = "ignored";
        filePlan.reviewState = "not-needed";
    } else if (request.strategy === "manual-text-merge") {
        if (!isTextMergeablePlan(filePlan)) {
            return {
                ok: false,
                message: "Manual text merge is only available for text-based files.",
                plan: currentPlan,
                summary: updateCurrentPlanSummary(currentPlan)
            };
        }

        const manualText = String(request.manualText ?? "");
        if (!manualText.trim()) {
            return {
                ok: false,
                message: "Manual text merge requires text content.",
                plan: currentPlan,
                summary: updateCurrentPlanSummary(currentPlan)
            };
        }

        filePlan.strategy = "manual-text-merge";
        filePlan.outputPreview = normalizeGeneratedText(manualText);
        filePlan.generatedOutput = filePlan.outputPreview;
        filePlan.decisionType = "manual-text";
        filePlan.resolutionState = "manual";
        filePlan.reviewState = "reviewed";
    } else {
        const winner = request.selectedModId !== null && request.selectedModId !== undefined
            ? filePlan.entries.find((entry) => entry.modId === request.selectedModId)
            : selectLoadOrderWinner(filePlan.entries);
        if (!winner) {
            return {
                ok: false,
                message: "Could not resolve a winner for this file.",
                plan: currentPlan,
                summary: updateCurrentPlanSummary(currentPlan)
            };
        }

        filePlan.strategy = "copy-load-order-winner";
        filePlan.winner = winner;
        filePlan.outputPreview = null;
        filePlan.generatedOutput = null;
        filePlan.decisionType = "file-winner";
        filePlan.resolutionState = filePlan.entries.length > 1 ? "manual" : "auto";
        filePlan.reviewState = "reviewed";
    }

    refreshFilePlanSeverity(filePlan);
    const summary = updateCurrentPlanSummary(currentPlan);
    return {
        ok: true,
        message: `Updated resolution for ${request.virtualPath}.`,
        plan: currentPlan,
        summary
    };
}

export function modMergerApplyAuto(request?: ModMergerApplyAutoRequest): ModMergerApplyAutoResult {
    if (!currentPlan) {
        return {
            ok: false,
            message: "No merge plan is loaded.",
            plan: null,
            summary: buildEmptySummary()
        };
    }

    const before = currentPlan.automation?.safeCount ?? 0;
    const summary = applyAutoResolutions(currentPlan, request?.scope ?? "safe");
    const appliedCount = before - (currentPlan.automation?.safeCount ?? 0);

    return {
        ok: true,
        message: appliedCount > 0
            ? `Auto Control applied ${appliedCount} safe merge(s).`
            : "Auto Control did not find any safe merge recommendations to apply.",
        plan: currentPlan,
        summary
    };
}

export async function modMergerBuild(request?: ModMergerBuildRequest): Promise<ModMergerBuildResult> {
    if (!currentPlan) {
        return {
            ok: false,
            message: "No merge plan is loaded.",
            outputModPath: null,
            descriptorPath: null,
            reportPath: null,
            manifestPath: null,
            copiedFileCount: 0,
            generatedFileCount: 0,
            unresolvedConflictCount: 0
        };
    }

    if (String(request?.outputModName ?? "").trim()) {
        currentPlan.outputModName = String(request?.outputModName ?? "").trim();
    }

    startModMergerProgress({
        operation: "build",
        totalItemCount: currentPlan.filePlans.length,
        phase: "Preparing build",
        message: "Building merged mod..."
    });

    const result = await buildMergedModFromPlan({
        plan: currentPlan,
        appVersion: resolveAppVersion(),
        gameVersion: loadSettingsSnapshot()?.lastDetectedGameVersion ?? null,
        cleanOutputFolder: request?.cleanOutputFolder,
        onProgress: updateModMergerProgress
    });

    finishModMergerProgress({
        ok: result.ok,
        message: result.message
    });

    return result;
}

export async function modMergerExportReport(): Promise<ModMergerExportReportResult> {
    if (!currentPlan) {
        return {
            ok: false,
            message: "No merge plan is loaded.",
            reportPath: null
        };
    }

    try {
        startModMergerProgress({
            operation: "export-report",
            totalItemCount: currentPlan.filePlans.length,
            phase: "Preparing report",
            message: "Exporting merge report..."
        });
        const reportRoot = path.join(getLegacyPaths().productDir, "merge-reports");
        await fsp.mkdir(reportRoot, { recursive: true });
        const reportPath = path.join(reportRoot, `${MERGED_MOD_FOLDER_NAME}-${Date.now()}.txt`);
        const summary = updateCurrentPlanSummary(currentPlan);
        updateModMergerProgress({
            phase: "Writing report",
            processedItemCount: summary.conflictingFileCount,
            totalItemCount: Math.max(currentPlan.filePlans.length, 1),
            progressPercent: 90,
            message: "Writing the exported merge report."
        });
        await fsp.writeFile(reportPath, buildMergeReport(currentPlan, summary, {
            appVersion: resolveAppVersion(),
            gameVersion: loadSettingsSnapshot()?.lastDetectedGameVersion ?? null,
            warnings: currentPlan.warnings
        }), "utf8");

        finishModMergerProgress({
            ok: true,
            message: `Merge report exported to ${reportPath}.`
        });
        return {
            ok: true,
            message: `Merge report exported to ${reportPath}.`,
            reportPath
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown report export error";
        finishModMergerProgress({
            ok: false,
            message: `Failed to export merge report: ${message}`
        });
        return {
            ok: false,
            message: `Failed to export merge report: ${message}`,
            reportPath: null
        };
    }
}
