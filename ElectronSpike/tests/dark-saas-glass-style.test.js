const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("default theme uses polished dark SaaS glass and sci-fi accent tokens", () => {
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(css, /--bg-base:\s*#070a12;/);
    assert.match(css, /--surface-glass:/);
    assert.match(css, /--accent:\s*#5eead4;/);
    assert.match(css, /--accent-secondary:\s*#8b5cf6;/);
    assert.match(css, /\.window-shell::before/);
    assert.match(css, /\.panel\s*\{[\s\S]*linear-gradient\(145deg/);
    assert.match(css, /\.modal-extra-load-order/);
});
