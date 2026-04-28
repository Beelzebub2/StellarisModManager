const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modMerger = require("../dist/main/services/modMerger.js");

function writeFile(root, relativePath, content) {
    const filePath = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function buildSourceMod(modId, name, loadOrder, installedPath) {
    return {
        modId,
        workshopId: String(2200000000 + modId),
        name,
        loadOrder,
        installedPath,
        descriptorPath: path.join(installedPath, "descriptor.mod"),
        isEnabled: true
    };
}

test("auto control applies only safe generated merges by default", async () => {
    assert.equal(typeof modMerger.analyzeModMergerSourcesForTest, "function");
    assert.equal(typeof modMerger.applyAutoResolutionsForTest, "function");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smm-mod-merger-auto-"));
    const descriptorRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mod");
    const outputRoot = path.join(tempRoot, "Documents", "Paradox Interactive", "Stellaris", "mods-merged");
    const modAPath = path.join(tempRoot, "mods", "mod-a");
    const modBPath = path.join(tempRoot, "mods", "mod-b");

    writeFile(modAPath, "gfx/interface/icons/shared.dds", "same-bytes");
    writeFile(modBPath, "gfx/interface/icons/shared.dds", "same-bytes");
    writeFile(modAPath, "localisation/english/smm_l_english.yml", "l_english:\n smm_a:0 \"Alpha\"\n");
    writeFile(modBPath, "localisation/english/smm_l_english.yml", "l_english:\n smm_b:0 \"Beta\"\n");
    writeFile(modAPath, "common/scripted_triggers/smm_auto.txt", "smm_alpha_trigger = {\n always = yes\n}\n");
    writeFile(modBPath, "common/scripted_triggers/smm_auto.txt", "smm_beta_trigger = {\n always = no\n}\n");
    writeFile(modAPath, "common/scripted_effects/smm_manual.txt", "smm_bad_effect = {\n hidden_effect = { set_country_flag = smm\n");
    writeFile(modBPath, "common/scripted_effects/smm_manual.txt", "smm_good_effect = {\n hidden_effect = { set_country_flag = smm_ok }\n}\n");

    try {
        const analysis = await modMerger.analyzeModMergerSourcesForTest({
            profileId: 12,
            profileName: "Auto Control",
            sourceMods: [
                buildSourceMod(41, "Mod A", 0, modAPath),
                buildSourceMod(42, "Mod B", 1, modBPath)
            ],
            descriptorRoot,
            outputRoot,
            outputModName: "SMM Merged Mod",
            gameVersion: "4.3.2"
        });

        assert.equal(analysis.ok, true);

        const duplicatePlan = analysis.plan.filePlans.find((plan) => plan.virtualPath === "gfx/interface/icons/shared.dds");
        assert.ok(duplicatePlan);
        assert.equal(duplicatePlan.resolutionState, "auto");
        assert.equal(duplicatePlan.decisionType, "identical-duplicate");

        const localisationPlan = analysis.plan.filePlans.find((plan) => plan.virtualPath === "localisation/english/smm_l_english.yml");
        assert.ok(localisationPlan);
        assert.equal(localisationPlan.resolutionState, "unresolved");
        assert.equal(localisationPlan.decisionType, "localisation-key-merge");
        assert.equal(localisationPlan.autoRecommendation.canApply, true);
        assert.equal(localisationPlan.autoRecommendation.confidence, "safe");
        assert.equal(localisationPlan.autoRecommendation.reasonCode, "localisation-non-overlap");
        assert.match(localisationPlan.generatedOutput, /smm_a:0 "Alpha"/);
        assert.match(localisationPlan.generatedOutput, /smm_b:0 "Beta"/);

        const scriptPlan = analysis.plan.filePlans.find((plan) => plan.virtualPath === "common/scripted_triggers/smm_auto.txt");
        assert.ok(scriptPlan);
        assert.equal(scriptPlan.resolutionState, "unresolved");
        assert.equal(scriptPlan.decisionType, "script-object-merge");
        assert.equal(scriptPlan.autoRecommendation.canApply, true);
        assert.equal(scriptPlan.autoRecommendation.confidence, "safe");
        assert.equal(scriptPlan.autoRecommendation.reasonCode, "script-object-non-overlap");
        assert.match(scriptPlan.generatedOutput, /smm_alpha_trigger =/);
        assert.match(scriptPlan.generatedOutput, /smm_beta_trigger =/);

        const manualPlan = analysis.plan.filePlans.find((plan) => plan.virtualPath === "common/scripted_effects/smm_manual.txt");
        assert.ok(manualPlan);
        assert.equal(manualPlan.resolutionState, "unresolved");
        assert.equal(manualPlan.autoRecommendation.canApply, false);
        assert.equal(manualPlan.autoRecommendation.confidence, "manual");
        assert.equal(manualPlan.autoRecommendation.reasonCode, "parse-error");

        const applied = modMerger.applyAutoResolutionsForTest(analysis.plan, { scope: "safe" });
        assert.equal(applied.summary.autoResolvedCount, 3);
        assert.equal(applied.summary.unresolvedCount, 1);
        assert.equal(analysis.plan.automation.safeCount, 0);
        assert.equal(analysis.plan.automation.generatedCount, 2);

        assert.equal(localisationPlan.resolutionState, "auto");
        assert.equal(localisationPlan.strategy, "localisation-key-merge");
        assert.equal(scriptPlan.resolutionState, "auto");
        assert.equal(scriptPlan.strategy, "script-object-merge");
        assert.equal(manualPlan.resolutionState, "unresolved");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
