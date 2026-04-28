const fs = require("node:fs");
const path = require("node:path");

const rendererComponentsPath = path.join(__dirname, "..", "..", "src", "renderer", "components");
const rendererShellPath = path.join(rendererComponentsPath, "RendererShell.tsx");

function readRendererShellSource() {
    return readComponentSources(rendererComponentsPath).join("\n");
}

function readComponentSources(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return readComponentSources(entryPath);
            }

            return entry.name.endsWith(".tsx") ? [fs.readFileSync(entryPath, "utf8")] : [];
        });
}

module.exports = {
    readRendererShellSource,
    rendererComponentsPath,
    rendererShellPath
};
