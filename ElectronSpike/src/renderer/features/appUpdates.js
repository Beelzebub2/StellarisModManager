import { byId } from "../runtime/dom.js";
import { state } from "../runtime/state.js";

state.appUpdate = state.appUpdate || { latestRelease: null, message: "Not checked yet.", busy: false };

function getAppUpdateView() {
    const latestRelease = state.appUpdate.latestRelease || null;
    const skippedVersion = state.settingsModel?.skippedAppVersion || "";
    const helper = globalThis.appUpdateState?.getVisibleAppUpdateState;
    if (typeof helper === "function") {
        return helper(latestRelease, skippedVersion);
    }

    return {
        bannerRelease: latestRelease && latestRelease.version !== skippedVersion ? latestRelease : null,
        settingsRelease: latestRelease,
        isSkipped: !!(latestRelease && latestRelease.version === skippedVersion)
    };
}

export async function checkForAppUpdates(source = "auto") {
    if (state.appUpdate.busy) return;
    state.appUpdate.busy = true;
    const statusEl = byId("settingsUpdateStatus");
    if (source === "manual" && statusEl) statusEl.textContent = "Checking for updates...";
    try {
        const result = await window.spikeApi.checkAppUpdate();
        state.appUpdate.message = result.message;
        state.appUpdate.latestRelease = result.hasUpdate ? result.release : null;
    } catch (err) {
        state.appUpdate.latestRelease = null;
        state.appUpdate.message = `Update check failed: ${err?.message || err}`;
    } finally {
        state.appUpdate.busy = false;
        renderAppUpdateBanner();
        renderSettingsAppUpdate();
    }
}

function renderAppUpdateBanner() {
    const banner = byId("updateBanner");
    if (!banner) return;
    const { bannerRelease: release } = getAppUpdateView();
    if (!release) {
        banner.classList.add("hidden");
        return;
    }
    const versionEl = byId("updateBannerVersion");
    const messageEl = byId("updateBannerMessage");
    if (versionEl) versionEl.textContent = `v${release.version} available`;
    if (messageEl) {
        messageEl.textContent = release.critical
            ? "Critical update - install as soon as possible."
            : "A new version is ready to install.";
    }
    banner.classList.remove("hidden");
}

export function renderSettingsAppUpdate() {
    const statusEl = byId("settingsUpdateStatus");
    if (statusEl) statusEl.textContent = state.appUpdate.message || "Not checked yet.";

    const card = byId("settingsUpdateAvailable");
    const { settingsRelease: release, isSkipped } = getAppUpdateView();
    if (!card) return;
    if (!release) {
        card.classList.add("hidden");
        return;
    }
    card.classList.remove("hidden");
    const badge = byId("settingsUpdateVersionBadge");
    if (badge) badge.textContent = `v${release.version}`;
    const changelog = byId("settingsUpdateChangelog");
    if (changelog) changelog.textContent = release.changelog || "See release notes on GitHub.";
    const skipBtn = byId("settingsSkipVersionBtn");
    if (skipBtn) skipBtn.classList.toggle("hidden", isSkipped);
}

async function launchAppUpdateFlow() {
    const { settingsRelease: release } = getAppUpdateView();
    if (!release) return;
    const result = await window.spikeApi.startAppUpdate(release);
    if (!result?.ok) {
        state.appUpdate.message = result?.message || "Could not start updater.";
        renderSettingsAppUpdate();
    }
    // On success the main process quits this app; no further UI work.
}

async function skipCurrentAppVersion() {
    const { settingsRelease: release } = getAppUpdateView();
    if (!release) return;
    await window.spikeApi.skipAppVersion(release.version);
    if (state.settingsModel) state.settingsModel.skippedAppVersion = release.version;
    renderAppUpdateBanner();
    renderSettingsAppUpdate();
}

export function hookAppUpdateControls() {
    byId("updateBannerUpdate")?.addEventListener("click", () => void launchAppUpdateFlow());
    byId("updateBannerSkip")?.addEventListener("click", () => void skipCurrentAppVersion());
    byId("updateBannerDismiss")?.addEventListener("click", () => {
        byId("updateBanner")?.classList.add("hidden");
    });
    byId("updateBannerBackdrop")?.addEventListener("click", () => {
        byId("updateBanner")?.classList.add("hidden");
    });

    byId("settingsCheckUpdateBtn")?.addEventListener("click", () => void checkForAppUpdates("manual"));
    byId("settingsDownloadUpdateBtn")?.addEventListener("click", () => void launchAppUpdateFlow());
    byId("settingsSkipVersionBtn")?.addEventListener("click", () => void skipCurrentAppVersion());
    byId("settingsViewReleaseBtn")?.addEventListener("click", () => {
        const { settingsRelease: release } = getAppUpdateView();
        const url = release?.releaseUrl;
        if (url) void window.spikeApi.openExternalUrl(url);
    });
}
