export interface ParsedLocalisationEntry {
    key: string;
    line: string;
}

export interface ParsedLocalisationFile {
    language: string;
    entries: ParsedLocalisationEntry[];
    duplicateKeys: string[];
}

export interface ParsedLocalisationResult {
    ok: boolean;
    file: ParsedLocalisationFile | null;
    error: string | null;
}

function isCommentOrBlank(line: string): boolean {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("#");
}

export function parseLocalisationFile(content: string): ParsedLocalisationResult {
    const lines = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let language: string | null = null;
    const entries: ParsedLocalisationEntry[] = [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const line of lines) {
        if (!language) {
            if (isCommentOrBlank(line)) {
                continue;
            }

            const match = line.match(/^\s*(l_[A-Za-z0-9_]+)\s*:\s*(?:#.*)?$/);
            if (!match) {
                return {
                    ok: false,
                    file: null,
                    error: "Missing localisation language header."
                };
            }
            language = match[1];
            continue;
        }

        if (isCommentOrBlank(line)) {
            continue;
        }

        const match = line.match(/^\s*([A-Za-z0-9_.-]+):\d*\s+(.+?)\s*(?:#.*)?$/);
        if (!match) {
            return {
                ok: false,
                file: null,
                error: `Unsupported localisation entry near: ${line.trim().slice(0, 80)}`
            };
        }

        const key = match[1];
        if (seen.has(key)) {
            duplicates.add(key);
        }
        seen.add(key);
        entries.push({
            key,
            line: ` ${line.trim()}`
        });
    }

    if (!language) {
        return {
            ok: false,
            file: null,
            error: "Missing localisation language header."
        };
    }

    if (entries.length <= 0) {
        return {
            ok: false,
            file: null,
            error: "No localisation keys were found."
        };
    }

    return {
        ok: true,
        file: {
            language,
            entries,
            duplicateKeys: Array.from(duplicates).sort((left, right) => left.localeCompare(right))
        },
        error: null
    };
}

export function buildLocalisationMerge(language: string, entries: ParsedLocalisationEntry[]): string {
    return `${language}:\n${entries.map((entry) => entry.line).join("\n")}\n`;
}
