import type { ReactElement } from "react";

export function MergerResultsWorkspace(): ReactElement {
    return (
        <section id="mergerResultsWorkspace" className="merger-results-workspace hidden">
            <header className="merger-results-header">
                <div className="merger-results-title">
                    <p className="eyebrow">Merger Results</p>
                    <h2>Resolve and Build</h2>
                    <p className="muted">Review only the files that need attention, then switch to Advanced when you need source-level proof.</p>
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

            <section className="merger-results-overview">
                <article className="merger-results-next-step">
                    <p className="downloads-metric-label">Next step</p>
                    <h3 id="mergerResultsNextStep">Run a scan</h3>
                    <p id="mergerResultsNextStepDetail" className="muted">Analyze enabled mods to see what can be handled automatically and what needs a manual choice.</p>
                </article>
                <section className="merger-results-metrics">
                    <article className="downloads-metric downloads-metric-warn">
                        <p className="downloads-metric-label">Needs action</p>
                        <p id="mergerResultsMetricNeedsAction" className="downloads-metric-value">0</p>
                    </article>
                    <article className="downloads-metric">
                        <p className="downloads-metric-label">Auto ready</p>
                        <p id="mergerResultsMetricSafeAuto" className="downloads-metric-value">0</p>
                    </article>
                    <article className="downloads-metric">
                        <p className="downloads-metric-label">Handled</p>
                        <p id="mergerResultsMetricHandled" className="downloads-metric-value">0</p>
                    </article>
                    <article className="downloads-metric">
                        <p className="downloads-metric-label">Scanned</p>
                        <p id="mergerResultsMetricFiles" className="downloads-metric-value">0</p>
                    </article>
                    <article className="downloads-metric downloads-metric-warn">
                        <p className="downloads-metric-label">Conflicts</p>
                        <p id="mergerResultsMetricConflicts" className="downloads-metric-value">0</p>
                    </article>
                    <article className="downloads-metric downloads-metric-warn">
                        <p className="downloads-metric-label">Needs choice</p>
                        <p id="mergerResultsMetricManual" className="downloads-metric-value">0</p>
                    </article>
                </section>
            </section>

            <section className="merger-results-controls">
                <nav className="merger-results-filters" aria-label="Merger results filters">
                    <button type="button" className="button-secondary is-active" data-merger-results-filter="needs-action">Needs action</button>
                    <button type="button" className="button-secondary" data-merger-results-filter="safe">Auto ready</button>
                    <button type="button" className="button-secondary" data-merger-results-filter="manual">Needs choice</button>
                    <button type="button" className="button-secondary" data-merger-results-filter="resolved">Handled</button>
                </nav>
                <nav className="merger-results-mode-toggle" aria-label="Merger detail mode">
                    <button type="button" className="button-secondary is-active" data-merger-results-mode="review">Review</button>
                    <button type="button" className="button-secondary" data-merger-results-mode="advanced">Advanced</button>
                </nav>
            </section>

            <section className="merger-results-layout">
                <article className="merger-results-list-shell">
                    <header className="merger-results-list-header">
                        <div>
                            <h3>Review Queue</h3>
                            <p className="muted">Prioritized by safe automation, then files needing a choice.</p>
                        </div>
                        <span id="mergerResultsCount" className="status-chip status-chip-muted">0 entries</span>
                    </header>
                    <div id="mergerResultsList" className="merger-results-list">
                        <div className="merger-empty muted">Run a scan to populate merger results.</div>
                    </div>
                </article>
                <article id="mergerResultsDetail" className="merger-results-detail">
                    <div className="merger-empty muted">Select a result to inspect recommendations, source files, and code-level changes.</div>
                </article>
            </section>

            <footer className="merger-results-footer">
                <span id="mergerResultsStatus" className="muted">Merger results ready.</span>
                <span id="mergerResultsOutputPath" className="status-chip status-chip-muted">Output: not built</span>
            </footer>
        </section>
    );
}
