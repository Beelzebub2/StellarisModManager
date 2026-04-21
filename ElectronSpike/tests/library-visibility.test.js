const test = require("node:test");
const assert = require("node:assert/strict");

const visibility = require("../src/renderer/libraryVisibility.js");

test("new disabled mods are detected when Enabled only would hide them", () => {
    const previousMods = [
        { workshopId: "111", descriptorPath: "mod/111.mod", isEnabled: true, name: "Existing enabled mod" }
    ];
    const nextMods = [
        ...previousMods,
        { workshopId: "222", descriptorPath: "mod/222.mod", isEnabled: false, name: "Fresh install" }
    ];

    const hidden = visibility.getNewlyAddedDisabledMods(previousMods, nextMods, true);

    assert.equal(hidden.length, 1);
    assert.equal(hidden[0]?.workshopId, "222");
    assert.equal(
        visibility.getRevealDisabledModsMessage(hidden.length),
        "1 newly added mod was hidden by Enabled only. Showing all mods."
    );
});

test("no reveal is triggered when the filter is already off", () => {
    const hidden = visibility.getNewlyAddedDisabledMods(
        [],
        [{ workshopId: "222", descriptorPath: "mod/222.mod", isEnabled: false, name: "Fresh install" }],
        false
    );

    assert.deepEqual(hidden, []);
});

test("already known disabled mods do not retrigger the reveal path", () => {
    const disabledMod = { workshopId: "222", descriptorPath: "mod/222.mod", isEnabled: false, name: "Existing disabled mod" };
    const hidden = visibility.getNewlyAddedDisabledMods([disabledMod], [disabledMod], true);

    assert.deepEqual(hidden, []);
});

test("descriptor path fallback keeps non-workshop mods stable across scans", () => {
    const previousMods = [
        { descriptorPath: "mod/custom_mod.mod", isEnabled: false, name: "Custom Mod" }
    ];
    const nextMods = [
        { descriptorPath: "MOD/Custom_Mod.mod", isEnabled: false, name: "Custom Mod" }
    ];

    const hidden = visibility.getNewlyAddedDisabledMods(previousMods, nextMods, true);

    assert.deepEqual(hidden, []);
});
