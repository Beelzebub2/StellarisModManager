const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "..", "src", "renderer");
const rendererRuntimeRoot = path.join(rendererRoot, "runtime");
const rendererFeaturesRoot = path.join(rendererRoot, "features");
const rendererEntryPath = path.join(rendererRoot, "renderer.js");

function readRendererRuntimeSource() {
    return [
        fs.readFileSync(rendererEntryPath, "utf8"),
        ...readRuntimeSources(rendererRuntimeRoot),
        ...readRuntimeSources(rendererFeaturesRoot)
    ].join("\n");
}

function readRuntimeSources(directory) {
    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return readRuntimeSources(entryPath);
            }

            return entry.name.endsWith(".js") ? [fs.readFileSync(entryPath, "utf8")] : [];
        });
}

module.exports = {
    readRendererRuntimeSource,
    rendererFeaturesRoot,
    rendererEntryPath,
    rendererRuntimeRoot
};
