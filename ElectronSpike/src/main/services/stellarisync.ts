import https from "node:https";
import http from "node:http";
import type { StellarisyncStatus } from "../../shared/types";
import { logInfo, logError } from "./logger";

const STELLARISYNC_BASE_URL = "https://stellarisync.rrmtools.uk";
const PING_TIMEOUT_MS = 8000;

export async function checkStellarisyncStatus(): Promise<StellarisyncStatus> {
    const now = new Date().toISOString();

    try {
        const online = await pingEndpoint(`${STELLARISYNC_BASE_URL}/mods/versions`);
        if (online) {
            logInfo("Stellarisync: online");
        } else {
            logInfo("Stellarisync: offline (bad response)");
        }
        return { online, checkedAtUtc: now };
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logError(`Stellarisync ping failed: ${msg}`);
        return { online: false, checkedAtUtc: now };
    }
}

function pingEndpoint(urlString: string): Promise<boolean> {
    return new Promise((resolve) => {
        const url = new URL(urlString);
        const client = url.protocol === "https:" ? https : http;

        const req = client.get(url, { timeout: PING_TIMEOUT_MS }, (res) => {
            // Consume response body to free the socket
            res.resume();
            const code = res.statusCode ?? 0;
            resolve(code >= 200 && code < 500);
        });

        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
    });
}
