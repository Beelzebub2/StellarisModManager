const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

function readCss() {
    return fs.readFileSync(stylesPath, "utf8");
}

function toMilliseconds(value, unit) {
    return Number(value) * (unit === "s" ? 1000 : 1);
}

function collectTimingViolations(css, propertyPattern, maxMs) {
    const lines = css.split(/\r?\n/);
    const violations = [];
    const declarationPattern = new RegExp(`\\b${propertyPattern}\\b[^;{}]*:\\s*([^;{}]+)`);
    const timePattern = /(\d*\.?\d+)\s*(ms|s)\b/g;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        const declaration = line.match(declarationPattern);
        if (!declaration || declaration[1].includes("infinite")) {
            continue;
        }

        let timeMatch;
        while ((timeMatch = timePattern.exec(declaration[1])) !== null) {
            const durationMs = toMilliseconds(timeMatch[1], timeMatch[2]);
            if (durationMs > maxMs) {
                violations.push(`line ${index + 1}: ${line}`);
            }
        }
    }

    return violations;
}

function collectInfiniteTimingViolations(css, maxMs) {
    const lines = css.split(/\r?\n/);
    const violations = [];
    const declarationPattern = /\banimation\b[^;{}]*:\s*([^;{}]+)/;
    const timePattern = /(\d*\.?\d+)\s*(ms|s)\b/g;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        const declaration = line.match(declarationPattern);
        if (!declaration || !declaration[1].includes("infinite")) {
            continue;
        }

        let timeMatch;
        while ((timeMatch = timePattern.exec(declaration[1])) !== null) {
            const durationMs = toMilliseconds(timeMatch[1], timeMatch[2]);
            if (durationMs > maxMs) {
                violations.push(`line ${index + 1}: ${line}`);
            }
        }
    }

    return violations;
}

function blockForSelector(css, selector) {
    const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`));
    assert.ok(match, `missing ${selector} block`);
    return match[1];
}

test("motion tokens stay fast enough that the app does not feel sluggish", () => {
    const css = readCss();

    assert.match(css, /--duration:\s*100ms;/);
    assert.match(css, /--dur-fast:\s*70ms;/);
    assert.match(css, /--dur-base:\s*120ms;/);
    assert.match(css, /--dur-slow:\s*180ms;/);
    assert.match(css, /--dur-xslow:\s*220ms;/);
    assert.doesNotMatch(css, /--ease-spring:\s*cubic-bezier\([^)]*1\.56/);
});

test("finite UI motion does not use slow explicit durations", () => {
    const css = readCss();

    const animationViolations = collectTimingViolations(css, "animation", 240);
    const transitionViolations = collectTimingViolations(css, "transition", 180);

    assert.deepEqual(animationViolations, []);
    assert.deepEqual(transitionViolations, []);
});

test("repeating feedback animation cycles stay brisk", () => {
    const css = readCss();

    assert.deepEqual(collectInfiniteTimingViolations(css, 1000), []);
});

test("ambient background stays static instead of continuously animating the full viewport", () => {
    const css = readCss();

    assert.doesNotMatch(blockForSelector(css, ".aurora-one"), /animation\s*:/);
    assert.doesNotMatch(blockForSelector(css, ".aurora-two"), /animation\s*:/);
});

test("library vote display updates immediately instead of feeling sluggish", () => {
    const css = readCss();
    const worksBar = blockForSelector(css, ".consensus-bar-works");
    const brokenBar = blockForSelector(css, ".consensus-bar-broken");
    const voteButton = blockForSelector(css, ".vote-btn");

    assert.match(worksBar, /transition:\s*none;/);
    assert.match(brokenBar, /transition:\s*none;/);
    assert.doesNotMatch(voteButton, /var\(--dur-base\)|var\(--dur-slow\)|\b1\d{2,}ms\b|\d+s\b/);
    assert.match(voteButton, /60ms/);
});
