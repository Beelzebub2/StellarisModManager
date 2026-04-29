import {
    byId,
    escapeHtml,
    formatUtc,
    printJson,
    setText,
    toDisplayValue
} from "../runtime/dom.js";
import { showChoiceModal, showPrompt } from "../runtime/modal.js";
import {
    DEFAULT_STEAMCMD_CONCURRENCY,
    DEFAULT_STEAMWORKS_CONCURRENCY,
    clampSettingsConcurrency,
    getDefaultSettingsModel,
    getWorkshopRuntimeHint
} from "../runtime/settingsModel.js";
import { state } from "../runtime/state.js";
import { setSettingsStatus } from "../runtime/status.js";
import {
    applyThemePalette,
    buildThemePaletteOptionsMarkup
} from "../runtime/theme.js";
import { normalizeDetectedGameVersion } from "./versionBrowser.js";

export function createSettingsPageController({
    beginModsPathMigrationSave,
    didModsPathChange,
    promptForModsPathMigration,
    refreshVersionOptions,
    refreshVersionResults
}) {
    function setInputValue(id, v) {
        const el = byId(id);
        if (el && "value" in el) el.value = v ?? "";
    }

    function setCheckboxValue(id, v) {
        const el = byId(id);
        if (el && "checked" in el) el.checked = v === true;
    }

    function getInputValue(id) {
        const el = byId(id);
        return (!el || !("value" in el)) ? "" : String(el.value || "").trim();
    }

    function getCheckboxValue(id) {
        const el = byId(id);
        return (!el || !("checked" in el)) ? false : el.checked === true;
    }

    function getConcurrencyInputValue(id, fallback) {
        return clampSettingsConcurrency(getInputValue(id), fallback);
    }

    function isDeveloperModeEnabled() {
        return state.settingsModel?.developerMode === true || getCheckboxValue("settingsDeveloperModeInput") === true;
    }

    function markSettingsDirty(isDirty) {
        state.settingsDirty = isDirty;
        const chip = byId("settingsUnsavedChip");
        if (chip) chip.classList.toggle("hidden", !isDirty);
    }

    function buildSettingsFromForm() {
        return {
            gamePath: getInputValue("settingsGamePathInput"),
            launchOptions: getInputValue("settingsLaunchOptionsInput"),
            modsPath: getInputValue("settingsModsPathInput"),
            managedModsPath: getInputValue("settingsManagedModsPathInput"),
            steamCmdPath: getInputValue("settingsSteamCmdPathInput"),
            steamCmdDownloadPath: getInputValue("settingsSteamCmdDownloadPathInput"),
            workshopDownloadRuntime: getInputValue("settingsWorkshopRuntimeInput") || "Auto",
            steamworksMaxConcurrentDownloads: getConcurrencyInputValue(
                "settingsSteamworksConcurrencyInput",
                state.settingsModel?.steamworksMaxConcurrentDownloads ?? DEFAULT_STEAMWORKS_CONCURRENCY
            ),
            steamCmdMaxConcurrentDownloads: getConcurrencyInputValue(
                "settingsSteamCmdConcurrencyInput",
                state.settingsModel?.steamCmdMaxConcurrentDownloads ?? DEFAULT_STEAMCMD_CONCURRENCY
            ),
            lastDetectedGameVersion: state.settingsModel?.lastDetectedGameVersion || "",
            autoDetectGame: state.settingsModel?.autoDetectGame === true,
            developerMode: getCheckboxValue("settingsDeveloperModeInput"),
            warnBeforeRestartGame: getCheckboxValue("settingsWarnBeforeRestartInput"),
            themePalette: getInputValue("settingsThemeInput") || "Obsidian Ember",
            autoCheckAppUpdates: getCheckboxValue("settingsAutoUpdatesInput"),
            compatibilityReporterId: state.settingsModel?.compatibilityReporterId || "",
            lastAppUpdateCheckUtc: state.settingsModel?.lastAppUpdateCheckUtc || "",
            lastOfferedAppVersion: state.settingsModel?.lastOfferedAppVersion || "",
            skippedAppVersion: state.settingsModel?.skippedAppVersion || "",
            publicProfileUsername: getInputValue("settingsPublicProfileInput"),
            hideDisabledMods: state.library.showEnabledOnly === true
        };
    }

    function updateSettingsGameVersionChip(version) {
        const chip = byId("settingsGameVersionChip");
        if (!chip) return;

        const normalizedVersion = String(version || "").trim();
        chip.className = "status-chip " + (normalizedVersion ? "status-chip-success" : "status-chip-muted");
        chip.textContent = normalizedVersion ? `Version ${normalizedVersion}` : "Version not detected";
    }

    function applySettingsToForm(settings) {
        const m = { ...getDefaultSettingsModel(), ...(settings || {}) };
        state.settingsModel = m;

        state.library.showEnabledOnly = m.hideDisabledMods === true;
        const libraryEnabledOnly = byId("libraryEnabledOnly");
        if (libraryEnabledOnly) libraryEnabledOnly.checked = state.library.showEnabledOnly;

        setInputValue("settingsPublicProfileInput", m.publicProfileUsername);
        setInputValue("settingsGamePathInput", m.gamePath);
        setInputValue("settingsLaunchOptionsInput", m.launchOptions);
        setInputValue("settingsModsPathInput", m.modsPath);
        setInputValue("settingsManagedModsPathInput", m.managedModsPath);
        setInputValue("settingsSteamCmdPathInput", m.steamCmdPath);
        setInputValue("settingsSteamCmdDownloadPathInput", m.steamCmdDownloadPath);
        setInputValue("settingsThemeInput", m.themePalette || "Obsidian Ember");
        setInputValue("settingsWorkshopRuntimeInput", m.workshopDownloadRuntime || "Auto");
        setInputValue(
            "settingsSteamworksConcurrencyInput",
            clampSettingsConcurrency(m.steamworksMaxConcurrentDownloads, DEFAULT_STEAMWORKS_CONCURRENCY)
        );
        setInputValue(
            "settingsSteamCmdConcurrencyInput",
            clampSettingsConcurrency(m.steamCmdMaxConcurrentDownloads, DEFAULT_STEAMCMD_CONCURRENCY)
        );

        setCheckboxValue("settingsWarnBeforeRestartInput", m.warnBeforeRestartGame === true);
        setCheckboxValue("settingsDeveloperModeInput", m.developerMode === true);
        setCheckboxValue("settingsAutoUpdatesInput", m.autoCheckAppUpdates === true);

        setText("settingsGameVersionText", toDisplayValue(m.lastDetectedGameVersion));
        updateSettingsGameVersionChip(m.lastDetectedGameVersion);
        setText("settingsLastCheckUtcText", formatUtc(m.lastAppUpdateCheckUtc));
        setText("settingsLastOfferedVersionText", toDisplayValue(m.lastOfferedAppVersion));
        setText("settingsSkippedVersionText", toDisplayValue(m.skippedAppVersion));
        setText("settingsCurrentVersionText", byId("appVersionText")?.textContent || "--");

        const steamText = byId("settingsSteamCmdConfiguredText");
        if (steamText) {
            const configured = !!(m.steamCmdPath?.trim() && m.steamCmdDownloadPath?.trim());
            steamText.textContent = configured ? "Configured" : "Needs SteamCMD path";
            steamText.className = "steam-status-text settings-value " + (configured ? "steam-status-configured" : "steam-status-not-configured");
        }

        syncSettingsRuntimeVisibility();
        syncDeveloperDiagnosticsVisibility();
        applyThemePalette(m.themePalette || "Obsidian Ember");
        markSettingsDirty(false);
    }

    function syncSettingsRuntimeVisibility() {
        const runtime = getInputValue("settingsWorkshopRuntimeInput") || "Auto";
        const steamCmdPath = getInputValue("settingsSteamCmdPathInput");
        const steamCmdDownloadPath = getInputValue("settingsSteamCmdDownloadPathInput");
        const configured = steamCmdPath.length > 0 && steamCmdDownloadPath.length > 0;

        setText("settingsWorkshopRuntimeChip", `Runtime: ${runtime}`);
        setText("settingsRuntimeHint", getWorkshopRuntimeHint(runtime, steamCmdPath, steamCmdDownloadPath));

        const steamText = byId("settingsSteamCmdConfiguredText");
        if (steamText) {
            steamText.textContent = configured ? "Configured" : "Needs SteamCMD path";
            steamText.className = "steam-status-text settings-value " + (configured ? "steam-status-configured" : "steam-status-not-configured");
        }
    }

    function syncDeveloperDiagnosticsVisibility() {
        const showDiagnostics = getCheckboxValue("settingsDeveloperModeInput");
        const diagnosticsContent = byId("settingsDiagnosticsContent");
        if (diagnosticsContent) diagnosticsContent.classList.toggle("hidden", !showDiagnostics);

        const diagnosticsHint = byId("settingsDiagnosticsHint");
        if (diagnosticsHint) diagnosticsHint.classList.toggle("hidden", showDiagnostics);
    }

    function renderSettingsSubtabs() {
        for (const btn of document.querySelectorAll(".settings-subtab")) {
            btn.classList.toggle("is-active", btn.getAttribute("data-settings-tab") === state.settingsTab);
        }
        for (const tab of ["general", "workshop", "updates", "advanced"]) {
            const panel = byId(`settingsTab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`);
            if (panel) panel.classList.toggle("hidden", tab !== state.settingsTab);
        }
    }

    async function refreshSettingsPage() {
        try {
            const [summary, settings, dbSummary, palettes, runtimes] = await Promise.all([
                window.spikeApi.getSystemSummary(),
                window.spikeApi.getSettings(),
                window.spikeApi.getDbSummary(),
                window.spikeApi.getThemePaletteOptions(),
                window.spikeApi.getDownloadRuntimeOptions()
            ]);

            const paletteSelect = byId("settingsThemeInput");
            if (paletteSelect) paletteSelect.innerHTML = buildThemePaletteOptionsMarkup(palettes);

            const runtimeSelect = byId("settingsWorkshopRuntimeInput");
            if (runtimeSelect) runtimeSelect.innerHTML = runtimes.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");

            applySettingsToForm(settings || getDefaultSettingsModel());
            printJson("runtime", summary);
            printJson("db", dbSummary ?? { message: "No readable mods.db found" });
            setSettingsStatus("Settings loaded.");
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown settings error";
            setSettingsStatus(`Failed to load settings: ${msg}`);
        }
    }

    async function validateSettingsPage() {
        const current = buildSettingsFromForm();
        const result = await window.spikeApi.validateSettings(current);
        setSettingsStatus(result.ok
            ? (result.warnings.length > 0 ? result.warnings.join(" ") : result.message)
            : result.errors.join(" "));
    }

    async function saveSettingsPage() {
        const current = buildSettingsFromForm();

        try {
            if (didModsPathChange(current)) {
                const choice = await promptForModsPathMigration(current);
                if (choice === "cancel") {
                    setSettingsStatus("Managed mods folder change cancelled.");
                    return false;
                }

                return beginModsPathMigrationSave(current, choice === "confirm");
            }

            const result = await window.spikeApi.saveSettings(current);
            if (!result.ok) {
                setSettingsStatus(result.message);
                return false;
            }

            applySettingsToForm(result.settings);
            setSettingsStatus(result.message);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown settings save error";
            setSettingsStatus(`Failed to save settings: ${message}`);
            return false;
        }
    }

    async function autoDetectSettingsPage() {
        const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
        applySettingsToForm(result.settings);
        markSettingsDirty(true);
        setSettingsStatus(result.message);
    }

    async function detectAndApplyGameVersion(gamePath) {
        if (!gamePath) return;
        try {
            const version = await window.spikeApi.detectGameVersion(gamePath);
            if (!version) return;

            setText("settingsGameVersionText", version);
            updateSettingsGameVersionChip(version);

            if (state.settingsModel) {
                state.settingsModel.lastDetectedGameVersion = version;
            }

            const normalized = normalizeDetectedGameVersion(version);
            if (normalized && normalized !== state.selectedVersion) {
                state.selectedVersion = normalized;
                state.page = 1;
                await refreshVersionOptions();
                await refreshVersionResults();
                setSettingsStatus(`Detected game version ${version}; version browser updated to ${normalized}.`);
            } else if (version) {
                setSettingsStatus(`Detected game version ${version}.`);
            }
        } catch {
            // Non-fatal: version stays whatever it was.
        }
    }

    async function detectModsPathSettings() {
        const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
        const detectedModsPath = String(result?.settings?.modsPath || "").trim();
        if (!detectedModsPath) {
            setSettingsStatus("Could not detect the Stellaris descriptor folder.");
            return;
        }

        setInputValue("settingsModsPathInput", detectedModsPath);
        if (!getInputValue("settingsManagedModsPathInput")) {
            setInputValue("settingsManagedModsPathInput", detectedModsPath);
        }
        markSettingsDirty(true);
        setSettingsStatus(`Detected descriptor folder: ${detectedModsPath}`);
    }

    async function detectWorkshopRuntimeSettings() {
        const result = await window.spikeApi.autoDetectSettings(buildSettingsFromForm());
        const detectedRuntime = String(result?.settings?.workshopDownloadRuntime || "").trim();
        if (!detectedRuntime) {
            setSettingsStatus("Could not detect a workshop download runtime.");
            return;
        }

        setInputValue("settingsWorkshopRuntimeInput", detectedRuntime);
        syncSettingsRuntimeVisibility();
        markSettingsDirty(true);
        setSettingsStatus(`Detected workshop runtime: ${detectedRuntime}`);
    }

    async function autoConfigureSteamCmdSettings() {
        const button = byId("settingsAutoConfigureSteamCmd");
        if (button) {
            button.disabled = true;
        }

        setSettingsStatus("Configuring SteamCMD. This may download and extract the runtime...");

        try {
            const result = await window.spikeApi.autoConfigureSteamCmd(buildSettingsFromForm());
            const detectedSteamCmdPath = String(result?.settings?.steamCmdPath || "").trim();
            const detectedSteamCmdDownloadPath = String(result?.settings?.steamCmdDownloadPath || "").trim();

            if (!result?.ok || !detectedSteamCmdPath || !detectedSteamCmdDownloadPath) {
                setSettingsStatus(String(result?.message || "Could not auto-configure SteamCMD."));
                return;
            }

            if (detectedSteamCmdPath) setInputValue("settingsSteamCmdPathInput", detectedSteamCmdPath);
            if (detectedSteamCmdDownloadPath) setInputValue("settingsSteamCmdDownloadPathInput", detectedSteamCmdDownloadPath);

            const detectedRuntime = String(result?.settings?.workshopDownloadRuntime || "").trim();
            if (detectedRuntime) setInputValue("settingsWorkshopRuntimeInput", detectedRuntime);

            syncSettingsRuntimeVisibility();
            markSettingsDirty(true);
            setSettingsStatus(String(result?.message || "SteamCMD auto-configuration applied. Review and save settings."));
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    async function ensurePublicUsernameConfigured(forcePrompt = false) {
        const configuredUsername = String(state.settingsModel?.publicProfileUsername || "").trim();
        if (configuredUsername) {
            state.usernamePromptShown = true;
            return true;
        }

        if (state.usernamePromptShown && !forcePrompt) {
            return false;
        }

        state.usernamePromptShown = true;

        const enteredUsername = await showPrompt(
            "Configure Public Username",
            "A public username is required for profile sharing and community reporting. Enter one now:",
            ""
        );

        if (enteredUsername === null) {
            setSettingsStatus("Public username is not configured yet.");
            return false;
        }

        const normalizedUsername = enteredUsername.trim();
        if (!normalizedUsername) {
            setSettingsStatus("Public username is required. You can set it in Settings > General.");
            return false;
        }

        setInputValue("settingsPublicProfileInput", normalizedUsername);
        markSettingsDirty(true);
        if (!await saveSettingsPage()) {
            return false;
        }
        setSettingsStatus("Public username configured.");
        return true;
    }

    async function resolveUnsavedSettingsBeforeLeave(options = {}) {
        if (!(state.selectedTab === "settings" && state.settingsDirty)) {
            return true;
        }

        const choice = await showChoiceModal(
            "Unsaved settings changes",
            "You made changes in Settings that are not saved. Save changes before leaving?",
            {
                confirmLabel: "Save changes",
                alternateLabel: "Discard changes",
                cancelLabel: "Cancel"
            }
        );

        if (choice === "cancel") {
            setSettingsStatus("Unsaved settings kept open.");
            return false;
        }

        if (choice === "confirm") {
            const saved = await saveSettingsPage();
            if (!saved) {
                setSettingsStatus("Could not save settings. Fix the issue before leaving this page.");
                return false;
            }
            return true;
        }

        applySettingsToForm(state.settingsModel || getDefaultSettingsModel());
        setSettingsStatus(options.reason === "exit"
            ? "Discarded unsaved settings changes. Closing app."
            : "Discarded unsaved settings changes.");
        return true;
    }

    async function handleWindowCloseWithUnsavedSettings() {
        if (state.windowClosePromptActive) {
            return;
        }

        state.windowClosePromptActive = true;
        try {
            const canClose = await resolveUnsavedSettingsBeforeLeave({ reason: "exit" });
            if (!canClose) {
                return;
            }

            state.windowCloseAllowed = true;
            window.close();
        } finally {
            if (!state.windowCloseAllowed) {
                state.windowClosePromptActive = false;
            }
        }
    }

    return {
        applySettingsToForm,
        autoConfigureSteamCmdSettings,
        autoDetectSettingsPage,
        detectAndApplyGameVersion,
        detectModsPathSettings,
        detectWorkshopRuntimeSettings,
        getCheckboxValue,
        getInputValue,
        handleWindowCloseWithUnsavedSettings,
        ensurePublicUsernameConfigured,
        isDeveloperModeEnabled,
        markSettingsDirty,
        refreshSettingsPage,
        renderSettingsSubtabs,
        resolveUnsavedSettingsBeforeLeave,
        saveSettingsPage,
        setInputValue,
        syncDeveloperDiagnosticsVisibility,
        syncSettingsRuntimeVisibility,
        validateSettingsPage
    };
}
