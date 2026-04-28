import type { ReactElement } from "react";

export function MergerPage(): ReactElement {
    return (
        <>
            {/* ======== MERGER PAGE ======== */}
                            <section id="pageMerger" className="page-section page-section-merger hidden">
                                <header className="merger-header">
                                    <div>
                                        <p className="eyebrow">Merger</p>
                                        <h2>Analyze and Build a Deterministic Merge</h2>
                                        <p className="muted merger-header-copy">Scan the active profile, inspect file-level conflicts,
                                            and build a merged local mod without modifying the original sources.</p>
                                    </div>
                                    <div className="merger-header-meta">
                                        <span id="mergerProfileChip" className="status-chip status-chip-muted">Profile: --</span>
                                        <span id="mergerEnabledChip" className="status-chip status-chip-muted">Enabled mods: 0</span>
                                        <span id="mergerAnalysisChip" className="status-chip status-chip-muted">Last analysis:
                                            Never</span>
                                    </div>
                                </header>
            
                                <section className="merger-toolbar settings-card settings-card-primary">
                                    <div className="merger-toolbar-actions">
                                        <button id="mergerAnalyzeBtn" type="button">
                                            <span className="nav-icon" data-icon="refresh"></span> Scan
                                        </button>
                                        <button id="mergerOpenResultsBtn" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="layers"></span> Open results
                                        </button>
                                        <button id="mergerAutoBtn" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="sparkles"></span> Auto Control
                                        </button>
                                        <button id="mergerBuildBtn" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="merge"></span> Build merged mod
                                        </button>
                                        <button id="mergerOpenOutputBtn" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="folder"></span> Open output folder
                                        </button>
                                        <button id="mergerExportReportBtn" type="button" className="button-secondary">
                                            <span className="nav-icon" data-icon="export"></span> Export report
                                        </button>
                                    </div>
                                    <div className="merger-toolbar-meta">
                                        <p className="settings-key">Last output path</p>
                                        <p id="mergerLastOutputPath" className="settings-value mono">Not built yet.</p>
                                    </div>
                                </section>
            
                                <section className="merger-metrics downloads-metrics">
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Enabled Mods</p>
                                        <p id="mergerMetricEnabledMods" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Files Scanned</p>
                                        <p id="mergerMetricFilesScanned" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric downloads-metric-warn">
                                        <p className="downloads-metric-label">File Conflicts</p>
                                        <p id="mergerMetricFileConflicts" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Script Conflicts</p>
                                        <p id="mergerMetricScriptConflicts" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Localisation</p>
                                        <p id="mergerMetricLocalisationConflicts" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Asset Conflicts</p>
                                        <p id="mergerMetricAssetConflicts" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Auto Resolved</p>
                                        <p id="mergerMetricAutoResolved" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Safe Auto</p>
                                        <p id="mergerMetricSafeAuto" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric downloads-metric-warn">
                                        <p className="downloads-metric-label">Needs Review</p>
                                        <p id="mergerMetricNeedsReview" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Generated</p>
                                        <p id="mergerMetricGenerated" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric downloads-metric-warn">
                                        <p className="downloads-metric-label">Unresolved</p>
                                        <p id="mergerMetricUnresolved" className="downloads-metric-value">0</p>
                                    </article>
                                </section>
            
                                <section className="merger-main">
                                    <article className="merger-tree-shell">
                                        <header className="merger-tree-header">
                                            <div>
                                                <h3>Conflict Tree</h3>
                                                <p className="muted">Grouped by file type using the current profile load order.</p>
                                            </div>
                                            <span id="mergerConflictTreeCount" className="status-chip status-chip-muted">0
                                                entries</span>
                                        </header>
                                        <div id="mergerConflictTree" className="merger-conflict-tree">
                                            <div className="merger-empty muted">Run an analysis to populate the merger tree.</div>
                                        </div>
                                        <footer className="merger-tree-footer">
                                            <span id="mergerStatus" className="muted">Merger ready.</span>
                                        </footer>
                                    </article>
            
                                    <article id="mergerDetailPanel" className="merger-detail-shell">
                                        <div className="merger-empty muted">Select a merged file entry to inspect the winner, source
                                            mods, and resolution options.</div>
                                    </article>
                                </section>
                            </section>
        </>
    );
}
