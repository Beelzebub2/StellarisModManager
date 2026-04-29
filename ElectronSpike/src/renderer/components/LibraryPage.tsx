import type { ReactElement } from "react";

export function LibraryPage(): ReactElement {
    return (
        <>
            {/* ======== LIBRARY PAGE ======== */}
                            <section id="pageLibrary" className="page-section hidden">
                                <section className="library-toolbar">
                                    <div className="library-toolbar-main">
                                        <div className="field-col grow">
                                            <label className="field-label" htmlFor="librarySearchInput">Search</label>
                                            <div className="search-wrap search-wrap-solo">
                                                <input id="librarySearchInput" className="field-input" type="text"
                                                    placeholder="Search by mod name or workshop ID" />
                                            </div>
                                        </div>
                                        <label className="toggle-row" htmlFor="libraryEnabledOnly">
                                            <input id="libraryEnabledOnly" type="checkbox" />
                                            <span>Enabled only</span>
                                        </label>
                                    </div>
                                    <div className="library-toolbar-actions">
                                        <button id="libraryCheckUpdates" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="check"></span> Check updates
                                        </button>
                                        <details className="library-menu" id="libraryBulkActionsMenu">
                                            <summary className="library-menu-trigger button-secondary">
                                                <span className="nav-icon" data-icon="settings"></span>
                                                Library actions
                                                <span className="library-menu-caret" data-icon="chevronDown"></span>
                                            </summary>
                                            <div className="library-menu-panel">
                                                <button id="libraryReinstallAll" type="button" className="button-secondary">
                                                    <span className="nav-icon" data-icon="reinstall"></span> Reinstall all
                                                </button>
                                                <button id="libraryExport" type="button" className="button-secondary">
                                                    <span className="nav-icon" data-icon="export"></span> Export list
                                                </button>
                                                <button id="libraryImport" type="button" className="button-secondary">
                                                    <span className="nav-icon" data-icon="import"></span> Import list
                                                </button>
                                                <button id="libraryScanLocal" type="button" className="button-secondary">
                                                    <span className="nav-icon" data-icon="scan"></span> Scan local mods
                                                </button>
                                                <button id="librarySuggestLoadOrder" type="button" className="button-secondary">
                                                    <span className="nav-icon" data-icon="sparkles"></span> Suggest load order
                                                </button>
                                            </div>
                                        </details>
                                    </div>
                                </section>
            
                                <section className="library-profiles">
                                    <div className="library-profile-row">
                                        <div className="field-col">
                                            <label className="field-label" htmlFor="libraryProfileSelect">Profile</label>
                                            <select id="libraryProfileSelect" className="field-input"></select>
                                        </div>
                                        <div className="library-profile-actions">
                                            <details className="library-menu" id="libraryProfileActionsMenu">
                                                <summary className="library-menu-trigger button-secondary">
                                                    <span className="nav-icon" data-icon="edit"></span>
                                                    Profile actions
                                                    <span className="library-menu-caret" data-icon="chevronDown"></span>
                                                </summary>
                                                <div className="library-menu-panel">
                                                    <button id="libraryNewProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="plus"></span> New profile
                                                    </button>
                                                    <button id="libraryRenameProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="edit"></span> Rename profile
                                                    </button>
                                                    <button id="libraryDeleteProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="trash"></span> Delete profile
                                                    </button>
                                                </div>
                                            </details>
                                        </div>
                                    </div>
                                    <div className="library-profile-row library-profile-row-shared">
                                        <div className="field-col grow">
                                            <label className="field-label">Shared profile ID</label>
                                            <div id="librarySharedProfileValue" className="library-shared-value mono is-empty"
                                                title="No shared profile ID set">
                                                No shared profile ID set
                                            </div>
                                            <div id="librarySharedProfileOwnership" className="library-shared-ownership muted">
                                                Not shared yet
                                            </div>
                                        </div>
                                        <div className="library-profile-actions">
                                            <details className="library-menu" id="librarySharedActionsMenu">
                                                <summary className="library-menu-trigger button-secondary">
                                                    <span className="nav-icon" data-icon="share"></span>
                                                    Shared ID
                                                    <span className="library-menu-caret" data-icon="chevronDown"></span>
                                                </summary>
                                                <div className="library-menu-panel">
                                                    <button id="libraryUpdateSharedProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="export"></span>
                                                        <span id="libraryUpdateSharedProfileLabel">Update</span>
                                                    </button>
                                                    <button id="librarySyncSharedProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="refresh"></span> Sync
                                                    </button>
                                                    <button id="libraryUseSharedId" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="link"></span> Use shared ID
                                                    </button>
                                                    <button id="libraryShareProfile" type="button" className="button-secondary">
                                                        <span className="nav-icon" data-icon="share"></span> Copy shared ID
                                                    </button>
                                                </div>
                                            </details>
                                        </div>
                                    </div>
                                </section>
            
                                <section className="library-main">
                                    <article className="library-list-shell">
                                        <header className="library-list-header">
                                            <span>On</span>
                                            <span>Mod</span>
                                            <span>#</span>
                                            <span>Actions</span>
                                        </header>
                                        <div id="libraryList" className="library-list"></div>
                                    </article>
            
                                    <article className="library-detail-shell">
                                        <div id="libraryDetailEmpty" className="library-detail-empty muted">Select a mod to view
                                            details.</div>
                                        <div id="libraryDetail" className="library-detail hidden">
                                            <div className="library-detail-head">
                                                <div className="library-detail-thumb-wrap">
                                                    <img id="libraryDetailThumb" className="library-detail-thumb hidden" src=""
                                                        alt="" />
                                                    <div id="libraryDetailThumbFallback" className="library-detail-thumb-fallback">M
                                                    </div>
                                                </div>
                                                <div className="library-detail-head-body">
                                                    <h3 id="libraryDetailName">Mod</h3>
                                                    <div className="library-detail-badges">
                                                        <span id="libraryDetailMpSafe"
                                                            className="badge badge-community hidden">Multiplayer safe</span>
                                                        <span id="libraryDetailHasUpdate" className="badge badge-version hidden">Update
                                                            available</span>
                                                        <span id="libraryDetailSubscribersChip"
                                                            className="badge badge-unverified hidden"></span>
                                                    </div>
                                                </div>
                                            </div>
            
                                            <div className="library-detail-info">
                                                <div className="library-detail-grid">
                                                    <p className="settings-key">Workshop ID</p>
                                                    <p id="libraryDetailWorkshopId" className="settings-value accent-text mono">-</p>
                                                    <p className="settings-key">Mod Version</p>
                                                    <p id="libraryDetailVersion" className="settings-value">-</p>
                                                    <p className="settings-key">Game Version</p>
                                                    <p id="libraryDetailGameVersion" className="settings-value">-</p>
                                                    <p className="settings-key">Last Updated</p>
                                                    <p id="libraryDetailLastUpdated" className="settings-value">-</p>
                                                </div>
                                            </div>
            
                                            <section id="libraryDetailTagsSection" className="detail-block">
                                                <div className="detail-block-head">
                                                    <h4>Descriptor Tags</h4>
                                                    <button id="libraryDetailTagsToggle" type="button" className="feedback-tool-btn"
                                                        hidden>Show all</button>
                                                </div>
                                                <div id="libraryDetailTags" className="tag-list descriptor-tag-list">No tags.</div>
                                            </section>
            
                                            <section className="feedback-panel">
                                                <header className="feedback-header">
                                                    <h4>Community Feedback</h4>
                                                    <span id="feedbackStateBadge"
                                                        className="feedback-state-badge feedback-state-nodata">No data</span>
                                                </header>
            
                                                <div className="feedback-consensus">
                                                    <div className="consensus-bar">
                                                        <span id="consensusBarWorks" className="consensus-bar-works"
                                                            style={{ width: "0%" }}></span>
                                                        <span id="consensusBarBroken" className="consensus-bar-broken"
                                                            style={{ width: "0%" }}></span>
                                                    </div>
                                                    <div className="consensus-stats">
                                                        <span id="consensusWorksLabel" className="consensus-stat consensus-stat-works">0
                                                            works</span>
                                                        <span id="consensusTotalLabel" className="consensus-stat consensus-stat-total">0
                                                            reports</span>
                                                        <span id="consensusBrokenLabel"
                                                            className="consensus-stat consensus-stat-broken">0 broken</span>
                                                    </div>
                                                </div>
            
                                                <div id="feedbackTrustedTags" className="feedback-trusted-tags hidden">
                                                    <p className="feedback-section-label">Trusted community tags</p>
                                                    <div id="feedbackTrustedTagList" className="feedback-trusted-tag-list"></div>
                                                </div>
            
                                                <div id="feedbackDisputedGroups" className="feedback-disputed hidden">
                                                    <p id="feedbackDisputedText" className="muted"></p>
                                                </div>
            
                                                <div className="feedback-vote">
                                                    <p className="feedback-section-label">Your vote</p>
                                                    <div className="feedback-vote-row">
                                                        <button id="libraryActionWorks" type="button"
                                                            className="vote-btn vote-btn-works">
                                                            <span className="nav-icon" data-icon="thumbsUp"></span> Works
                                                        </button>
                                                        <button id="libraryActionBroken" type="button"
                                                            className="vote-btn vote-btn-broken">
                                                            <span className="nav-icon" data-icon="thumbsDown"></span> Broken
                                                        </button>
                                                    </div>
                                                </div>
            
                                                <div className="feedback-your-tags">
                                                    <div className="feedback-your-tags-head">
                                                        <p className="feedback-section-label">Your tags</p>
                                                        <div className="feedback-tag-toolbar">
                                                            <button id="libraryClearTags" type="button" className="feedback-tool-btn"
                                                                title="Clear all tags">Clear</button>
                                                            <button id="libraryResetTags" type="button" className="feedback-tool-btn"
                                                                title="Reset to last saved">Reset</button>
                                                        </div>
                                                    </div>
                                                    <div id="libraryReportTagList" className="feedback-tag-list"></div>
                                                    <div className="feedback-tag-footer">
                                                        <p id="librarySelectedTagsInfo" className="muted feedback-tag-info"></p>
                                                        <button id="librarySubmitTagsOnly" type="button"
                                                            className="button-secondary feedback-save-btn">Save tags</button>
                                                    </div>
                                                </div>
                                            </section>
            
                                            <section className="detail-block">
                                                <div className="detail-block-head">
                                                    <h4>Quick Actions</h4>
                                                </div>
                                                <p className="muted">Right-click this mod in the Library list for Workshop, update,
                                                    file-location, and remove actions.</p>
                                                <section className="library-detail-actions-grid">
                                                    <button id="libraryActionReinstall" type="button" className="action-btn">
                                                        <span className="nav-icon" data-icon="reinstall"></span> Reinstall
                                                    </button>
                                                </section>
                                            </section>
                                        </div>
                                    </article>
                                </section>
            
                                <footer className="library-footer">
                                    <div className="library-footer-left">
                                        <span id="libraryTotalModsChip" className="status-chip">Total: 0</span>
                                        <span id="libraryEnabledModsChip" className="status-chip status-chip-success">Enabled: 0</span>
                                        <span id="libraryStatus" className="muted">Library ready.</span>
                                    </div>
                                    <span id="libraryUpdatesFooter" className="status-chip status-chip-muted">Updates: 0</span>
                                </footer>
                            </section>
        </>
    );
}
