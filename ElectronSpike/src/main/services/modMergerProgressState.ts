import type { ModMergerProgressOperation, ModMergerProgressStatus } from "../../shared/types";

function emptyStatus(): ModMergerProgressStatus {
    return {
        active: false,
        operation: null,
        startedAtUtc: null,
        completedAtUtc: null,
        phase: null,
        currentItemLabel: null,
        processedItemCount: 0,
        totalItemCount: 0,
        progressPercent: 0,
        message: null,
        lastResultOk: null
    };
}

let currentStatus = emptyStatus();

function normalizeText(value: string | null | undefined): string | null {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
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

export function getModMergerProgressStatus(): ModMergerProgressStatus {
    return { ...currentStatus };
}

export function startModMergerProgress(input: {
    operation: ModMergerProgressOperation;
    startedAtUtc?: string | null;
    totalItemCount?: number;
    phase?: string | null;
    currentItemLabel?: string | null;
    progressPercent?: number;
    message?: string | null;
}): void {
    currentStatus = {
        active: true,
        operation: input.operation,
        startedAtUtc: normalizeText(input.startedAtUtc) ?? new Date().toISOString(),
        completedAtUtc: null,
        phase: normalizeText(input.phase),
        currentItemLabel: normalizeText(input.currentItemLabel),
        processedItemCount: 0,
        totalItemCount: normalizeCount(input.totalItemCount, 0),
        progressPercent: normalizePercent(input.progressPercent, 0),
        message: normalizeText(input.message),
        lastResultOk: null
    };
}

export function updateModMergerProgress(input: {
    phase?: string | null;
    currentItemLabel?: string | null;
    processedItemCount?: number;
    totalItemCount?: number;
    progressPercent?: number;
    message?: string | null;
}): void {
    if (!currentStatus.operation) {
        return;
    }

    currentStatus = {
        ...currentStatus,
        active: true,
        phase: normalizeText(input.phase) ?? currentStatus.phase,
        currentItemLabel: normalizeText(input.currentItemLabel) ?? currentStatus.currentItemLabel,
        processedItemCount: normalizeCount(input.processedItemCount, currentStatus.processedItemCount),
        totalItemCount: normalizeCount(input.totalItemCount, currentStatus.totalItemCount),
        progressPercent: normalizePercent(input.progressPercent, currentStatus.progressPercent),
        message: normalizeText(input.message) ?? currentStatus.message
    };
}

export function finishModMergerProgress(result?: {
    ok?: boolean;
    completedAtUtc?: string | null;
    message?: string | null;
}): void {
    if (!currentStatus.operation) {
        return;
    }

    currentStatus = {
        ...currentStatus,
        active: false,
        completedAtUtc: normalizeText(result?.completedAtUtc) ?? new Date().toISOString(),
        progressPercent: result?.ok === false
            ? currentStatus.progressPercent
            : Math.max(100, currentStatus.progressPercent),
        message: normalizeText(result?.message) ?? currentStatus.message,
        lastResultOk: result?.ok === false ? false : true
    };
}

export function resetModMergerProgressStateForTest(): void {
    currentStatus = emptyStatus();
}
