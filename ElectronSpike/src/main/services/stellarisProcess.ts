import { execSync } from "node:child_process";

function isStellarisRunning(): boolean {
    try {
        if (process.platform === "win32") {
            const output = execSync("tasklist /FI \"IMAGENAME eq stellaris.exe\" /NH", {
                encoding: "utf-8",
                timeout: 5000,
                windowsHide: true
            });
            return output.toLowerCase().includes("stellaris.exe");
        }

        const output = execSync("pgrep -f stellaris", {
            encoding: "utf-8",
            timeout: 5000
        });
        return output.trim().length > 0;
    } catch {
        return false;
    }
}

export function killStellaris(): boolean {
    try {
        if (process.platform === "win32") {
            execSync("taskkill /IM stellaris.exe /F", {
                encoding: "utf-8",
                timeout: 10000,
                windowsHide: true
            });
        } else {
            execSync("pkill -f stellaris", {
                encoding: "utf-8",
                timeout: 10000
            });
        }
        return true;
    } catch {
        return false;
    }
}

export function getGameRunningStatus(): boolean {
    return isStellarisRunning();
}
