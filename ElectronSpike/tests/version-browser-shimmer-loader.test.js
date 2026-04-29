const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererRuntimeSource } = require("./helpers/renderer-runtime-source");

const stylesPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("version browser supports delayed shimmer skeletons and clears them on completion or error", () => {
    const js = readRendererRuntimeSource();
    const css = fs.readFileSync(stylesPath, "utf8");

    assert.match(js, /versionLoadingDelayHandle:/);
    assert.match(js, /versionSkeletonVisible:/);
    assert.match(js, /function renderVersionLoadingSkeletons\(/);
    assert.match(js, /setTimeout\(\(\)\s*=>\s*\{[\s\S]*renderVersionLoadingSkeletons\(\)/);
    assert.match(js, /renderVersionFeedbackCard\("Version browser failed"/);

    assert.match(css, /\.mod-card-skeleton\s*\{/);
    assert.match(css, /\.version-skeleton-title\s*\{/);
    assert.match(css, /\.version-skeleton-action\s*\{/);
});
