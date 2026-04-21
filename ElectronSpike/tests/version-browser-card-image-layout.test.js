const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("version browser card thumbnails size themselves without spilling into the content column", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /\.mod-thumb\s*\{[\s\S]*box-sizing:\s*border-box;/);
    assert.match(css, /\.mod-thumb img\s*\{[\s\S]*max-width:\s*100%;/);
    assert.match(css, /\.mod-thumb img\s*\{[\s\S]*max-height:\s*100%;/);
});
