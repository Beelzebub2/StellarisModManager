import type { ReactElement } from "react";

export function Sidebar(): ReactElement {
    return (
        <>
            {/* ---- SIDEBAR ---- */}
                        <aside className="sidebar panel">
                            <section className="sidebar-hero">
                                <div className="sidebar-hero-mark" aria-label="App icon">
                                    <img id="sidebarHeroIcon" className="sidebar-hero-icon hidden" alt="Stellaris Mod Manager icon" />
                                    <span id="sidebarHeroFallback" className="sidebar-hero-fallback">SM</span>
                                </div>
                                <div className="sidebar-hero-copy">
                                    <p className="sidebar-hero-title">Control Deck</p>
                                    <p className="sidebar-hero-subtitle">Switch views &amp; manage installs</p>
                                </div>
                            </section>
            
                            <section className="sidebar-block sidebar-main">
                                <p className="sidebar-title">Workspaces</p>
                                <div className="nav-items">
                                    <button id="tabVersion" className="nav-btn is-active" type="button">
                                        <span className="nav-icon" data-icon="versions"></span>
                                        <span className="nav-label">By Version</span>
                                    </button>
                                    <button id="tabDownloads" className="nav-btn" type="button">
                                        <span className="nav-icon" data-icon="queue"></span>
                                        <span className="nav-label">Downloads</span>
                                    </button>
                                    <button id="tabLibrary" className="nav-btn" type="button">
                                        <span className="nav-icon" data-icon="library"></span>
                                        <span className="nav-label">Library</span>
                                    </button>
                                    <button id="tabMerger" className="nav-btn" type="button">
                                        <span className="nav-icon" data-icon="merge"></span>
                                        <span className="nav-label">Merger</span>
                                    </button>
                                    <button id="tabWorkshop" className="nav-btn" type="button">
                                        <span className="nav-icon" data-icon="workshop"></span>
                                        <span className="nav-label">Workshop</span>
                                    </button>
                                </div>
            
                                <div className="sidebar-main-bottom">
                                    <p className="sidebar-title">Controls</p>
                                    <button id="launchGameBtn" className="nav-btn nav-btn-launch" type="button">
                                        <span className="nav-icon" data-icon="launch"></span>
                                        <span className="nav-label" id="launchGameText">Launch Game</span>
                                    </button>
                                    <button id="tabSettings" className="nav-btn" type="button">
                                        <span className="nav-icon" data-icon="settings"></span>
                                        <span className="nav-label">Settings</span>
                                    </button>
                                </div>
                            </section>
                        </aside>
        </>
    );
}
