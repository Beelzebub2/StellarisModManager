import { isIP } from "node:net";

const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024;

function isPrivateOrLocalHostname(hostnameRaw: string): boolean {
    const hostname = hostnameRaw.trim().toLowerCase();
    if (!hostname) {
        return true;
    }

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        return true;
    }

    const normalizedIp = hostname.replace(/^\[(.*)\]$/, "$1").split("%")[0];
    const ipVersion = isIP(normalizedIp);
    if (ipVersion === 4) {
        const octets = normalizedIp.split(".").map((part) => Number.parseInt(part, 10));
        if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return true;
        }

        const [a, b] = octets;
        return a === 0
            || a === 10
            || a === 127
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 198 && (b === 18 || b === 19));
    }

    if (ipVersion === 6) {
        return normalizedIp === "::"
            || normalizedIp === "::1"
            || normalizedIp.startsWith("fc")
            || normalizedIp.startsWith("fd")
            || normalizedIp.startsWith("fe80:");
    }

    return false;
}

function normalizeRemoteAssetUrl(rawUrl: string): string | null {
    const value = String(rawUrl ?? "").trim();
    if (!value) {
        return null;
    }

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }

        if (isPrivateOrLocalHostname(parsed.hostname)) {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

async function readResponseBufferWithinLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return null;
    }

    if (!response.body) {
        const bytes = await response.arrayBuffer();
        return bytes.byteLength > maxBytes ? null : Buffer.from(bytes);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        if (!(value instanceof Uint8Array)) {
            continue;
        }

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            try {
                await reader.cancel();
            } catch {
                // ignore cancellation failures
            }

            return null;
        }

        chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks, totalBytes);
}

interface FetchRemoteBufferOptions {
    headers?: HeadersInit;
    maxBytes?: number;
    timeoutMs?: number;
}

interface RemoteBufferResult {
    safeUrl: string;
    buffer: Buffer | null;
}

async function fetchRemoteBuffer(
    rawUrl: string,
    options: FetchRemoteBufferOptions = {}
): Promise<RemoteBufferResult | null> {
    const safeUrl = normalizeRemoteAssetUrl(rawUrl);
    if (!safeUrl) {
        return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(safeUrl, {
            method: "GET",
            headers: options.headers,
            signal: controller.signal
        });

        if (!response.ok) {
            return { safeUrl, buffer: null };
        }

        const buffer = await readResponseBufferWithinLimit(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
        return { safeUrl, buffer };
    } catch {
        return { safeUrl, buffer: null };
    } finally {
        clearTimeout(timeout);
    }
}

export const normalizeRemoteAssetUrlForTest = normalizeRemoteAssetUrl;
export const readResponseBufferWithinLimitForTest = readResponseBufferWithinLimit;

export {
    fetchRemoteBuffer,
    normalizeRemoteAssetUrl,
    readResponseBufferWithinLimit
};
