(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.installPrerequisites = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const INSTALL_PREREQUISITE_MESSAGES = Object.freeze({
        modsPath: "Set your descriptor folder in Settings before installing mods.",
        steamCmd: "Configure SteamCMD in Settings before installing mods.",
        combined: "Set your descriptor folder and configure SteamCMD in Settings before installing mods."
    });

    function normalizeRuntime(value) {
        const normalized = String(value || "Auto").trim().toLowerCase();
        if (normalized === "steamworks" || normalized === "steamkit2") {
            return "Steamworks";
        }

        if (normalized === "steamcmd") {
            return "SteamCMD";
        }

        return "Auto";
    }

    function getInstallPrerequisiteState(settings) {
        const current = settings || {};
        const modsPath = String(current.modsPath || "").trim();
        const steamCmdPath = String(current.steamCmdPath || "").trim();
        const runtime = normalizeRuntime(current.workshopDownloadRuntime);
        const missingModsPath = modsPath.length === 0;
        const missingSteamCmd = runtime !== "Steamworks" && steamCmdPath.length === 0;

        if (!missingModsPath && !missingSteamCmd) {
            return {
                canInstall: true,
                missingModsPath: false,
                missingSteamCmd: false,
                message: ""
            };
        }

        const message = missingModsPath && missingSteamCmd
            ? INSTALL_PREREQUISITE_MESSAGES.combined
            : missingModsPath
                ? INSTALL_PREREQUISITE_MESSAGES.modsPath
                : INSTALL_PREREQUISITE_MESSAGES.steamCmd;

        return {
            canInstall: false,
            missingModsPath,
            missingSteamCmd,
            message
        };
    }

    return {
        INSTALL_PREREQUISITE_MESSAGES,
        getInstallPrerequisiteState
    };
});
