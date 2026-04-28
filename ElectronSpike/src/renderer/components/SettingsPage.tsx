import type { ReactElement } from "react";

export function SettingsPage(): ReactElement {
    return (
        <>
            {/* ======== SETTINGS PAGE ======== */}
                            <section id="pageSettings" className="page-section hidden">
                                <header className="hero">
                                    <div>
                                        <p className="eyebrow">Settings</p>
                                        <h2>App Configuration</h2>
                                        <p className="muted">Profile, game paths, workshop runtime, updates, and diagnostics.</p>
                                    </div>
                                    <div className="hero-metrics">
                                        <button id="refreshSettings" type="button" className="button-secondary">Refresh</button>
                                    </div>
                                </header>
            
                                <section className="settings-shell">
                                    <div className="settings-subtabs">
                                        <button type="button" className="settings-subtab is-active"
                                            data-settings-tab="general">General</button>
                                        <button type="button" className="settings-subtab" data-settings-tab="workshop">Workshop</button>
                                        <button type="button" className="settings-subtab" data-settings-tab="updates">Updates</button>
                                        <button type="button" className="settings-subtab" data-settings-tab="advanced">Advanced</button>
                                    </div>
                                    <div className="settings-panels">
                                        {/* GENERAL TAB */}
                                        <div id="settingsTabGeneral" className="settings-panel">
                                            <article className="settings-card settings-card-primary">
                                                <div className="settings-card-heading">
                                                    <div>
                                                        <h3>Game Setup</h3>
                                                        <p className="muted settings-card-lead">Point the app at Stellaris, the Paradox
                                                            descriptor
                                                            folder, and the managed mods folder.</p>
                                                    </div>
                                                    <span id="settingsGameVersionChip" className="status-chip status-chip-muted">Version
                                                        not
                                                        detected</span>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsGamePathInput">Game path</label>
                                                    <div className="path-picker-row">
                                                        <input id="settingsGamePathInput" className="field-input mono" type="text"
                                                            placeholder="Path to Stellaris installation folder" />
                                                        <button id="settingsGamePathBrowse" type="button"
                                                            className="button-secondary">Browse...</button>
                                                    </div>
                                                    <p className="muted settings-inline-help">You need to define this so the manager can
                                                        open the game. ...\Stellaris </p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsLaunchOptionsInput">Launch options</label>
                                                    <input id="settingsLaunchOptionsInput" className="field-input mono" type="text"
                                                        placeholder='Example: --safe-mode "--profile name"' />
                                                    <p className="muted settings-inline-help">Optional raw arguments passed to
                                                        <code>stellaris.exe</code> when you use Launch Game.</p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsModsPathInput">Descriptor folder</label>
                                                    <div className="path-picker-row">
                                                        <input id="settingsModsPathInput" className="field-input mono" type="text"
                                                            placeholder="Path to Documents\\Paradox Interactive\\Stellaris\\mod" />
                                                        <button id="settingsModsPathBrowse" type="button"
                                                            className="button-secondary">Browse...</button>
                                                        <button id="settingsDetectModsPath" type="button"
                                                            className="button-secondary">Detect</button>
                                                    </div>
                                                    <p className="muted settings-inline-help">This folder should be in the documents
                                                        where stellaris keeps save games etc... ...\Documents\Paradox
                                                        Interactive\Stellaris\mod
                                                    </p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsManagedModsPathInput">Managed mods
                                                        folder</label>
                                                    <div className="path-picker-row">
                                                        <input id="settingsManagedModsPathInput" className="field-input mono"
                                                            type="text"
                                                            placeholder="Optional separate folder for managed mod contents" />
                                                        <button id="settingsManagedModsPathBrowse" type="button"
                                                            className="button-secondary">Browse...</button>
                                                    </div>
                                                    <p className="muted settings-inline-help">If you want to keep the actual mod files
                                                        in a different drive/folder this is where you define it, after saving
                                                        settings the mod manager will move them for you
                                                    </p>
                                                </div>
                                                <div className="settings-inline-actions">
                                                    <label className="toggle-row" htmlFor="settingsWarnBeforeRestartInput">
                                                        <input id="settingsWarnBeforeRestartInput" type="checkbox" />
                                                        <span>Show restart warning</span>
                                                    </label>
                                                </div>
                                                <p className="muted">Detected game version: <span id="settingsGameVersionText"
                                                        className="accent-text">Not set</span></p>
                                            </article>
            
                                            <article className="settings-card">
                                                <div className="settings-card-heading">
                                                    <div>
                                                        <h3>Profile &amp; Sharing</h3>
                                                        <p className="muted settings-card-lead">Used when publishing shared profiles and
                                                            community
                                                            compatibility feedback.</p>
                                                    </div>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsPublicProfileInput">Public
                                                        username</label>
                                                    <input id="settingsPublicProfileInput" className="field-input" type="text"
                                                        maxLength={40} placeholder="Example: StarAdmiral" />
                                                    <p className="muted settings-inline-help">Keep this stable so shared profiles are
                                                        easy to
                                                        recognize.</p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsThemeInput">Theme palette</label>
                                                    <select id="settingsThemeInput" className="field-input"></select>
                                                    <p className="muted settings-inline-help">Preview updates immediately. Save to keep
                                                        the new
                                                        palette.</p>
                                                </div>
                                            </article>
                                        </div>
            
                                        {/* WORKSHOP TAB */}
                                        <div id="settingsTabWorkshop" className="settings-panel hidden">
                                            <article className="settings-card">
                                                <div className="settings-card-heading">
                                                    <div>
                                                        <h3>Workshop Downloads</h3>
                                                        <p className="muted settings-card-lead">Choose the runtime and keep the fallback
                                                            path
                                                            ready.</p>
                                                    </div>
                                                    <span id="settingsWorkshopRuntimeChip"
                                                        className="status-chip status-chip-muted">Runtime: Auto</span>
                                                </div>
                                                <div className="settings-inline-actions">
                                                    <button id="settingsDetectWorkshopRuntime" type="button"
                                                        className="button-secondary">Detect runtime</button>
                                                    <button id="settingsAutoConfigureSteamCmd" type="button"
                                                        className="button-secondary">Auto configure SteamCMD</button>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsWorkshopRuntimeInput">Runtime</label>
                                                    <select id="settingsWorkshopRuntimeInput" className="field-input"></select>
                                                </div>
                                                <p id="settingsRuntimeHint" className="muted settings-inline-help">Auto will prefer the
                                                    best
                                                    configured runtime for this machine.</p>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsSteamworksConcurrencyInput">Steamworks
                                                        max simultaneous downloads</label>
                                                    <input id="settingsSteamworksConcurrencyInput" className="field-input" type="number"
                                                        min="1" max="5" step="1" inputMode="numeric" />
                                                    <p className="muted settings-inline-help">Used when Runtime is Steamworks or when
                                                        Auto resolves to Steamworks. Max 5.</p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsSteamCmdConcurrencyInput">SteamCMD max
                                                        simultaneous downloads</label>
                                                    <input id="settingsSteamCmdConcurrencyInput" className="field-input" type="number"
                                                        min="1" max="5" step="1" inputMode="numeric" />
                                                    <p className="muted settings-inline-help">Used when Runtime is SteamCMD or when
                                                        Auto resolves to SteamCMD. Higher values can make per-mod progress less
                                                        precise. Max 5.</p>
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsSteamCmdPathInput">SteamCMD path</label>
                                                    <input id="settingsSteamCmdPathInput" className="field-input mono" type="text"
                                                        placeholder="Path to steamcmd.exe" />
                                                </div>
                                                <div className="field-col">
                                                    <label className="field-label" htmlFor="settingsSteamCmdDownloadPathInput">SteamCMD
                                                        download
                                                        path</label>
                                                    <input id="settingsSteamCmdDownloadPathInput" className="field-input mono"
                                                        type="text" placeholder="SteamCMD download and workshop cache path" />
                                                </div>
                                                <div className="settings-status-row">
                                                    <span className="settings-key">SteamCMD status</span>
                                                    <span id="settingsSteamCmdConfiguredText"
                                                        className="steam-status-text settings-value">Not configured</span>
                                                </div>
                                            </article>
                                        </div>
            
                                        {/* UPDATES TAB */}
                                        <div id="settingsTabUpdates" className="settings-panel hidden">
                                            <article className="settings-card">
                                                <div className="settings-card-heading">
                                                    <div>
                                                        <h3>App Updates</h3>
                                                        <p className="muted settings-card-lead">Control update checks and see recent
                                                            versions.</p>
                                                    </div>
                                                </div>
                                                <div className="settings-inline-actions">
                                                    <label className="toggle-row" htmlFor="settingsAutoUpdatesInput">
                                                        <input id="settingsAutoUpdatesInput" type="checkbox" />
                                                        <span>Auto-check for updates on startup</span>
                                                    </label>
                                                    <button id="settingsCheckUpdateBtn" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="check"></span> Check now
                                                    </button>
                                                </div>
                                                <p id="settingsUpdateStatus" className="muted">Not checked yet.</p>
            
                                                <div id="settingsUpdateAvailable" className="update-available-card hidden">
                                                    <div className="update-available-header">
                                                        <span className="badge badge-version" id="settingsUpdateVersionBadge">--</span>
                                                        <span className="update-available-title">New version available</span>
                                                    </div>
                                                    <pre id="settingsUpdateChangelog" className="update-changelog"></pre>
                                                    <div className="update-available-actions">
                                                        <button id="settingsDownloadUpdateBtn" type="button">
                                                            <span className="nav-icon" data-icon="download"></span> Update now
                                                        </button>
                                                        <button id="settingsSkipVersionBtn" type="button"
                                                            className="button-secondary">Skip this version</button>
                                                        <button id="settingsViewReleaseBtn" type="button"
                                                            className="button-secondary">View release</button>
                                                    </div>
                                                </div>
            
                                                <div className="settings-kv">
                                                    <p className="settings-key">Current version</p>
                                                    <p id="settingsCurrentVersionText" className="settings-value">--</p>
                                                    <p className="settings-key">Last check</p>
                                                    <p id="settingsLastCheckUtcText" className="settings-value">Never</p>
                                                    <p className="settings-key">Last offered version</p>
                                                    <p id="settingsLastOfferedVersionText" className="settings-value">--</p>
                                                    <p className="settings-key">Skipped version</p>
                                                    <p id="settingsSkippedVersionText" className="settings-value">--</p>
                                                </div>
                                            </article>
                                        </div>
            
                                        {/* ADVANCED TAB */}
                                        <div id="settingsTabAdvanced" className="settings-panel hidden">
                                            <article className="settings-card">
                                                <div className="settings-card-heading">
                                                    <div>
                                                        <h3>Diagnostics &amp; Developer</h3>
                                                        <p className="muted settings-card-lead">Enable Developer mode to view runtime
                                                            diagnostics.</p>
                                                    </div>
                                                </div>
                                                <label className="toggle-row" htmlFor="settingsDeveloperModeInput">
                                                    <input id="settingsDeveloperModeInput" type="checkbox" />
                                                    <span>Developer mode</span>
                                                </label>
                                                <p id="settingsDiagnosticsHint" className="muted">Enable Developer mode to view runtime
                                                    diagnostics.</p>
                                                <div id="settingsDiagnosticsContent" className="hidden">
                                                    <pre id="runtime">Loading...</pre>
                                                    <pre id="db">Loading...</pre>
                                                </div>
                                            </article>
                                        </div>
                                    </div>
                                </section>
            
                                <footer className="settings-footer">
                                    <span id="settingsStatus" className="muted">Settings ready.</span>
                                    <span id="settingsUnsavedChip" className="status-chip status-chip-warn hidden">Unsaved
                                        changes</span>
                                    <button id="validateSettings" type="button" className="button-secondary">Validate</button>
                                    <button id="saveSettings" type="button">Save</button>
                                </footer>
                            </section>
        </>
    );
}
