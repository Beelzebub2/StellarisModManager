import os from "node:os";
import path from "node:path";
import type { AppPaths } from "../../shared/types";

const PRODUCT_DIR_NAME = "StellarisModManager";

function getAppDataRoot(): string {
    const platform = os.platform();

    if (platform === "win32") {
        return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    }

    if (platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support");
    }

    return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

export function getLegacyPaths(): AppPaths {
    const appDataRoot = getAppDataRoot();
    const productDir = path.join(appDataRoot, PRODUCT_DIR_NAME);

    return {
        appDataRoot,
        productDir,
        settingsPath: path.join(productDir, "settings.json"),
        modsDbPath: path.join(productDir, "mods.db"),
        logsDir: path.join(productDir, "logs")
    };
}
