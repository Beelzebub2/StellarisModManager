import type { ReactElement } from "react";

export function Statusbar(): ReactElement {
    return (
        <>
            {/* ==================== STATUS BAR ==================== */}
                    <footer className="statusbar panel">
                        <span id="statusbarText">Ready</span>
                        <span id="statusbarQueue" className="status-chip status-chip-muted">Queue idle</span>
                    </footer>
        </>
    );
}
