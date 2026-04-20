import fs from "node:fs";
import path from "node:path";
import { logInfo, logError } from "./logger";
import { discoverSteamLibraries } from "./steamDiscovery";

const STELLARIS_APP_ID = 281990;
const POLL_INTERVAL_MS = 500;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
const START_TIMEOUT_MS = 10_000;

// ISteamUGC::EItemState bitmask flags
const ITEM_STATE_INSTALLED = 4;

type SteamworksModule = typeof import("steamworks.js");
type SteamworksClient = ReturnType<SteamworksModule["init"]>;

let steamworks: SteamworksModule | null = null;
let client: SteamworksClient | null = null;
let initAttempted = false;

export function tryInitSteamworks(): boolean {
    if (initAttempted) return client !== null;
    initAttempted = true;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sw = require("steamworks.js") as SteamworksModule;

    // Try Stellaris App ID first so workshop files land in the right path.
    // Fall back to Spacewar (480) which every account has — works for most workshop operations.
    for (const appId of [STELLARIS_APP_ID, 480]) {
        try {
            client = sw.init(appId);
            steamworks = sw;
            logInfo(`Steamworks: initialized (App ID ${appId})`);
            return true;
        } catch (err) {
            logError(`Steamworks: init failed with App ID ${appId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    steamworks = null;
    return false;
}

export function isSteamworksAvailable(): boolean {
    return tryInitSteamworks();
}

function findInSteamWorkshopCache(workshopId: string): string | null {
    const discovery = discoverSteamLibraries();
    for (const library of discovery.libraries) {
        const candidate = path.join(library.workshopContentPath, workshopId);
        try {
            if (fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0) {
                return candidate;
            }
        } catch { /* skip */ }
    }
    return null;
}

export async function runSteamworksDownload(
    workshopId: string,
    job: { cancelled: boolean },
    reportProgress: (progress: number, message: string) => void
): Promise<{ ok: boolean; installPath: string; message: string }> {
    if (!tryInitSteamworks() || !client || !steamworks) {
        return { ok: false, installPath: "", message: "Steamworks unavailable — is Steam running with Stellaris in library?" };
    }

    const c = client;
    const itemId = BigInt(workshopId);

    // Check if Steam already has this item downloaded
    try {
        const existing = c.workshop.installInfo(itemId);
        if (existing?.folder) {
            const folderPath = existing.folder;
            if (fs.existsSync(folderPath) && fs.readdirSync(folderPath).length > 0) {
                logInfo(`Steamworks: ${workshopId} already cached at ${folderPath}`);
                return { ok: true, installPath: folderPath, message: "Already in Steam workshop cache." };
            }
        }
    } catch { /* fall through to download */ }

    reportProgress(3, `Requesting download from Steam for ${workshopId}...`);
    logInfo(`Steamworks: requesting download for ${workshopId}`);

    let downloadStarted: boolean;
    try {
        downloadStarted = c.workshop.download(itemId, true);
    } catch (err) {
        return { ok: false, installPath: "", message: `Steam download request failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!downloadStarted) {
        const cached = findInSteamWorkshopCache(workshopId);
        if (cached) {
            return { ok: true, installPath: cached, message: "Already in Steam workshop cache." };
        }
        return { ok: false, installPath: "", message: "Steam could not start download — check you are logged in to Steam." };
    }

    const startTime = Date.now();
    let lastPct = 4;
    let downloadSeen = false;

    // Callbacks are dispatched automatically at 30fps by steamworks.js after init().
    // We only need to poll the state via downloadInfo() / installInfo().
    return new Promise<{ ok: boolean; installPath: string; message: string }>((resolve) => {
        const poll = (): void => {
            if (job.cancelled) {
                resolve({ ok: false, installPath: "", message: "Download cancelled." });
                return;
            }

            if (Date.now() - startTime > DOWNLOAD_TIMEOUT_MS) {
                resolve({ ok: false, installPath: "", message: "Steam download timed out after 20 minutes." });
                return;
            }

            try {
                const info = c.workshop.downloadInfo(itemId);

                if (info !== null) {
                    downloadSeen = true;
                    const current = Number(info.current);
                    const total = Number(info.total);

                    if (total > 0) {
                        const pct = Math.min(95, Math.max(5, Math.round((current / total) * 95)));
                        if (pct !== lastPct) {
                            lastPct = pct;
                            const dlMb = (current / 1048576).toFixed(1);
                            const totalMb = (total / 1048576).toFixed(1);
                            reportProgress(pct, `Downloading... ${pct}% (${dlMb} / ${totalMb} MB)`);
                        }
                    } else {
                        reportProgress(5, `Steam is downloading ${workshopId}...`);
                    }
                } else {
                    // downloadInfo null means either: not yet started, or download complete
                    const state = c.workshop.state(itemId);
                    const isInstalled = (state & ITEM_STATE_INSTALLED) !== 0;

                    if (isInstalled || downloadSeen) {
                        // Try installInfo first (most reliable)
                        try {
                            const installInfo = c.workshop.installInfo(itemId);
                            if (installInfo?.folder) {
                                const folder = installInfo.folder;
                                if (fs.existsSync(folder) && fs.readdirSync(folder).length > 0) {
                                    logInfo(`Steamworks: ${workshopId} complete at ${folder}`);
                                    resolve({ ok: true, installPath: folder, message: "Download complete." });
                                    return;
                                }
                            }
                        } catch { /* fall through */ }

                        // Fall back to library discovery
                        const discovered = findInSteamWorkshopCache(workshopId);
                        if (discovered) {
                            logInfo(`Steamworks: ${workshopId} complete (discovered at ${discovered})`);
                            resolve({ ok: true, installPath: discovered, message: "Download complete." });
                            return;
                        }

                        if (downloadSeen) {
                            resolve({ ok: false, installPath: "", message: "Download finished but mod files not found in Steam workshop cache." });
                            return;
                        }
                    }

                    // Not started yet — give Steam time to queue it
                    if (!downloadSeen && Date.now() - startTime > START_TIMEOUT_MS) {
                        resolve({ ok: false, installPath: "", message: "Steam did not begin download within 10 seconds." });
                        return;
                    }
                }
            } catch (err) {
                resolve({
                    ok: false,
                    installPath: "",
                    message: `Steam error during download: ${err instanceof Error ? err.message : String(err)}`
                });
                return;
            }

            setTimeout(poll, POLL_INTERVAL_MS);
        };

        setTimeout(poll, POLL_INTERVAL_MS);
    });
}
