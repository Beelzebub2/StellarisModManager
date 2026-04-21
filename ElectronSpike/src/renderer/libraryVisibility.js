(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.libraryVisibility = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function getLibraryModKey(mod) {
        const workshopId = String(mod?.workshopId || "").trim();
        if (workshopId) {
            return `workshop:${workshopId}`;
        }

        const descriptorPath = String(mod?.descriptorPath || "").trim().toLowerCase();
        if (descriptorPath) {
            return `descriptor:${descriptorPath}`;
        }

        const id = Number(mod?.id);
        if (Number.isFinite(id) && id > 0) {
            return `id:${id}`;
        }

        const name = String(mod?.name || "").trim().toLowerCase();
        return name ? `name:${name}` : "";
    }

    function getNewlyAddedDisabledMods(previousMods, nextMods, showEnabledOnly) {
        if (showEnabledOnly !== true) {
            return [];
        }

        const previousKeys = new Set((previousMods || []).map(getLibraryModKey).filter(Boolean));
        const newlyHiddenMods = [];

        for (const mod of nextMods || []) {
            const key = getLibraryModKey(mod);
            if (!key || previousKeys.has(key) || mod?.isEnabled === true) {
                continue;
            }

            newlyHiddenMods.push(mod);
        }

        return newlyHiddenMods;
    }

    function getRevealDisabledModsMessage(count) {
        const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
        if (total === 1) {
            return "1 newly added mod was hidden by Enabled only. Showing all mods.";
        }

        return `${total} newly added mods were hidden by Enabled only. Showing all mods.`;
    }

    return {
        getLibraryModKey,
        getNewlyAddedDisabledMods,
        getRevealDisabledModsMessage
    };
});
