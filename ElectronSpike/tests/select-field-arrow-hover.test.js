const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("field input hover styling preserves custom select arrows", () => {
    const css = fs.readFileSync(stylesPath, "utf8");
    const hoverRule = css.match(/\.field-input:hover:not\(:focus\)\s*\{([\s\S]*?)\}/);

    assert.ok(hoverRule, "expected field input hover rule");
    assert.match(css, /select\.field-input\s*\{[\s\S]*background-image:\s*url\(/);
    assert.match(hoverRule[1], /background-color:\s*var\(--bg-2\)/);
    assert.doesNotMatch(hoverRule[1], /(?:^|[\s;])background\s*:/);
});
