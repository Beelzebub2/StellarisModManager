const test = require("node:test");
const assert = require("node:assert/strict");

const windowChrome = require("../dist/main/windowChrome.js");

test("former light palettes use dark titlebar glass with light symbols", () => {
    assert.equal(typeof windowChrome.getTitleBarOverlayOptionsForTheme, "function");

    for (const themeName of ["Starlight White", "Ivory White", "Frost White"]) {
        const options = windowChrome.getTitleBarOverlayOptionsForTheme(themeName);
        assert.match(options.color, /^#0[0-9a-f]{5}$/i);
        assert.equal(options.symbolColor, "#e8ecfb");
        assert.equal(options.height, 54);
    }
});

test("dark palettes use a dark titlebar overlay with light symbols", () => {
    assert.equal(typeof windowChrome.getTitleBarOverlayOptionsForTheme, "function");

    assert.deepEqual(
        windowChrome.getTitleBarOverlayOptionsForTheme("Nocturne Slate"),
        {
            color: "#141b2c",
            symbolColor: "#e8ecfb",
            height: 54
        }
    );
});
