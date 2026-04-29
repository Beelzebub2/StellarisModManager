const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("merger workflow exposes dedicated progress rendering and layout fallbacks", () => {
    const rendererJs = readRendererRuntimeSource();
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(rendererJs, /showMergerProgressModal/);
    assert.match(rendererJs, /renderMergerProgressNotice/);
    assert.match(rendererJs, /getModMergerProgressStatus/);

    assert.match(css, /\.merger-progress-shell\s*\{/);
    assert.match(css, /\.merger-progress-notice\s*\{/);
    assert.match(css, /\.merger-progress-notice\s*\{[\s\S]*top:\s*calc\(env\(titlebar-area-height,\s*54px\)\s*\+\s*16px\);/);
    assert.match(css, /#modsPathMigrationNotice:not\(\.hidden\)\s*~\s*#mergerProgressNotice:not\(\.hidden\)\s*\{[\s\S]*top:\s*calc\(env\(titlebar-area-height,\s*54px\)\s*\+\s*88px\);/);
    assert.match(css, /@media\s*\(max-width:\s*1400px\)[\s\S]*\.merger-main[\s\S]*grid-template-columns:\s*1fr;/);
});
