import type { ReactElement } from "react";

export function MergerResultsWorkspace(): ReactElement {
    return (
        <>
            <section id="mergerResultsWorkspace" className="merger-results-workspace hidden">
                        <header className="merger-results-header">
                            <div>
                                <p className="eyebrow">Merger Results</p>
                                <h2>Review Conflicts</h2>
                            </div>
                            <div className="merger-results-actions">
                                <button id="mergerResultsScanBtn" type="button">
                                    <span className="nav-icon" data-icon="refresh"></span> Scan
                                </button>
                                <button id="mergerResultsAutoBtn" type="button" className="button-secondary">
                                    <span className="nav-icon" data-icon="sparkles"></span> Auto Control
                                </button>
                                <button id="mergerResultsBuildBtn" type="button" className="button-secondary">
                                    <span className="nav-icon" data-icon="merge"></span> Build
                                </button>
                            </div>
                        </header>
                        <section className="merger-results-metrics downloads-metrics">
                            <article className="downloads-metric">
                                <p className="downloads-metric-label">Scanned Files</p>
                                <p id="mergerResultsMetricFiles" className="downloads-metric-value">0</p>
                            </article>
                            <article className="downloads-metric downloads-metric-warn">
                                <p className="downloads-metric-label">Conflicts Found</p>
                                <p id="mergerResultsMetricConflicts" className="downloads-metric-value">0</p>
                            </article>
                            <article className="downloads-metric">
                                <p className="downloads-metric-label">Auto Ready</p>
                                <p id="mergerResultsMetricSafeAuto" className="downloads-metric-value">0</p>
                            </article>
                            <article className="downloads-metric downloads-metric-warn">
                                <p className="downloads-metric-label">Needs Choice</p>
                                <p id="mergerResultsMetricManual" className="downloads-metric-value">0</p>
                            </article>
                        </section>
                        <nav className="merger-results-filters" aria-label="Merger results filters">
                            <button type="button" className="button-secondary is-active" data-merger-results-filter="needs-action">Needs action</button>
                            <button type="button" className="button-secondary" data-merger-results-filter="safe">Auto ready</button>
                            <button type="button" className="button-secondary" data-merger-results-filter="manual">Needs choice</button>
                            <button type="button" className="button-secondary" data-merger-results-filter="resolved">Handled</button>
                        </nav>
                        <section className="merger-results-layout">
                            <article className="merger-results-list-shell">
                                <header className="merger-results-list-header">
                                    <h3>Files</h3>
                                    <span id="mergerResultsCount" className="status-chip status-chip-muted">0 entries</span>
                                </header>
                                <div id="mergerResultsList" className="merger-results-list">
                                    <div className="merger-empty muted">Run a scan to populate merger results.</div>
                                </div>
                            </article>
                            <article id="mergerResultsDetail" className="merger-results-detail">
                                <div className="merger-empty muted">Select a result to inspect automation criteria and source files.</div>
                            </article>
                        </section>
                        <footer className="merger-results-footer">
                            <span id="mergerResultsStatus" className="muted">Merger results ready.</span>
                            <span id="mergerResultsOutputPath" className="status-chip status-chip-muted">Output: not built</span>
                        </footer>
                    </section>
        </>
    );
}
