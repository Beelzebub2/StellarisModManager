export interface ParsedTopLevelObject {
    key: string;
    text: string;
}

export interface ParsedTopLevelObjectsResult {
    ok: boolean;
    objects: ParsedTopLevelObject[];
    error: string | null;
}

function scanLine(line: string): { delta: number; hasOpeningBrace: boolean; hasSyntax: boolean } {
    let inString = false;
    let escaped = false;
    let delta = 0;
    let hasOpeningBrace = false;
    let hasSyntax = false;

    for (const char of line) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString && char === "\\") {
            escaped = true;
            continue;
        }

        if (char === "\"") {
            inString = !inString;
            continue;
        }

        if (!inString && char === "#") {
            break;
        }

        if (inString) {
            continue;
        }

        if (!/\s/.test(char)) {
            hasSyntax = true;
        }

        if (char === "{") {
            delta += 1;
            hasOpeningBrace = true;
        } else if (char === "}") {
            delta -= 1;
        }
    }

    return { delta, hasOpeningBrace, hasSyntax };
}

export function parseTopLevelObjects(content: string): ParsedTopLevelObjectsResult {
    const objects: ParsedTopLevelObject[] = [];
    const lines = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let activeKey: string | null = null;
    let activeLines: string[] = [];
    let depth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        const isIgnorable = trimmed === "" || trimmed.startsWith("#");

        if (!activeKey) {
            if (isIgnorable) {
                continue;
            }

            const match = line.match(/^\s*([A-Za-z0-9_.:@-]+)\s*=/);
            if (!match) {
                return {
                    ok: false,
                    objects: [],
                    error: `Unsupported top-level syntax near: ${trimmed.slice(0, 80)}`
                };
            }

            const scan = scanLine(line);
            if (!scan.hasOpeningBrace) {
                return {
                    ok: false,
                    objects: [],
                    error: `Top-level assignment "${match[1]}" is not a mergeable object block.`
                };
            }

            activeKey = match[1];
            activeLines = [line];
            depth = scan.delta;

            if (depth < 0) {
                return {
                    ok: false,
                    objects: [],
                    error: `Unexpected closing brace in "${activeKey}".`
                };
            }

            if (depth === 0) {
                objects.push({
                    key: activeKey,
                    text: activeLines.join("\n").trimEnd()
                });
                activeKey = null;
                activeLines = [];
            }
            continue;
        }

        activeLines.push(line);
        const scan = scanLine(line);
        depth += scan.delta;

        if (depth < 0) {
            return {
                ok: false,
                objects: [],
                error: `Unexpected closing brace in "${activeKey}".`
            };
        }

        if (depth === 0) {
            objects.push({
                key: activeKey,
                text: activeLines.join("\n").trimEnd()
            });
            activeKey = null;
            activeLines = [];
        }
    }

    if (activeKey || depth !== 0) {
        return {
            ok: false,
            objects: [],
            error: activeKey
                ? `Unclosed object block "${activeKey}".`
                : "Unclosed object block."
        };
    }

    if (objects.length <= 0) {
        return {
            ok: false,
            objects: [],
            error: "No mergeable top-level object blocks were found."
        };
    }

    return {
        ok: true,
        objects,
        error: null
    };
}

export function buildTopLevelObjectMerge(objects: ParsedTopLevelObject[]): string {
    return `${objects.map((object) => object.text.trimEnd()).join("\n\n")}\n`;
}
