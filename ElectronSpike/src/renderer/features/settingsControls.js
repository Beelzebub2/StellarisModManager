import { byId } from "../runtime/dom.js";
import { showModal } from "../runtime/modal.js";
import { state } from "../runtime/state.js";
import { applyThemePalette } from "../runtime/theme.js";

export function createSettingsControlsController({
    autoConfigureSteamCmdSettings,
    detectAndApplyGameVersion,
    detectModsPathSettings,
    detectWorkshopRuntimeSettings,
    getInputValue,
    markSettingsDirty,
    refreshSettingsPage,
    renderSettingsSubtabs,
    saveSettingsPage,
    setInputValue,
    syncDeveloperDiagnosticsVisibility,
    syncSettingsRuntimeVisibility,
    validateSettingsPage
}) {
    function hookSettingsControls() {
        byId("refreshSettings")?.addEventListener("click", async () => {
            if (state.settingsDirty) {
                const proceed = await showModal(
                    "Unsaved settings changes",
                    "Refreshing will discard your unsaved settings changes. Continue?",
                    "Refresh anyway",
                    "Cancel"
                );
                if (!proceed) return;
            }
            await refreshSettingsPage();
        });
        byId("validateSettings")?.addEventListener("click", () => void validateSettingsPage());
        byId("saveSettings")?.addEventListener("click", () => void saveSettingsPage());

        for (const btn of document.querySelectorAll(".settings-subtab")) {
            btn.addEventListener("click", () => {
                state.settingsTab = btn.getAttribute("data-settings-tab") || "general";
                renderSettingsSubtabs();
            });
        }

        const dirtyInputs = [
            "settingsPublicProfileInput", "settingsGamePathInput", "settingsLaunchOptionsInput",
            "settingsModsPathInput", "settingsManagedModsPathInput",
            "settingsSteamCmdPathInput", "settingsSteamCmdDownloadPathInput",
            "settingsWorkshopRuntimeInput", "settingsSteamworksConcurrencyInput",
            "settingsSteamCmdConcurrencyInput", "settingsThemeInput"
        ];
        for (const id of dirtyInputs) {
            byId(id)?.addEventListener("input", () => {
                markSettingsDirty(true);
                if (id === "settingsWorkshopRuntimeInput") syncSettingsRuntimeVisibility();
                if (id === "settingsThemeInput") applyThemePalette(getInputValue("settingsThemeInput"));
            });
        }

        byId("settingsThemeInput")?.addEventListener("change", () => {
            markSettingsDirty(true);
            applyThemePalette(getInputValue("settingsThemeInput"));
        });

        const dirtyCheckboxes = [
            "settingsWarnBeforeRestartInput",
            "settingsDeveloperModeInput", "settingsAutoUpdatesInput"
        ];
        for (const id of dirtyCheckboxes) {
            byId(id)?.addEventListener("change", () => {
                markSettingsDirty(true);
                if (id === "settingsDeveloperModeInput") syncDeveloperDiagnosticsVisibility();
            });
        }

        byId("settingsGamePathInput")?.addEventListener("blur", () => {
            const gamePath = getInputValue("settingsGamePathInput");
            if (gamePath) {
                void detectAndApplyGameVersion(gamePath);
            }
        });

        byId("settingsGamePathBrowse")?.addEventListener("click", async () => {
            const selectedPath = await window.spikeApi.pickDirectory({
                title: "Select Stellaris installation folder",
                defaultPath: getInputValue("settingsGamePathInput")
            });

            if (!selectedPath) {
                return;
            }

            setInputValue("settingsGamePathInput", selectedPath);
            markSettingsDirty(true);
            void detectAndApplyGameVersion(selectedPath);
        });

        byId("settingsModsPathBrowse")?.addEventListener("click", async () => {
            const selectedPath = await window.spikeApi.pickDirectory({
                title: "Select Stellaris mods folder",
                defaultPath: getInputValue("settingsModsPathInput")
            });

            if (!selectedPath) {
                return;
            }

            setInputValue("settingsModsPathInput", selectedPath);
            markSettingsDirty(true);
        });

        byId("settingsManagedModsPathBrowse")?.addEventListener("click", async () => {
            const selectedPath = await window.spikeApi.pickDirectory({
                title: "Select managed mods folder",
                defaultPath: getInputValue("settingsManagedModsPathInput")
            });

            if (!selectedPath) {
                return;
            }

            setInputValue("settingsManagedModsPathInput", selectedPath);
            markSettingsDirty(true);
        });

        byId("settingsDetectModsPath")?.addEventListener("click", () => void detectModsPathSettings());
        byId("settingsDetectWorkshopRuntime")?.addEventListener("click", () => void detectWorkshopRuntimeSettings());
        byId("settingsAutoConfigureSteamCmd")?.addEventListener("click", () => void autoConfigureSteamCmdSettings());
    }

    return { hookSettingsControls };
}
