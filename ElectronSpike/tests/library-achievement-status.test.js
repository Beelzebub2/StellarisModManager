const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const library = require("../dist/main/services/library.js");

const rendererJsPath = path.join(__dirname, "..", "src", "renderer", "renderer.js");
const stylesCssPath = path.join(__dirname, "..", "src", "renderer", "styles.css");

test("library service evaluates achievement compatibility using checksum-folder content", () => {
    assert.equal(typeof library.resolveLibraryAchievementStatusForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-achievement-status-"));
    const compatibleModPath = path.join(tempRoot, "compatible-mod");
    const incompatibleModPath = path.join(tempRoot, "incompatible-mod");
    const missingModPath = path.join(tempRoot, "missing-mod");

    fs.mkdirSync(path.join(compatibleModPath, "gfx"), { recursive: true });
    fs.writeFileSync(path.join(compatibleModPath, "gfx", "icons.dds"), "gfx", "utf8");

    fs.mkdirSync(path.join(incompatibleModPath, "events"), { recursive: true });
    fs.writeFileSync(path.join(incompatibleModPath, "events", "game_start.txt"), "event", "utf8");

    try {
        assert.equal(
            library.resolveLibraryAchievementStatusForTest(compatibleModPath),
            "compatible"
        );
        assert.equal(
            library.resolveLibraryAchievementStatusForTest(incompatibleModPath),
            "not-compatible"
        );
        assert.equal(
            library.resolveLibraryAchievementStatusForTest(missingModPath),
            "unknown"
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("library rows render an achievement compatibility indicator", () => {
    const renderer = fs.readFileSync(rendererJsPath, "utf8");
    const styles = fs.readFileSync(stylesCssPath, "utf8");

    assert.match(renderer, /mod\.achievementStatus/);
    assert.match(renderer, /library-achievement-indicator/);
    assert.match(renderer, /Achievement compatible/);
    assert.match(renderer, /Disables achievements/);
    assert.match(styles, /\.library-achievement-indicator/);
});

test("restart warning is skipped when the setting is disabled", () => {
    const renderer = fs.readFileSync(rendererJsPath, "utf8");

    assert.match(renderer, /warnBeforeRestartGame/);
    assert.match(renderer, /state\.settingsModel\?\.warnBeforeRestartGame\s*!==\s*false/);
    assert.match(renderer, /showModal\(\s*"Stellaris is running"/);
});
