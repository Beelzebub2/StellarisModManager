const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    readRendererRuntimeSource,
    rendererFeaturesRoot,
    rendererEntryPath,
    rendererRuntimeRoot
} = require("./helpers/renderer-runtime-source");

test("renderer runtime is split into focused modules loaded by the bootstrap entry", () => {
    const rendererEntry = fs.readFileSync(rendererEntryPath, "utf8");
    const runtimeSource = readRendererRuntimeSource();
    const rendererEntryLineCount = rendererEntry.split(/\r?\n/).length;

    assert.match(rendererEntry, /from "\.\/features\/rendererComposition\.js"/);
    assert.ok(rendererEntryLineCount <= 20, `renderer.js should stay a thin entry point, got ${rendererEntryLineCount} lines`);

    for (const moduleName of ["state", "dom", "modal", "theme", "icons", "status", "windowUi", "workshopInput", "versionLoading", "appShell", "settingsModel", "queueFormatting"]) {
        const modulePath = path.join(rendererRuntimeRoot, `${moduleName}.js`);
        assert.ok(fs.existsSync(modulePath), `${moduleName}.js should exist`);
        assert.match(runtimeSource, new RegExp(`from "\\.\\./runtime/${moduleName}\\.js"|from "\\./runtime/${moduleName}\\.js"`));
    }

    for (const moduleName of ["appUpdates", "gameLaunch", "detailDrawer", "globalControls", "tabNavigation", "versionControls", "settingsControls", "modsPathMigration", "mergerProgress", "mergerWorkspace", "downloadQueue", "downloadFailureNotice", "workshopView", "settingsPage", "libraryWorkspace", "versionBrowser", "appStartup", "rendererComposition"]) {
        const modulePath = path.join(rendererFeaturesRoot, `${moduleName}.js`);
        assert.ok(fs.existsSync(modulePath), `${moduleName}.js should exist`);
        assert.match(runtimeSource, new RegExp(`from "\\./${moduleName}\\.js"|from "\\./features/${moduleName}\\.js"`));
    }

    assert.match(runtimeSource, /export const state = \{/);
    assert.match(runtimeSource, /export function byId/);
    assert.match(runtimeSource, /export function showChoiceModal/);
    assert.match(runtimeSource, /export function applyThemePalette/);
    assert.match(runtimeSource, /export function iconSvg/);
    assert.match(runtimeSource, /export function setGlobalStatus/);
    assert.match(runtimeSource, /export function hookCustomTooltips/);
    assert.match(runtimeSource, /export function normalizeWorkshopId/);
    assert.match(runtimeSource, /export function renderVersionLoadingSkeletons/);
    assert.match(runtimeSource, /export async function applyAppIcon/);
    assert.match(runtimeSource, /export function getDefaultSettingsModel/);
    assert.match(runtimeSource, /export function buildQueueMessageForDisplay/);
    assert.match(runtimeSource, /export function hookAppUpdateControls/);
    assert.match(runtimeSource, /export async function handleLaunchGame/);
    assert.match(runtimeSource, /export function createDetailDrawerController/);
    assert.match(runtimeSource, /export function createGlobalControlsController/);
    assert.match(runtimeSource, /export function createTabNavigationController/);
    assert.match(runtimeSource, /export function createVersionControlsController/);
    assert.match(runtimeSource, /export function createSettingsControlsController/);
    assert.match(runtimeSource, /export function createSettingsPageController/);
    assert.match(runtimeSource, /export function createDownloadQueueController/);
    assert.match(runtimeSource, /export function createDownloadFailureNoticeController/);
    assert.match(runtimeSource, /export function createWorkshopController/);
    assert.match(runtimeSource, /export function createLibraryWorkspaceController/);
    assert.match(runtimeSource, /export function createMergerWorkspaceController/);
    assert.match(runtimeSource, /export function createVersionBrowserController/);
    assert.match(runtimeSource, /export function createAppStartupController/);
    assert.match(runtimeSource, /export function createRendererApp/);
});
