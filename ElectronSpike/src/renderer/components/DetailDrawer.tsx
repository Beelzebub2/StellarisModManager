import type { ReactElement } from "react";

export function DetailDrawer(): ReactElement {
    return (
        <>
            {/* ==================== DETAIL DRAWER ==================== */}
                <aside id="detailDrawer" className="detail-drawer hidden" aria-live="polite">
                    <div className="detail-backdrop" id="detailCloseBackdrop"></div>
                    <section className="detail-panel">
                        <header className="detail-header">
                            <p className="eyebrow">Mod Detail</p>
                            <button id="detailCloseButton" type="button" className="button-secondary">Close</button>
                        </header>
                        <h3 id="detailTitle">Mod details</h3>
                        <img id="detailImage" className="detail-image" alt="Mod preview" />
                        <div className="detail-meta">
                            <span id="detailVersion" className="badge badge-version">-</span>
                            <span id="detailCommunity" className="badge badge-community">-</span>
                            <span id="detailSubscribers" className="badge">-</span>
                            <span id="detailFileSize" className="badge badge-unverified hidden">-</span>
                        </div>
                        <div className="detail-actions">
                            <button id="detailActionButton" type="button">Install</button>
                            <button id="detailCancelButton" type="button" className="button-secondary">Cancel</button>
                            <button id="detailWorkshopButton" type="button" className="button-secondary full-span">Open Workshop
                                Page</button>
                        </div>
                        <section className="detail-block">
                            <h4>Description</h4>
                            <p id="detailDescription">No description available.</p>
                        </section>
                        <section className="detail-block">
                            <h4>Queue Message</h4>
                            <p id="detailQueueMessage">No queue activity.</p>
                        </section>
                        <section className="detail-block">
                            <h4>Tags</h4>
                            <div id="detailTags" className="tag-list"></div>
                        </section>
                    </section>
                </aside>
        </>
    );
}
