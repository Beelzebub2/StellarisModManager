import type { ReactElement } from "react";

export function DownloadsPage(): ReactElement {
    return (
        <>
            {/* ======== DOWNLOADS PAGE ======== */}
                            <section id="pageDownloads" className="page-section hidden">
                                <header className="downloads-header">
                                    <div>
                                        <p className="eyebrow">Downloads</p>
                                        <h2>Operations Dashboard</h2>
                                        <p className="muted">See what is active now, what is waiting, and what needs attention.</p>
                                    </div>
                                    <div className="downloads-header-actions">
                                        <button id="queueCancelAll" className="button-secondary queue-tool-btn" type="button">Cancel
                                            all</button>
                                        <button id="queueClearFinished" className="button-secondary queue-tool-btn" type="button">Clear
                                            finished</button>
                                    </div>
                                </header>
            
                                <section className="downloads-metrics">
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Running</p>
                                        <p id="queueMetricRunning" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Queued</p>
                                        <p id="queueMetricQueued" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric">
                                        <p className="downloads-metric-label">Finished</p>
                                        <p id="queueMetricFinished" className="downloads-metric-value">0</p>
                                    </article>
                                    <article className="downloads-metric downloads-metric-warn">
                                        <p className="downloads-metric-label">Failed</p>
                                        <p id="queueMetricFailed" className="downloads-metric-value">0</p>
                                    </article>
                                </section>
            
                                <section className="downloads-overview">
                                    <div className="queue-head">
                                        <p className="sidebar-title">Queue Overview</p>
                                        <span id="queueLoadChip" className="status-chip status-chip-muted">Idle</span>
                                    </div>
                                    <p id="queueSummary" className="muted">No active installs.</p>
                                    <div className="queue-overall">
                                        <div className="queue-overall-progress"><span id="queueOverallBar"></span></div>
                                        <p id="queueOverallLabel" className="muted queue-overall-label">No queue activity.</p>
                                    </div>
                                    <p id="queueLastUpdated" className="muted downloads-last-updated">Last update: never</p>
                                </section>
            
                                <section className="downloads-columns">
                                    <section className="downloads-list-shell">
                                        <div className="queue-head">
                                            <p className="sidebar-title">Active Now</p>
                                            <span id="queueActiveCountChip" className="status-chip status-chip-muted">0 active</span>
                                        </div>
                                        <p id="queueActiveSummary" className="muted downloads-section-copy">No active operations.</p>
                                        <div id="queueActiveList" className="queue-list" aria-live="polite"></div>
                                    </section>
            
                                    <section className="downloads-list-shell downloads-history-shell">
                                        <div className="queue-head">
                                            <p className="sidebar-title">Recent History</p>
                                            <span id="queueHistoryCountChip" className="status-chip status-chip-muted">0 recent</span>
                                        </div>
                                        <p id="queueHistorySummary" className="muted downloads-section-copy">No recent history yet.</p>
                                        <div id="queueHistoryList" className="queue-list" aria-live="polite"></div>
                                    </section>
                                </section>
                            </section>
        </>
    );
}
