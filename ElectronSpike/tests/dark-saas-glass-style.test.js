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

test("all palette variants stay in the dark glass design system", () => {
    const css = fs.readFileSync(stylesPath, "utf8");
    const themeNames = [
        "graphite-moss",
        "nocturne-slate",
        "starlight-white",
        "ivory-white",
        "frost-white"
    ];

    for (const themeName of themeNames) {
        const block = css.match(new RegExp(`body\\[data-theme="${themeName}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
        assert.ok(block, `missing ${themeName} theme block`);
        assert.match(block[1], /--bg-base:\s*#0[0-9a-f]{5};/i, `${themeName} should keep a near-black base`);
        assert.match(block[1], /--bg-1:\s*rgba\(/, `${themeName} should use translucent app surfaces`);
        assert.match(block[1], /--surface-glass:\s*rgba\(/, `${themeName} should define a glass surface`);
        assert.match(block[1], /--accent-secondary:/, `${themeName} should include a sci-fi secondary accent`);
        assert.match(block[1], /--titlebar-surface:\s*rgba\(/, `${themeName} should keep titlebar glass dark`);
    }

    assert.doesNotMatch(css, /background:\s*linear-gradient\(135deg,\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/);
});

test("theme selector presents every palette as a dark glass variant", () => {
    const rendererPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
    const source = fs.readFileSync(rendererPath, "utf8");

    assert.doesNotMatch(source, /LIGHT_THEME_PALETTES/);
    assert.doesNotMatch(source, /Light Themes/);
    assert.match(source, /Dark Glass Themes/);
});
