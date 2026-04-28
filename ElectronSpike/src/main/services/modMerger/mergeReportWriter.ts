import fsp from "node:fs/promises";
import path from "node:path";
import type { MergePlan, ModMergerSummary } from "../../../shared/types";
import { normalizeGeneratedText } from "./descriptorWriter";

export function buildMergeReport(plan: MergePlan, summary: ModMergerSummary, options: {
    appVersion: string;
    gameVersion?: string | null;
    warnings?: string[];
}): string {
    const warnings = Array.isArray(options.warnings) ? options.warnings : [];
    const lines: string[] = [
        "Stellaris Mod Manager Merge Report",
        `Generated: ${new Date().toISOString()}`,
        `Profile: ${plan.profileName ?? "Unknown profile"}`,
        `Output Mod: ${plan.outputModName}`,
        `Output Path: ${plan.outputModPath}`,
        `Descriptor Path: ${plan.descriptorPath}`,
        `App Version: ${options.appVersion}`,
        `Game Version: ${String(options.gameVersion ?? "").trim() || "Unknown"}`,
        "",
        "Summary",
        `- Source mods: ${summary.enabledModCount}`,
        `- Scanned files: ${summary.scannedFileCount}`,
        `- Conflicting files: ${summary.conflictingFileCount}`,
        `- Auto-resolved: ${summary.autoResolvedCount}`,
        `- Unresolved: ${summary.unresolvedCount}`,
        ""
    ];

    if (plan.automation) {
        lines.push("Auto Control");
        lines.push(`- Safe recommendations: ${plan.automation.safeCount}`);
        lines.push(`- Review recommendations: ${plan.automation.reviewCount}`);
        lines.push(`- Manual decisions: ${plan.automation.manualCount}`);
        lines.push(`- Ignored files: ${plan.automation.ignoredCount}`);
        lines.push(`- Generated outputs: ${plan.automation.generatedCount}`);
        lines.push("");
    }

    if (warnings.length > 0) {
        lines.push("Warnings");
        for (const warning of warnings) {
            lines.push(`- ${warning}`);
        }
        lines.push("");
    }

    lines.push("Source Mods");
    for (const sourceMod of plan.sourceMods) {
        lines.push(`- [${sourceMod.loadOrder}] ${sourceMod.name} (${sourceMod.workshopId || "local"})`);
    }
    lines.push("");
    lines.push("File Plans");

    for (const filePlan of plan.filePlans) {
        const winnerLabel = filePlan.winner ? `${filePlan.winner.modName} (#${filePlan.winner.modId})` : "none";
        const reasonLabel = filePlan.autoRecommendation?.reasonCode
            ? ` | reason=${filePlan.autoRecommendation.reasonCode}`
            : "";
        lines.push(
            `- ${filePlan.virtualPath} | type=${filePlan.fileType} | state=${filePlan.resolutionState} | strategy=${filePlan.strategy} | decision=${filePlan.decisionType ?? "unknown"} | winner=${winnerLabel}${reasonLabel}`
        );
    }

    return normalizeGeneratedText(lines.join("\n"));
}

export async function writeMergeArtifacts(outputModPath: string, plan: MergePlan, summary: ModMergerSummary, options: {
    appVersion: string;
    gameVersion?: string | null;
    warnings?: string[];
}): Promise<{ manifestPath: string; reportPath: string }> {
    const manifestPath = path.join(outputModPath, ".smm-merge-manifest.json");
    const reportPath = path.join(outputModPath, "merge-report.txt");

    const manifest = {
        buildDateUtc: new Date().toISOString(),
        appVersion: options.appVersion,
        gameVersion: String(options.gameVersion ?? "").trim() || null,
        automation: plan.automation ?? null,
        sourceMods: plan.sourceMods,
        conflictResolutions: plan.filePlans.map((filePlan) => ({
            virtualPath: filePlan.virtualPath,
            fileType: filePlan.fileType,
            strategy: filePlan.strategy,
            resolutionState: filePlan.resolutionState,
            severity: filePlan.severity,
            decisionType: filePlan.decisionType ?? null,
            autoRecommendation: filePlan.autoRecommendation ?? null,
            reviewState: filePlan.reviewState ?? null,
            generated: Boolean(filePlan.generatedOutput && filePlan.generatedOutput.trim()),
            winnerModId: filePlan.winner?.modId ?? null,
            entries: filePlan.entries
        }))
    };

    await Promise.all([
        fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
        fsp.writeFile(reportPath, buildMergeReport(plan, summary, options), "utf8")
    ]);

    return { manifestPath, reportPath };
}
