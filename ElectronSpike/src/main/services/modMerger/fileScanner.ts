import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
    MergeConflictEntry,
    MergeFilePlan,
    MergeFileType,
    MergePlan,
    MergeResolutionState,
    MergeSeverity,
    MergeSourceMod,
    ModMergerSummary
} from "../../../shared/types";
import { decorateMergePlanWithAutomation } from "./autoResolver";
import { MERGED_MOD_FOLDER_NAME } from "./descriptorWriter";

const IGNORED_DIR_NAMES = new Set([".git", ".idea", "__macosx"]);
const IGNORED_FILE_NAMES = new Set(["thumbnail.png", "descriptor.mod", "remote_file_id.txt"]);
const IGNORED_FILE_SUFFIXES = [".tmp", ".bak", ".old", ".disabled", ".png.tmp", ".mod"];

export interface AnalyzeMergeSourcesInput {
    profileId: number | null;
    profileName: string | null;
    sourceMods: MergeSourceMod[];
    descriptorRoot: string;
    outputRoot: string;
    outputModName: string;
    onProgress?: (input: {
        phase?: string | null;
        currentItemLabel?: string | null;
        processedItemCount?: number;
        totalItemCount?: number;
        progressPercent?: number;
        message?: string | null;
    }) => void;
}

function comparePathKey(value: string): string {
    const normalized = value.replace(/\\/g, "/").trim();
    return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
}

