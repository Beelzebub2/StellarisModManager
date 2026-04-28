import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(root, "tests");
const testFiles = readdirSync(testsDir)
    .filter((fileName) => fileName.endsWith(".test.js"))
    .sort()
    .map((fileName) => join("tests", fileName));

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: root,
    stdio: "inherit",
    shell: false
});

process.exit(result.status ?? 1);
