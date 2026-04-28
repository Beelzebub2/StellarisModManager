import fsp from "node:fs/promises";
import type {
    MergeAutoRecommendation,
    MergeFilePlan,
    MergePlan,
    MergePlanAutomationSummary,
    ModMergerApplyAutoRequest,
    ModMergerSummary
} from "../../../shared/types";
import { normalizeGeneratedText } from "./descriptorWriter";
import { isBlockedAutoPath, isLocalisationPath, isScriptObjectPath } from "./mergeClassifier";
import { buildLocalisationMerge, parseLocalisationFile, type ParsedLocalisationEntry } from "./localisationParser";
import { buildTopLevelObjectMerge, parseTopLevelObjects, type ParsedTopLevelObject } from "./textParsers";

function recommendation(input: MergeAutoRecommendation): MergeAutoRecommendation {
    return input;
}

function safeRecommendation(reasonCode: string, reason: string): MergeAutoRecommendation {
    return recommendation({
        canApply: true,
        confidence: "safe",
        reasonCode,
        reason
    });
}

function manualRecommendation(reasonCode: string, reason: string): MergeAutoRecommendation {
    return recommendation({
        canApply: false,
        confidence: "manual",
        reasonCode,
        reason
    });
}

function informationalRecommendation(reasonCode: string, reason: string): MergeAutoRecommendation {
    return recommendation({
        canApply: false,
        confidence: "safe",
        reasonCode,
        reason
    });
}

async function readEntryContent(entryPath: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
    try {
        return {
            ok: true,
            content: await fsp.readFile(entryPath, "utf8")
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown file read error"
        };
    }
}

function findDuplicates(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }

    return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

async function decorateLocalisation(filePlan: MergeFilePlan): Promise<void> {
    const allEntries: ParsedLocalisationEntry[] = [];
    const allKeys: string[] = [];
    let language: string | null = null;

    for (const entry of filePlan.entries) {
        const read = await readEntryContent(entry.realPath);
        if (!read.ok) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation("file-read-error", `Could not read ${entry.modName}: ${read.error}`);
            filePlan.mergeDetails = { parseError: read.error };
            return;
        }

        const parsed = parseLocalisationFile(read.content);
        if (!parsed.ok || !parsed.file) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation("parse-error", parsed.error ?? "Could not parse localisation file.");
            filePlan.mergeDetails = { parseError: parsed.error ?? "Could not parse localisation file." };
            return;
        }

        if (parsed.file.duplicateKeys.length > 0) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation(
                "localisation-key-collision",
                "One source contains duplicate localisation keys."
            );
            filePlan.mergeDetails = {
                duplicateKeys: parsed.file.duplicateKeys,
                localisationKeys: parsed.file.entries.map((candidate) => candidate.key)
            };
            return;
        }

        if (!language) {
            language = parsed.file.language;
        } else if (language !== parsed.file.language) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation(
                "localisation-language-mismatch",
                "Source files use different localisation language headers."
            );
            filePlan.mergeDetails = { parseError: "Language headers do not match." };
            return;
        }

        allEntries.push(...parsed.file.entries);
        allKeys.push(...parsed.file.entries.map((candidate) => candidate.key));
    }

    const duplicateKeys = findDuplicates(allKeys);
    if (duplicateKeys.length > 0) {
        filePlan.decisionType = "file-winner";
        filePlan.autoRecommendation = manualRecommendation(
            "localisation-key-collision",
            "Two or more source files define the same localisation key."
        );
        filePlan.mergeDetails = {
            duplicateKeys,
            localisationKeys: Array.from(new Set(allKeys)).sort((left, right) => left.localeCompare(right))
        };
        return;
    }

    filePlan.decisionType = "localisation-key-merge";
    filePlan.autoRecommendation = safeRecommendation(
        "localisation-non-overlap",
        "All localisation keys are unique across the conflicting files, so they can be combined automatically."
    );
    filePlan.generatedOutput = normalizeGeneratedText(buildLocalisationMerge(language ?? "l_english", allEntries));
    filePlan.mergeDetails = {
        localisationKeys: allKeys
    };
    filePlan.reviewState = "needs-review";
}

async function decorateScriptObjects(filePlan: MergeFilePlan): Promise<void> {
    const allObjects: ParsedTopLevelObject[] = [];
    const allKeys: string[] = [];

    for (const entry of filePlan.entries) {
        const read = await readEntryContent(entry.realPath);
        if (!read.ok) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation("file-read-error", `Could not read ${entry.modName}: ${read.error}`);
            filePlan.mergeDetails = { parseError: read.error };
            return;
        }

        const parsed = parseTopLevelObjects(read.content);
        if (!parsed.ok) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation("parse-error", parsed.error ?? "Could not parse script file.");
            filePlan.mergeDetails = { parseError: parsed.error ?? "Could not parse script file." };
            return;
        }

        allObjects.push(...parsed.objects);
        allKeys.push(...parsed.objects.map((candidate) => candidate.key));
    }

    const duplicateKeys = findDuplicates(allKeys);
    if (duplicateKeys.length > 0) {
        filePlan.decisionType = "file-winner";
        filePlan.autoRecommendation = manualRecommendation(
            "script-object-collision",
            "Two or more source files define the same top-level script object."
        );
        filePlan.mergeDetails = {
            duplicateKeys,
            objectKeys: Array.from(new Set(allKeys)).sort((left, right) => left.localeCompare(right))
        };
        return;
    }

    filePlan.decisionType = "script-object-merge";
    filePlan.autoRecommendation = safeRecommendation(
        "script-object-non-overlap",
        "All top-level script objects are unique across the conflicting files, so they can be combined automatically."
    );
    filePlan.generatedOutput = normalizeGeneratedText(buildTopLevelObjectMerge(allObjects));
    filePlan.mergeDetails = {
        objectKeys: allKeys
    };
    filePlan.reviewState = "needs-review";
}

