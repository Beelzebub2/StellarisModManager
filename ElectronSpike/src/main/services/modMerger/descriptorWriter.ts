import { buildManagedDescriptorPath } from "../downloadManager";

export const MERGED_MOD_FOLDER_NAME = "smm_merged";

function escapeDescriptorValue(value: string): string {
    return String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

export function normalizeGeneratedText(value: string): string {
    const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function toSupportedVersion(gameVersion?: string | null): string {
    const match = String(gameVersion ?? "").trim().match(/(\d+)\.(\d+)/);
    return match ? `${match[1]}.${match[2]}.*` : "*";
}

export function buildMergedDescriptorContent(input: {
    descriptorRoot: string;
    outputModPath: string;
    outputModName: string;
    gameVersion?: string | null;
}): string {
    const outputModName = String(input.outputModName ?? "").trim() || "SMM Merged Mod";
    const descriptorManagedPath = buildManagedDescriptorPath({
        modsRoot: input.descriptorRoot,
        installedPath: input.outputModPath
    });

    return normalizeGeneratedText([
        'version="1.0"',
        "tags={",
        '    "Utilities"',
        '    "Fixes"',
        "}",
        `name="${escapeDescriptorValue(outputModName)}"`,
        `supported_version="${escapeDescriptorValue(toSupportedVersion(input.gameVersion))}"`,
        `path="${escapeDescriptorValue(descriptorManagedPath)}"`
    ].join("\n"));
}
