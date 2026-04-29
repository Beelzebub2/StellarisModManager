export function queueStatusLabel(status) {
    switch ((status || "").toLowerCase()) {
        case "queued":
            return "Queued";
        case "running":
            return "Running";
        case "completed":
            return "Done";
        case "failed":
            return "Failed";
        case "cancelled":
            return "Cancelled";
        default:
            return "Unknown";
    }
}

export function queueActionLabel(action) {
    return action === "uninstall" ? "Uninstall" : "Install";
}

export function parseByteProgress(rawMessage) {
    const match = String(rawMessage || "").match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*(MB|GB|KB)/i);
    if (!match) return null;
    return `${match[1]} / ${match[2]} ${match[3].toUpperCase()}`;
}

export function queueProgressMode(item) {
    return String(item?.progressMode || "").toLowerCase() === "indeterminate" ? "indeterminate" : "determinate";
}

export function buildQueueMessageForDisplay(item, developerModeEnabled) {
    const status = String(item.status || "").toLowerCase();
    const action = item.action === "uninstall" ? "uninstall" : "install";
    const rawMessage = String(item.message || "").trim();

    if (developerModeEnabled) {
        return rawMessage || (status === "running" || status === "queued" ? "Working..." : "No detail message available.");
    }

    if (status === "queued") {
        if (/retrying .*individually|individual steamcmd retry/i.test(rawMessage)) {
            return "Retrying this mod in its own SteamCMD run...";
        }
        if (/waiting for batch start/i.test(rawMessage)) {
            return "Waiting for the current SteamCMD batch to begin...";
        }
        return action === "uninstall" ? "Queued for uninstall." : "Waiting for a download slot...";
    }

    if (status === "running") {
        if (/Preparing .*staged files|Committing .*staged files|Downloading from Steam\.\.\.|installed data/i.test(rawMessage)) {
            return rawMessage;
        }
        if (/steamworks unavailable|steam not running/i.test(rawMessage) || /steamcmd|SteamCMD/i.test(rawMessage)) {
            if (/preparing|preparing batch/i.test(rawMessage)) return "Starting download via SteamCMD...";
            if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
            if (/deploying|installed to (?:mods path|managed mods folder)/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
            if (/batch/i.test(rawMessage)) return "Downloading via SteamCMD batch...";
            return "Downloading via SteamCMD...";
        }
        if (/verifying downloaded files/i.test(rawMessage)) return "Verifying downloaded files...";
        if (/deploying|installed to (?:mods path|managed mods folder)/i.test(rawMessage)) return "Deploying to Stellaris mods folder...";
        if (/already in steam workshop cache|already downloaded/i.test(rawMessage)) return "Deploying cached mod files...";
        return action === "uninstall" ? "Removing installed files..." : "Downloading via Steam...";
    }

    if (status === "completed") {
        return action === "uninstall" ? "Uninstall completed." : "Installed successfully.";
    }

    if (status === "cancelled") {
        return "Operation cancelled.";
    }

    if (status === "failed") {
        if (/steamworks unavailable|steam not running/i.test(rawMessage)) {
            return "Steam is not running. Start Steam and retry, or switch to SteamCMD in Settings.";
        }
        if (/download item\s+\d+\s+failed|failed\s*\(failure\)|steamcmd reported download failure/i.test(rawMessage)) {
            return "Download failed. Retry later or check SteamCMD in Settings.";
        }
        if (/steamcmd path is not configured|executable is missing|configured steamcmd executable/i.test(rawMessage)) {
            return "SteamCMD not configured \u2014 update it in Settings or switch runtime to Steamworks.";
        }
        if (/timed out/i.test(rawMessage)) {
            return "Download timed out. Retry or check your connection.";
        }
        if (/stalled/i.test(rawMessage)) {
            return "SteamCMD stalled. The queue will retry this mod individually when possible.";
        }
        if (/retrying .*individually|individual steamcmd retry/i.test(rawMessage)) {
            return "Batch recovery queued an individual SteamCMD retry for this mod.";
        }
        if (/steam could not start download|check you are logged in/i.test(rawMessage)) {
            return "Steam could not start download. Make sure you are logged in to Steam.";
        }
        return "Operation failed. Enable Developer mode for details.";
    }

    return rawMessage || "Queue activity updated.";
}

export function buildQueueDetailMessage(rawMessage, developerModeEnabled = false) {
    const raw = String(rawMessage || "").trim();
    if (!raw) {
        return "No queue activity.";
    }

    if (developerModeEnabled) {
        return raw;
    }

    if (/download item\s+\d+\s+failed|failed\s*\(failure\)|steamcmd reported download failure/i.test(raw)) {
        return "Steam download failed. Retry later or verify SteamCMD in Settings.";
    }

    if (/installed to (?:mods path|managed mods folder)/i.test(raw)) {
        return "Install completed.";
    }

    if (/uninstall completed/i.test(raw)) {
        return "Uninstall completed.";
    }

    if (/queued/i.test(raw)) {
        return "Queued for processing.";
    }

    if (/retrying .*individually|individual steamcmd retry/i.test(raw)) {
        return "Retrying this mod individually.";
    }

    if (/cancel/i.test(raw)) {
        return "Queue operation cancelled.";
    }

    if (/stalled/i.test(raw)) {
        return "SteamCMD stalled before completion.";
    }

    if (/launching steamcmd|downloading|deploying/i.test(raw)) {
        return "Install in progress...";
    }

    return "Queue activity updated.";
}

export function queueClampProgress(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
}

export function formatQueueUpdatedAt(value) {
    const raw = String(value || "").trim();
    if (!raw) return "never";

    const timestamp = new Date(raw).getTime();
    if (!Number.isFinite(timestamp)) return raw;

    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 5000) return "just now";

    const seconds = Math.floor(deltaMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function partitionQueueItems(items) {
    const active = [];
    const history = [];

    for (const item of items || []) {
        const status = String(item?.status || "").toLowerCase();
        if (status === "queued" || status === "running") active.push(item);
        else history.push(item);
    }

    return { active, history };
}
