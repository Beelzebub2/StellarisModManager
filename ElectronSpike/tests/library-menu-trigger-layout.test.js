const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("library menu triggers clip and reserve caret space so hover states do not spill the arrow outside the trigger", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.library-menu-trigger\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(css, /\.library-menu-caret\s*\{[\s\S]*flex:\s*0 0 12px;/);
    assert.match(css, /\.library-menu-caret\s*\{[\s\S]*width:\s*12px;/);
    assert.match(css, /\.library-menu-caret\s*\{[\s\S]*height:\s*12px;/);
});
