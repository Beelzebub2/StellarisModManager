import type { ModsPathMigrationStatus } from "../../shared/types";

function emptyStatus(): ModsPathMigrationStatus {
    return {
        active: false,
        sourceModsPath: null,
        targetModsPath: null,
        moveExistingMods: false,
        startedAtUtc: null,
        completedAtUtc: null,
        lastMessage: null,
        currentModName: null,
        currentPhase: null,
        processedModCount: 0,
        totalModCount: 0,
        progressPercent: 0
    };
}

let currentStatus = emptyStatus();

function normalizePathValue(value: string | null | undefined): string | null {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
}

export function getModsPathMigrationStatus(): ModsPathMigrationStatus {
    return { ...currentStatus };
}

export function isModsPathMigrationActive(): boolean {
    return currentStatus.active === true;
}

export function startModsPathMigration(input: {
    sourceModsPath?: string | null;
    targetModsPath?: string | null;
    moveExistingMods: boolean;
    startedAtUtc?: string | null;
}): boolean {
    if (currentStatus.active) {
        return false;
    }

    currentStatus = {
        active: true,
        sourceModsPath: normalizePathValue(input.sourceModsPath),
        targetModsPath: normalizePathValue(input.targetModsPath),
        moveExistingMods: input.moveExistingMods === true,
        startedAtUtc: normalizePathValue(input.startedAtUtc) ?? new Date().toISOString(),
        completedAtUtc: null,
        lastMessage: input.moveExistingMods === true
            ? "Moving managed mods to the new managed mods folder."
            : "Updating managed mod descriptor paths.",
        currentModName: null,
        currentPhase: null,
        processedModCount: 0,
        totalModCount: 0,
        progressPercent: 0
    };

    return true;
}

function normalizeCount(value: number | undefined, fallback = 0): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.floor(value as number));
}

function normalizePercent(value: number | undefined, fallback = 0): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(value as number)));
}

export function updateModsPathMigrationProgress(input: {
    currentModName?: string | null;
    currentPhase?: string | null;
    processedModCount?: number;
    totalModCount?: number;
    progressPercent?: number;
    lastMessage?: string | null;
}): void {
    if (!currentStatus.active) {
        return;
    }

    currentStatus = {
        ...currentStatus,
        currentModName: normalizePathValue(input.currentModName) ?? currentStatus.currentModName,
        currentPhase: normalizePathValue(input.currentPhase) ?? currentStatus.currentPhase,
        processedModCount: normalizeCount(input.processedModCount, currentStatus.processedModCount),
        totalModCount: normalizeCount(input.totalModCount, currentStatus.totalModCount),
        progressPercent: normalizePercent(input.progressPercent, currentStatus.progressPercent),
        lastMessage: normalizePathValue(input.lastMessage) ?? currentStatus.lastMessage
    };
}

export function finishModsPathMigration(result?: {
    ok?: boolean;
    message?: string | null;
}): void {
    currentStatus = {
        ...currentStatus,
        active: false,
        completedAtUtc: new Date().toISOString(),
        lastMessage: normalizePathValue(result?.message)
            ?? (result?.ok === false ? "Managed mods folder change failed." : "Managed mods folder change finished.")
    };
}

export function resetModsPathMigrationStateForTest(): void {
    currentStatus = emptyStatus();
}
