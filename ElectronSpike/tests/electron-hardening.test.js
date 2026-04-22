const test = require("node:test");
const assert = require("node:assert/strict");

const security = require("../dist/main/security.js");

test("main window preferences keep the renderer sandboxed", () => {
    assert.equal(typeof security.buildMainWindowWebPreferencesForTest, "function");

    assert.deepEqual(
        security.buildMainWindowWebPreferencesForTest("C:/app/dist/preload.js"),
        {
            preload: "C:/app/dist/preload.js",
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            webviewTag: true
        }
    );
});

test("webview attachment clamps dangerous preferences", () => {
    assert.equal(typeof security.applyWebviewSecurityForTest, "function");

    const webPreferences = {
        nodeIntegration: true,
        sandbox: false,
        contextIsolation: false,
        webSecurity: false,
        allowRunningInsecureContent: true
    };

    security.applyWebviewSecurityForTest(webPreferences, "C:/app/dist/webviewPreload.js");

    assert.deepEqual(webPreferences, {
        preload: "C:/app/dist/webviewPreload.js",
        nodeIntegration: false,
        sandbox: true,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false
    });
});

test("external navigation only allows http and https urls", () => {
    assert.equal(typeof security.normalizeSafeExternalUrlForTest, "function");

    assert.equal(
        security.normalizeSafeExternalUrlForTest(" https://steamcommunity.com/sharedfiles/filedetails/?id=123456 "),
        "https://steamcommunity.com/sharedfiles/filedetails/?id=123456"
    );
    assert.equal(security.normalizeSafeExternalUrlForTest("javascript:alert(1)"), null);
    assert.equal(security.normalizeSafeExternalUrlForTest("file:///C:/Windows/System32/calc.exe"), null);
    assert.equal(security.normalizeSafeExternalUrlForTest("steam://run/281990"), null);
});

test("only exact steam hosts stay inside the workshop webview", () => {
    assert.equal(typeof security.shouldStayInWorkshopWebviewForTest, "function");

    assert.equal(
        security.shouldStayInWorkshopWebviewForTest("https://steamcommunity.com/sharedfiles/filedetails/?id=123456"),
        true
    );
    assert.equal(
        security.shouldStayInWorkshopWebviewForTest("https://store.steampowered.com/app/281990/Stellaris/"),
        true
    );
    assert.equal(
        security.shouldStayInWorkshopWebviewForTest("https://steamcommunity.com.evil.example/sharedfiles/filedetails/?id=123456"),
        false
    );
    assert.equal(
        security.shouldStayInWorkshopWebviewForTest("https://evil.example/?next=steamcommunity.com"),
        false
    );
});