function resetAutomationFields(filePlan: MergeFilePlan): void {
    filePlan.decisionType = undefined;
    filePlan.autoRecommendation = undefined;
    filePlan.mergeDetails = undefined;
    filePlan.generatedOutput = null;
    filePlan.reviewState = filePlan.resolutionState === "unresolved" ? "needs-review" : "not-needed";
}

function hasDifferingConflict(filePlan: MergeFilePlan): boolean {
    return filePlan.entries.length > 1 && new Set(filePlan.entries.map((entry) => entry.sha256)).size > 1;
}

export async function decorateMergePlanWithAutomation(plan: MergePlan): Promise<void> {
    for (const filePlan of plan.filePlans) {
        resetAutomationFields(filePlan);

        if (filePlan.strategy === "ignore" || filePlan.resolutionState === "ignored") {
            filePlan.decisionType = "ignored";
            filePlan.autoRecommendation = manualRecommendation("ignored", "This file is excluded from the merged output.");
            filePlan.reviewState = "not-needed";
            continue;
        }

        if (filePlan.entries.length <= 1) {
            filePlan.decisionType = "single-provider";
            filePlan.autoRecommendation = informationalRecommendation("single-provider", "Only one source provides this file.");
            filePlan.reviewState = "not-needed";
            continue;
        }

        if (!hasDifferingConflict(filePlan)) {
            filePlan.decisionType = "identical-duplicate";
            filePlan.autoRecommendation = informationalRecommendation(
                "identical-duplicate",
                "All source files are byte-identical, so the load-order copy is safe."
            );
            filePlan.reviewState = "not-needed";
            continue;
        }

        if (isBlockedAutoPath(filePlan.virtualPath)) {
            filePlan.decisionType = "file-winner";
            filePlan.autoRecommendation = manualRecommendation(
                "blocked-path",
                "This path is intentionally excluded from automatic text merging."
            );
            continue;
        }

        if (isLocalisationPath(filePlan.virtualPath)) {
            await decorateLocalisation(filePlan);
            continue;
        }

        if (isScriptObjectPath(filePlan.virtualPath)) {
            await decorateScriptObjects(filePlan);
            continue;
        }

        filePlan.decisionType = "file-winner";
        filePlan.autoRecommendation = manualRecommendation(
            "winner-required",
            "This file type needs a chosen winner or manual merge."
        );
    }

    plan.automation = buildAutomationSummary(plan);
}

export function buildAutomationSummary(plan: MergePlan): MergePlanAutomationSummary {
    const summary: MergePlanAutomationSummary = {
        safeCount: 0,
        reviewCount: 0,
        manualCount: 0,
        ignoredCount: 0,
        generatedCount: 0
    };

    for (const filePlan of plan.filePlans) {
        if (filePlan.resolutionState === "ignored" || filePlan.strategy === "ignore") {
            summary.ignoredCount += 1;
        }

        if (filePlan.generatedOutput && filePlan.generatedOutput.trim()) {
            summary.generatedCount += 1;
        }

        if (filePlan.resolutionState !== "unresolved") {
            continue;
        }

        const autoRecommendation = filePlan.autoRecommendation;
        if (autoRecommendation?.canApply && autoRecommendation.confidence === "safe") {
            summary.safeCount += 1;
        } else if (autoRecommendation?.confidence === "review") {
            summary.reviewCount += 1;
        } else {
            summary.manualCount += 1;
        }
    }

    return summary;
}

function summarizePlan(plan: MergePlan): ModMergerSummary {
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

        const hasConflict = hasDifferingConflict(filePlan);
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

export function applyAutoResolutions(
    plan: MergePlan,
    scope: ModMergerApplyAutoRequest["scope"] = "safe"
): ModMergerSummary {
    for (const filePlan of plan.filePlans) {
        const autoRecommendation = filePlan.autoRecommendation;
        const canApplySafe = scope === "safe"
            && autoRecommendation?.canApply === true
            && autoRecommendation.confidence === "safe";

        if (!canApplySafe || !filePlan.generatedOutput?.trim()) {
            continue;
        }

        if (filePlan.decisionType === "localisation-key-merge") {
            filePlan.strategy = "localisation-key-merge";
        } else if (filePlan.decisionType === "script-object-merge") {
            filePlan.strategy = "script-object-merge";
        } else {
            continue;
        }

        filePlan.resolutionState = "auto";
        filePlan.outputPreview = filePlan.generatedOutput;
        filePlan.reviewState = "not-needed";
        filePlan.severity = "info";
    }

    const summary = summarizePlan(plan);
    plan.unresolvedConflictCount = summary.unresolvedCount;
    plan.automation = buildAutomationSummary(plan);
    return summary;
}
