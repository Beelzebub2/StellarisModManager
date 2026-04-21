const test = require("node:test");
const assert = require("node:assert/strict");

const windowChrome = require("../dist/main/windowChrome.js");

test("light palettes use a light titlebar overlay with dark symbols", () => {
    assert.equal(typeof windowChrome.getTitleBarOverlayOptionsForTheme, "function");

    assert.deepEqual(
        windowChrome.getTitleBarOverlayOptionsForTheme("Starlight White"),
        {
            color: "#eef4fb",
            symbolColor: "#0f172a",
            height: 54
        }
    );
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
