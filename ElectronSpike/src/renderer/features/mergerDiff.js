import { escapeHtml } from "../runtime/dom.js";

const MAX_LCS_CELLS = 160000;
const MAX_RENDERED_DIFF_LINES = 1200;

function splitDiffLines(value) {
    const normalized = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalized.length > 0 ? normalized.split("\n") : [];
}

function createFallbackDiff(beforeLines, afterLines) {
    const rows = [];
    const maxLength = Math.max(beforeLines.length, afterLines.length);

    for (let index = 0; index < maxLength; index += 1) {
        const beforeLine = beforeLines[index];
        const afterLine = afterLines[index];
        const oldLine = index < beforeLines.length ? index + 1 : null;
        const newLine = index < afterLines.length ? index + 1 : null;

        if (beforeLine === afterLine && beforeLine !== undefined) {
            rows.push({ type: "context", oldLine, newLine, text: beforeLine });
            continue;
        }

        if (beforeLine !== undefined) {
            rows.push({ type: "remove", oldLine, newLine: null, text: beforeLine });
        }

        if (afterLine !== undefined) {
            rows.push({ type: "add", oldLine: null, newLine, text: afterLine });
        }
    }

    return rows;
}

function limitDiffRows(rows) {
    if (rows.length <= MAX_RENDERED_DIFF_LINES) {
        return rows;
    }

    return [
        ...rows.slice(0, MAX_RENDERED_DIFF_LINES),
        {
            type: "context",
            oldLine: null,
            newLine: null,
            text: "Diff truncated to keep the preview responsive."
        }
    ];
}

export function buildMergerDiffLines(beforeContent, afterContent) {
    const beforeLines = splitDiffLines(beforeContent);
    const afterLines = splitDiffLines(afterContent);

    if (beforeLines.length === 0 && afterLines.length === 0) {
        return [];
    }

    const cellCount = beforeLines.length * afterLines.length;
    if (cellCount > MAX_LCS_CELLS) {
        return limitDiffRows(createFallbackDiff(beforeLines, afterLines));
    }

    const table = Array.from(
        { length: beforeLines.length + 1 },
        () => new Uint16Array(afterLines.length + 1)
    );

    for (let oldIndex = beforeLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = afterLines.length - 1; newIndex >= 0; newIndex -= 1) {
            table[oldIndex][newIndex] = beforeLines[oldIndex] === afterLines[newIndex]
                ? table[oldIndex + 1][newIndex + 1] + 1
                : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
        }
    }

    const rows = [];
    let oldIndex = 0;
    let newIndex = 0;
    let oldLineNumber = 1;
    let newLineNumber = 1;

    while (oldIndex < beforeLines.length || newIndex < afterLines.length) {
        if (
            oldIndex < beforeLines.length
            && newIndex < afterLines.length
            && beforeLines[oldIndex] === afterLines[newIndex]
        ) {
            rows.push({
                type: "context",
                oldLine: oldLineNumber,
                newLine: newLineNumber,
                text: beforeLines[oldIndex]
            });
            oldIndex += 1;
            newIndex += 1;
            oldLineNumber += 1;
            newLineNumber += 1;
            continue;
        }

        if (
            oldIndex < beforeLines.length
            && (
                newIndex >= afterLines.length
                || table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]
            )
        ) {
            rows.push({
                type: "remove",
                oldLine: oldLineNumber,
                newLine: null,
                text: beforeLines[oldIndex]
            });
            oldIndex += 1;
            oldLineNumber += 1;
            continue;
        }

        rows.push({
            type: "add",
            oldLine: null,
            newLine: newLineNumber,
            text: afterLines[newIndex]
        });
        newIndex += 1;
        newLineNumber += 1;
    }

    return limitDiffRows(rows);
}

function formatDiffLineNumber(value) {
    return value === null || value === undefined ? "" : String(value);
}

export function renderMergerDiffViewer(beforeContent, afterContent, fallbackMessage = "No generated output is available for this file.") {
    const rows = buildMergerDiffLines(beforeContent, afterContent);

    if (rows.length === 0) {
        return `<div class="merger-code-viewer is-empty">${escapeHtml(fallbackMessage)}</div>`;
    }

    const lineClassByType = {
        add: "merger-diff-line merger-diff-line-add",
        remove: "merger-diff-line merger-diff-line-remove",
        context: "merger-diff-line merger-diff-line-context"
    };
    const markerByType = {
        add: "+",
        remove: "-",
        context: " "
    };

    return `
        <div class="merger-code-viewer merger-diff-viewer" aria-label="Generated output diff">
            <div class="merger-diff-legend" aria-hidden="true">
                <span class="merger-diff-legend-add">+ additions</span>
                <span class="merger-diff-legend-remove">- removals</span>
                <span class="merger-diff-legend-context">context</span>
            </div>
            <div class="merger-diff-table" role="table">
                ${rows.map((line) => `
                <div class="${lineClassByType[line.type] || lineClassByType.context}" data-diff-type="${line.type}" role="row">
                    <span class="merger-diff-gutter" aria-label="Original line">${escapeHtml(formatDiffLineNumber(line.oldLine))}</span>
                    <span class="merger-diff-gutter" aria-label="Output line">${escapeHtml(formatDiffLineNumber(line.newLine))}</span>
                    <span class="merger-diff-marker" aria-hidden="true">${escapeHtml(markerByType[line.type] || " ")}</span>
                    <span class="merger-diff-text">${line.text.length > 0 ? escapeHtml(line.text) : " "}</span>
                </div>
                `).join("")}
            </div>
        </div>
    `;
}
