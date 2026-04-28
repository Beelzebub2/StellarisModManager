const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readRendererShellSource } = require("./helpers/renderer-shell-source");

const root = path.join(__dirname, "..");
const rendererComponentsRoot = path.join(root, "src", "renderer", "components");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");

test("renderer is built with Vite, React, and TypeScript", () => {
    assert.match(packageJson.scripts.build, /build:main/);
    assert.match(packageJson.scripts.build, /build:renderer/);
    assert.match(packageJson.scripts.check, /check:main/);
    assert.match(packageJson.scripts.check, /check:renderer/);
    assert.ok(packageJson.dependencies.react);
    assert.ok(packageJson.dependencies["react-dom"]);
    assert.ok(packageJson.devDependencies.vite);
    assert.ok(packageJson.devDependencies["@vitejs/plugin-react"]);
    assert.ok(packageJson.devDependencies["@types/react"]);
    assert.ok(packageJson.devDependencies["@types/react-dom"]);
});

test("renderer html enters through a React TypeScript module", () => {
    assert.match(indexHtml, /id="reactRuntimeRoot"/);
    assert.match(indexHtml, /type="module"\s+src="\.\/main\.tsx"/);

    const mainTsx = fs.readFileSync(path.join(root, "src", "renderer", "main.tsx"), "utf8");
    assert.match(mainTsx, /react-dom\/client/);
    assert.match(mainTsx, /createRoot/);
    assert.match(mainTsx, /RendererShell/);
    assert.match(mainTsx, /import\("\.\/renderer\.js"\)/);
});

test("static renderer shell markup is owned by React instead of index.html", () => {
    assert.doesNotMatch(indexHtml, /class="window-shell"/);
    assert.doesNotMatch(indexHtml, /id="pageVersion"/);
    assert.doesNotMatch(indexHtml, /id="modalOverlay"/);
    assert.doesNotMatch(indexHtml, /id="appTooltip"/);

    const shellSource = readRendererShellSource();
    assert.match(shellSource, /function RendererShell/);
    assert.match(shellSource, /function VersionBrowserPage/);
    assert.match(shellSource, /class(Name)?="window-shell"/);
    assert.match(shellSource, /id="pageVersion"/);
    assert.match(shellSource, /id="modalOverlay"/);
    assert.match(shellSource, /id="appTooltip"/);
});

test("primary renderer pages are split into named React components", () => {
    const rendererShell = fs.readFileSync(path.join(rendererComponentsRoot, "RendererShell.tsx"), "utf8");
    const expectedPages = [
        ["VersionBrowserPage.tsx", "VersionBrowserPage", "pageVersion"],
        ["LibraryPage.tsx", "LibraryPage", "pageLibrary"],
        ["MergerPage.tsx", "MergerPage", "pageMerger"],
        ["DownloadsPage.tsx", "DownloadsPage", "pageDownloads"],
        ["WorkshopPage.tsx", "WorkshopPage", "pageWorkshop"],
        ["SettingsPage.tsx", "SettingsPage", "pageSettings"],
        ["MergerResultsWorkspace.tsx", "MergerResultsWorkspace", "mergerResultsWorkspace"]
    ];

    for (const [filename, componentName, rootId] of expectedPages) {
        const source = fs.readFileSync(path.join(rendererComponentsRoot, filename), "utf8");
        assert.match(source, new RegExp(`function ${componentName}`));
        assert.match(source, new RegExp(`id="${rootId}"`));
        assert.match(rendererShell, new RegExp(componentName));
        assert.match(rendererShell, new RegExp(`<${componentName} />`));
        assert.doesNotMatch(rendererShell, new RegExp(`<section id="${rootId}"`));
        assert.doesNotMatch(rendererShell, new RegExp(`${rootId}ReactMount`));
    }
});

test("renderer shell is composed from React components without raw HTML injection", () => {
    const rendererShell = fs.readFileSync(path.join(rendererComponentsRoot, "RendererShell.tsx"), "utf8");
    const shellComponents = [
        "Topbar",
        "UpdatePopup",
        "GlobalNotices",
        "Sidebar",
        "Statusbar",
        "DetailDrawer",
        "ModalSystem",
        "AppTooltip"
    ];

    assert.doesNotMatch(rendererShell, /String\.raw/);
    assert.doesNotMatch(rendererShell, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(rendererShell, /createPortal/);
    assert.doesNotMatch(rendererShell, /ReactMount/);

    for (const componentName of shellComponents) {
        const source = fs.readFileSync(path.join(rendererComponentsRoot, `${componentName}.tsx`), "utf8");
        assert.match(source, new RegExp(`function ${componentName}`));
        assert.match(rendererShell, new RegExp(`<${componentName} />`));
    }
});

test("Electron can load Vite dev server and packaged renderer output", () => {
    const mainSource = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
    assert.match(mainSource, /VITE_DEV_SERVER_URL/);
    assert.match(mainSource, /loadURL\(devServerUrl\)/);
    assert.match(mainSource, /dist",\s*"renderer",\s*"index\.html"/);
});