function isIgnoredFile(virtualPath: string): boolean {
    const normalized = virtualPath.replace(/\\/g, "/").trim();
    const fileName = path.posix.basename(normalized).toLowerCase();
    if (!fileName) {
        return true;
    }

    if (IGNORED_FILE_NAMES.has(fileName)) {
        return true;
    }

    return IGNORED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

function isIgnoredDirectory(name: string): boolean {
    return IGNORED_DIR_NAMES.has(String(name ?? "").trim().toLowerCase());
}

function normalizeVirtualPath(modRoot: string, filePath: string): string | null {
    const relative = path.relative(modRoot, filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }

    return relative.replace(/\\/g, "/");
}

function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sortSourceMods(sourceMods: MergeSourceMod[]): MergeSourceMod[] {
    return sourceMods
        .slice()
        .sort((left, right) => left.loadOrder - right.loadOrder || left.modId - right.modId);
}

export function classifyMergeFileType(virtualPath: string): MergeFileType {
    const normalized = virtualPath.replace(/\\/g, "/").trim().toLowerCase();
    if (normalized.startsWith("localisation/") && normalized.endsWith(".yml")) return "localisation";
    if (normalized.startsWith("common/") && normalized.endsWith(".txt")) return "script";
    if (normalized.startsWith("events/") && normalized.endsWith(".txt")) return "event";
    if (normalized.startsWith("interface/") && (normalized.endsWith(".gui") || normalized.endsWith(".gfx"))) return "interface";
    if (normalized.startsWith("gfx/") || normalized.startsWith("sound/")) return "asset";
    return "plain";
}

function determineSeverity(
    fileType: MergeFileType,
    virtualPath: string,
    resolutionState: MergeResolutionState,
    entryCount: number
): MergeSeverity {
    if (resolutionState === "ignored") {
        return "info";
    }

    if (entryCount <= 1 || resolutionState === "auto") {
        return "info";
    }

    const normalized = virtualPath.toLowerCase();
    if (normalized.startsWith("map/") || normalized.startsWith("sound/")) {
        return "critical";
    }

    if (fileType === "script" || fileType === "event" || fileType === "localisation" || fileType === "interface") {
        return "risky";
    }

    if (fileType === "asset") {
        return "warning";
    }

    return "warning";
}

export function selectLoadOrderWinner(entries: MergeConflictEntry[]): MergeConflictEntry | undefined {
    if (entries.length <= 0) {
        return undefined;
    }

    return entries
        .slice()
        .sort((left, right) => left.loadOrder - right.loadOrder || left.modId - right.modId)
        .at(-1);
}

async function scanSourceModFiles(sourceMod: MergeSourceMod, warnings: string[]): Promise<MergeConflictEntry[]> {
    const installedPath = path.resolve(sourceMod.installedPath);
    if (!fs.existsSync(installedPath)) {
        warnings.push(`Missing source mod folder: ${sourceMod.name} (${installedPath})`);
        return [];
    }

    if (sourceMod.descriptorPath && !fs.existsSync(sourceMod.descriptorPath)) {
        warnings.push(`Missing descriptor file: ${sourceMod.name} (${sourceMod.descriptorPath})`);
    }

    const collected: MergeConflictEntry[] = [];
    const pendingDirectories: string[] = [installedPath];

    while (pendingDirectories.length > 0) {
        const currentDir = pendingDirectories.pop();
        if (!currentDir) {
            continue;
        }

        let dirEntries: fs.Dirent[] = [];
        try {
            dirEntries = await fsp.readdir(currentDir, { withFileTypes: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown directory scan error";
            warnings.push(`Could not read directory: ${currentDir} (${message})`);
            continue;
        }

        dirEntries.sort((left, right) => left.name.localeCompare(right.name));

        for (const dirEntry of dirEntries) {
            const absolutePath = path.join(currentDir, dirEntry.name);
            if (dirEntry.isSymbolicLink()) {
                continue;
            }

            if (dirEntry.isDirectory()) {
                if (!isIgnoredDirectory(dirEntry.name)) {
                    pendingDirectories.push(absolutePath);
                }
                continue;
            }

            if (!dirEntry.isFile()) {
                continue;
            }

            const virtualPath = normalizeVirtualPath(installedPath, absolutePath);
            if (!virtualPath || isIgnoredFile(virtualPath)) {
                continue;
            }

            try {
                const [bytes, stat] = await Promise.all([
                    fsp.readFile(absolutePath),
                    fsp.stat(absolutePath)
                ]);

                collected.push({
                    modId: sourceMod.modId,
                    workshopId: sourceMod.workshopId,
                    modName: sourceMod.name,
                    loadOrder: sourceMod.loadOrder,
                    realPath: absolutePath,
                    virtualPath,
                    sha256: sha256(bytes),
                    sizeBytes: stat.size,
                    modifiedTimeUtc: Number.isFinite(stat.mtimeMs) ? stat.mtime.toISOString() : null
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown file read error";
                warnings.push(`Could not read file: ${absolutePath} (${message})`);
            }
        }
    }

    return collected;
}

function buildFilePlans(entries: MergeConflictEntry[]): MergeFilePlan[] {
    const groups = new Map<string, MergeConflictEntry[]>();

    for (const entry of entries) {
        const key = comparePathKey(entry.virtualPath);
        const current = groups.get(key);
        if (current) {
            current.push(entry);
        } else {
            groups.set(key, [entry]);
        }
    }

    return Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, groupedEntries]) => {
            const sortedEntries = groupedEntries
                .slice()
                .sort((left, right) => left.loadOrder - right.loadOrder || left.modId - right.modId);
            const winner = selectLoadOrderWinner(sortedEntries);
            const uniqueHashes = new Set(sortedEntries.map((entry) => entry.sha256));
            const hasDifferingConflict = sortedEntries.length > 1 && uniqueHashes.size > 1;
            const resolutionState: MergeResolutionState = hasDifferingConflict ? "unresolved" : "auto";
            const virtualPath = winner?.virtualPath ?? sortedEntries[0]?.virtualPath ?? "";
            const fileType = classifyMergeFileType(virtualPath);

            return {
                virtualPath,
                fileType,
                strategy: "copy-load-order-winner",
                winner,
                entries: sortedEntries,
                outputPreview: null,
                severity: determineSeverity(fileType, virtualPath, resolutionState, sortedEntries.length),
                resolutionState
            } satisfies MergeFilePlan;
        });
}

export function summarizeMergePlan(plan: MergePlan): ModMergerSummary {
    const summary: ModMergerSummary = {
        enabledModCount: plan.sourceMods.filter((sourceMod) => sourceMod.isEnabled).length,
        scannedFileCount: 0,
        conflictingFileCount: 0,
        scriptConflictCount: 0,
        scriptObjectConflictCount: 0,
        localisationConflictCount: 0,
        assetConflictCount: 0,
        autoResolvedCount: 0,
        unresolvedCount: 0
    };

    for (const filePlan of plan.filePlans) {
        summary.scannedFileCount += filePlan.entries.length;

        if (filePlan.resolutionState === "auto" && filePlan.entries.length > 1) {
            summary.autoResolvedCount += 1;
        }

        const hasConflict = filePlan.entries.length > 1
            && new Set(filePlan.entries.map((entry) => entry.sha256)).size > 1;
        if (filePlan.resolutionState === "unresolved" && hasConflict) {
            summary.unresolvedCount += 1;
        }
        if (!hasConflict) {
            continue;
        }

        summary.conflictingFileCount += 1;
        if (filePlan.decisionType === "script-object-merge") {
            summary.scriptObjectConflictCount += 1;
        } else if (filePlan.fileType === "script" || filePlan.fileType === "event") {
            summary.scriptConflictCount += 1;
        } else if (filePlan.fileType === "localisation") {
            summary.localisationConflictCount += 1;
        } else if (filePlan.fileType === "asset" || filePlan.fileType === "interface") {
            summary.assetConflictCount += 1;
        }
    }

    return summary;
}

export async function analyzeMergeSources(input: AnalyzeMergeSourcesInput): Promise<{
    plan: MergePlan;
    summary: ModMergerSummary;
    warnings: string[];
}> {
    const warnings: string[] = [];
    const sortedSourceMods = sortSourceMods(input.sourceMods);
    const scannedEntries: MergeConflictEntry[] = [];
    const totalSourceMods = sortedSourceMods.length;

    input.onProgress?.({
        phase: "Scanning mod files",
        processedItemCount: 0,
        totalItemCount: totalSourceMods,
        progressPercent: totalSourceMods > 0 ? 5 : 0,
        message: "Scanning enabled mods for overlapping files."
    });

    let processedSourceMods = 0;
    for (const sourceMod of sortedSourceMods) {
        input.onProgress?.({
            phase: "Scanning mod files",
            currentItemLabel: sourceMod.name,
            processedItemCount: processedSourceMods,
            totalItemCount: totalSourceMods,
            progressPercent: totalSourceMods > 0
                ? Math.round((processedSourceMods / totalSourceMods) * 70)
                : 0,
            message: `Scanning files from ${sourceMod.name}.`
        });

        scannedEntries.push(...await scanSourceModFiles(sourceMod, warnings));
        processedSourceMods += 1;

        input.onProgress?.({
            phase: "Scanning mod files",
            currentItemLabel: sourceMod.name,
            processedItemCount: processedSourceMods,
            totalItemCount: totalSourceMods,
            progressPercent: totalSourceMods > 0
                ? Math.round((processedSourceMods / totalSourceMods) * 70)
                : 70,
            message: `Scanned ${processedSourceMods} of ${totalSourceMods} mod(s).`
        });
    }

    input.onProgress?.({
        phase: "Indexing conflicts",
        processedItemCount: processedSourceMods,
        totalItemCount: totalSourceMods,
        progressPercent: 85,
        message: "Grouping overlapping files into conflict candidates."
    });

    const plan: MergePlan = {
        id: crypto.randomUUID(),
        createdAtUtc: new Date().toISOString(),
        profileId: input.profileId,
        profileName: input.profileName,
        sourceMods: sortedSourceMods,
        outputModName: String(input.outputModName ?? "").trim() || "SMM Merged Mod",
        outputModPath: path.join(path.resolve(input.outputRoot), MERGED_MOD_FOLDER_NAME),
        descriptorPath: path.join(path.resolve(input.descriptorRoot), `${MERGED_MOD_FOLDER_NAME}.mod`),
        filePlans: buildFilePlans(scannedEntries),
        unresolvedConflictCount: 0,
        warnings
    };

    input.onProgress?.({
        phase: "Finalizing plan",
        processedItemCount: processedSourceMods,
        totalItemCount: totalSourceMods,
        progressPercent: 95,
        message: "Building the conflict summary and selecting default winners."
    });

    await decorateMergePlanWithAutomation(plan);
    const summary = summarizeMergePlan(plan);
    plan.unresolvedConflictCount = summary.unresolvedCount;

    return { plan, summary, warnings };
}
