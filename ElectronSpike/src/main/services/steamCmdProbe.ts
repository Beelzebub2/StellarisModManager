import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type {
    SteamCmdProbeEvent,
    SteamCmdProbeRequest,
    SteamCmdProbeStartResult,
    SteamCmdProbeStatus
} from "../../shared/types";
import { loadSettingsSnapshot } from "./settings";

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 120000;

let activeProcess: ChildProcess | null = null;
let activeTimeout: NodeJS.Timeout | null = null;

let probeStatus: SteamCmdProbeStatus = {
    isRunning: false,
    pid: null,
    command: null,
    startedAtUtc: null
};

function emitEvent(
    handler: ((event: SteamCmdProbeEvent) => void) | undefined,
    event: SteamCmdProbeEvent
): void {
    if (!handler) {
        return;
    }

    handler(event);
}

function normalizeTimeout(value: number | undefined): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return DEFAULT_TIMEOUT_MS;
    }

    if (value < 1000) {
        return 1000;
    }

    return Math.min(value, MAX_TIMEOUT_MS);
}

function resolveSteamCmdPath(request: SteamCmdProbeRequest | undefined): string {
    const requested = request?.steamCmdPath?.trim();
    if (requested) {
        return requested;
    }

    const settings = loadSettingsSnapshot();
    return settings?.steamCmdPath?.trim() ?? "";
}

function resolveForceInstallDir(request: SteamCmdProbeRequest | undefined): string | undefined {
    const requested = request?.forceInstallDir?.trim();
    if (requested) {
        return requested;
    }

    const settings = loadSettingsSnapshot();
    return settings?.steamCmdDownloadPath?.trim();
}

function buildArgs(request: SteamCmdProbeRequest | undefined, forceInstallDir: string | undefined): string[] {
    const args: string[] = [];

    if (forceInstallDir) {
        args.push("+force_install_dir", forceInstallDir);
    }

    const cleanedArgs = (request?.extraArgs ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

    if (cleanedArgs.length === 0) {
        args.push("+quit");
    } else {
        args.push(...cleanedArgs);
    }

    return args;
}

function clearActiveState(): void {
    if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
    }

    activeProcess = null;

    probeStatus = {
        isRunning: false,
        pid: null,
        command: null,
        startedAtUtc: null
    };
}

function toStartResult(ok: boolean, message: string): SteamCmdProbeStartResult {
    return {
        ok,
        message,
        status: getSteamCmdProbeStatus()
    };
}

function wireStdout(
    child: ChildProcess,
    handler: ((event: SteamCmdProbeEvent) => void) | undefined
): void {
    if (!child.stdout) {
        return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (!text) {
            return;
        }

        emitEvent(handler, {
            kind: "stdout",
            message: text,
            timestampUtc: new Date().toISOString()
        });
    });
}

function wireStderr(
    child: ChildProcess,
    handler: ((event: SteamCmdProbeEvent) => void) | undefined
): void {
    if (!child.stderr) {
        return;
    }

    child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (!text) {
            return;
        }

        emitEvent(handler, {
            kind: "stderr",
            message: text,
            timestampUtc: new Date().toISOString()
        });
    });
}

export function getSteamCmdProbeStatus(): SteamCmdProbeStatus {
    return {
        isRunning: probeStatus.isRunning,
        pid: probeStatus.pid,
        command: probeStatus.command,
        startedAtUtc: probeStatus.startedAtUtc
    };
}

export function startSteamCmdProbe(
    request: SteamCmdProbeRequest | undefined,
    handler?: (event: SteamCmdProbeEvent) => void
): SteamCmdProbeStartResult {
    if (activeProcess && !activeProcess.killed) {
        return toStartResult(false, "SteamCMD probe is already running.");
    }

    const steamCmdPath = resolveSteamCmdPath(request);
    if (!steamCmdPath) {
        return toStartResult(false, "SteamCMD path is not configured.");
    }

    if (!fs.existsSync(steamCmdPath)) {
        return toStartResult(false, `SteamCMD executable not found: ${steamCmdPath}`);
    }

    const forceInstallDir = resolveForceInstallDir(request);
    const args = buildArgs(request, forceInstallDir);
    const timeoutMs = normalizeTimeout(request?.timeoutMs);

    const commandText = [steamCmdPath, ...args].join(" ");

    const child = spawn(steamCmdPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });

    activeProcess = child;

    probeStatus = {
        isRunning: true,
        pid: child.pid ?? null,
        command: commandText,
        startedAtUtc: new Date().toISOString()
    };

    emitEvent(handler, {
        kind: "status",
        message: `Started SteamCMD probe: ${commandText}`,
        timestampUtc: new Date().toISOString()
    });

    wireStdout(child, handler);
    wireStderr(child, handler);

    child.on("error", (error: Error) => {
        emitEvent(handler, {
            kind: "error",
            message: error.message,
            timestampUtc: new Date().toISOString()
        });

        clearActiveState();
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        emitEvent(handler, {
            kind: "exit",
            message: "SteamCMD probe process exited.",
            timestampUtc: new Date().toISOString(),
            code,
            signal: signal ?? null
        });

        clearActiveState();
    });

    activeTimeout = setTimeout(() => {
        if (!activeProcess || activeProcess.killed) {
            return;
        }

        emitEvent(handler, {
            kind: "status",
            message: `Probe timeout reached (${timeoutMs}ms); stopping process.`,
            timestampUtc: new Date().toISOString()
        });

        activeProcess.kill();
    }, timeoutMs);

    return toStartResult(true, "SteamCMD probe started.");
}

export function stopSteamCmdProbe(
    handler?: (event: SteamCmdProbeEvent) => void
): SteamCmdProbeStartResult {
    if (!activeProcess || activeProcess.killed) {
        return toStartResult(false, "SteamCMD probe is not running.");
    }

    emitEvent(handler, {
        kind: "status",
        message: "Stopping SteamCMD probe process.",
        timestampUtc: new Date().toISOString()
    });

    activeProcess.kill();
    return toStartResult(true, "SteamCMD probe stop requested.");
}
