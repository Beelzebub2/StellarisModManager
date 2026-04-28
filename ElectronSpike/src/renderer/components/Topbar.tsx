import type { ReactElement } from "react";

export function Topbar(): ReactElement {
    return (
        <>
            {/* ==================== HEADER ==================== */}
                    <header className="topbar panel">
                        <div className="topbar-left">
                            <div className="app-badge" aria-label="App icon">
                                <img id="appBadgeIcon" className="app-badge-image hidden" alt="Stellaris Mod Manager icon" />
                                <span id="appBadgeFallback" className="app-badge-fallback">SM</span>
                            </div>
                            <div className="brand-block">
                                <h1 className="brand-title">Stellaris Mod Manager</h1>
                            </div>
                        </div>
                        <div className="topbar-actions">
                            <div id="stellarisyncChip" className="status-chip status-chip-warn">
                                <span className="status-dot"></span>
                                <span id="stellarisyncText">Checking...</span>
                            </div>
                            <div id="appVersionChip" className="status-chip status-chip-muted">
                                <span id="appVersionText">v0.1.0</span>
                            </div>
                        </div>
                    </header>
        </>
    );
}
