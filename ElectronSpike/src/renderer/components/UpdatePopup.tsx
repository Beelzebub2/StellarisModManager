import type { ReactElement } from "react";

export function UpdatePopup(): ReactElement {
    return (
        <>
            {/* ==================== UPDATE POPUP ==================== */}
                    <div id="updateBanner" className="update-popup hidden" role="alertdialog" aria-modal="true"
                        aria-labelledby="updateBannerVersion" aria-describedby="updateBannerMessage">
                        <div id="updateBannerBackdrop" className="update-popup-backdrop"></div>
                        <section className="update-popup-dialog">
                            <header className="update-popup-header">
                                <span className="update-popup-icon" data-icon="download"></span>
                                <div className="update-popup-heading">
                                    <strong id="updateBannerVersion">Update available</strong>
                                    <span id="updateBannerMessage" className="muted">A new version is ready to install.</span>
                                </div>
                            </header>
                            <div className="update-popup-actions">
                                <button id="updateBannerUpdate" type="button">Update now</button>
                                <button id="updateBannerSkip" type="button" className="button-secondary">Skip this version</button>
                                <button id="updateBannerDismiss" type="button" className="button-secondary">Dismiss</button>
                            </div>
                        </section>
                    </div>
        </>
    );
}
