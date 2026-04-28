import type { ReactElement } from "react";

export function VersionBrowserPage(): ReactElement {
    return (
        <section id="pageVersion" className="page-section">
            <header className="version-header">
                <div>
                    <p className="eyebrow">Version Browser</p>
                    <h2>Find Compatible Mods Faster</h2>
                </div>
                <div className="version-header-right">
                    <span id="resultCountChip" className="status-chip">0 matches</span>
                    <span id="pageCursorChip" className="status-chip status-chip-muted">Page 1/1</span>
                </div>
            </header>

            <section className="version-toolbar-shell">
                <div className="controls-shell">
                    <div className="controls-row">
                        <div className="field-col">
                            <label className="field-label" htmlFor="versionSelect">Game Version</label>
                            <select id="versionSelect" className="field-input"></select>
                        </div>
                        <div className="field-col">
                            <label className="field-label" htmlFor="sortSelect">Ranking</label>
                            <select id="sortSelect" className="field-input">
                                <option value="relevance">Relevance</option>
                                <option value="most-subscribed">Most Subscribed</option>
                                <option value="most-popular">Most Popular</option>
                            </select>
                        </div>
                        <label className="toggle-row" htmlFor="showOlderVersions">
                            <input id="showOlderVersions" type="checkbox" />
                            <span>Include older versions</span>
                        </label>
                        <div className="field-col grow">
                            <label className="field-label" htmlFor="searchInput">Search Mods</label>
                            <div className="search-wrap">
                                <input
                                    id="searchInput"
                                    className="field-input"
                                    type="text"
                                    placeholder="Search by mod name or workshop ID"
                                />
                                <button id="searchClear" type="button" className="button-tertiary">Clear</button>
                            </div>
                        </div>
                        <button id="versionRefresh" type="button" className="button-secondary">Refresh</button>
                    </div>
                    <div className="version-toolbar-meta">
                        <p id="versionStatus" className="muted">Loading version browser...</p>
                    </div>
                </div>
            </section>

            <section id="versionCards" className="card-grid"></section>

            <footer className="pager">
                <button id="pagePrev" type="button" className="button-secondary">Previous</button>
                <span id="pageSummary">Page 1 of 1</span>
                <button id="pageNext" type="button">Next</button>
            </footer>
        </section>
    );
}
