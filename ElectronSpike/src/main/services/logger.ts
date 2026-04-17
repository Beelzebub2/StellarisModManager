import fs from "node:fs";
import path from "node:path";
import { getLegacyPaths } from "./paths";

function ensureLogFilePath(): string {
    const { logsDir } = getLegacyPaths();
    fs.mkdirSync(logsDir, { recursive: true });
    return path.join(logsDir, "electron-spike.log");
}

export function logInfo(message: string): void {
    const logPath = ensureLogFilePath();
    const line = `${new Date().toISOString()} [INFO] ${message}\n`;
    fs.appendFileSync(logPath, line, "utf8");
}

export function logError(message: string): void {
    const logPath = ensureLogFilePath();
    const line = `${new Date().toISOString()} [ERROR] ${message}\n`;
    fs.appendFileSync(logPath, line, "utf8");
}
