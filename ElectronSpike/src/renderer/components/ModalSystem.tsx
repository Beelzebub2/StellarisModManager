import type { ReactElement } from "react";

export function ModalSystem(): ReactElement {
    return (
        <>
            {/* ==================== MODAL SYSTEM ==================== */}
                <div id="modalOverlay" className="modal-overlay hidden">
                    <div className="modal-backdrop" id="modalBackdrop"></div>
                    <div className="modal-dialog" id="modalDialog">
                        <h3 id="modalTitle">Confirm</h3>
                        <p id="modalMessage" className="muted">Are you sure?</p>
                        <div id="modalExtra"></div>
                        <div className="modal-actions">
                            <button id="modalCancel" type="button" className="button-secondary">Cancel</button>
                            <button id="modalAlt" type="button" className="button-secondary hidden">Alternate</button>
                            <button id="modalConfirm" type="button">Confirm</button>
                        </div>
                    </div>
                </div>
        </>
    );
}
