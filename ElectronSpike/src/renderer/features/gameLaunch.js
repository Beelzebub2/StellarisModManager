import { byId } from "../runtime/dom.js";
import { setDataIcon } from "../runtime/icons.js";
import { showModal } from "../runtime/modal.js";
import { setGlobalStatus } from "../runtime/status.js";
import { state } from "../runtime/state.js";

export async function refreshStellarisyncStatus() {
    try {
        const status = await window.spikeApi.getStellarisyncStatus();
        const chip = byId("stellarisyncChip");
        const text = byId("stellarisyncText");

        if (chip && text) {
            if (status.online) {
                chip.className = "status-chip status-chip-online";
                text.textContent = "Stellarisync Online";
            } else {
                chip.className = "status-chip status-chip-offline";
                text.textContent = "Stellarisync Offline";
            }
        }
    } catch {
        // Non-fatal status indicator.
    }
}

export function syncLaunchGameAvailability() {
    const btn = byId("launchGameBtn");
    const text = byId("launchGameText");
    if (!btn || !text) {
        return;
    }

    const iconHolder = btn.querySelector(".nav-icon[data-icon]");
    if (state.modsPathMigration.active) {
        btn.disabled = true;
        btn.title = "Wait for the mods folder change to finish before launching Stellaris.";
        text.textContent = "Moving Mods...";
        setDataIcon(iconHolder, "queue");
        return;
    }

    btn.disabled = false;
    btn.title = "";
    if (state.gameRunning) {
        text.textContent = "Restart Game";
        setDataIcon(iconHolder, "restart");
        return;
    }

    text.textContent = "Launch Game";
    setDataIcon(iconHolder, "launch");
}

export async function refreshGameRunningStatus() {
    try {
        state.gameRunning = await window.spikeApi.getGameRunningStatus();
        syncLaunchGameAvailability();
    } catch {
        // Non-fatal status indicator.
    }
}

export async function handleLaunchGame() {
    if (state.modsPathMigration.active) {
        const message = state.modsPathMigration.lastMessage
            || "Wait for the mods folder change to finish before launching Stellaris.";
        setGlobalStatus(message);
        return;
    }

    if (state.gameRunning && state.settingsModel?.warnBeforeRestartGame !== false) {
        const confirmed = await showModal(
            "Stellaris is running",
            "Restarting will close the running game. Did you save your current game?",
            "Restart Game",
            "Cancel"
        );
        if (!confirmed) return;
    }

    const result = await window.spikeApi.launchGame();
    setGlobalStatus(result.message);
    setTimeout(() => void refreshGameRunningStatus(), 2000);
}
