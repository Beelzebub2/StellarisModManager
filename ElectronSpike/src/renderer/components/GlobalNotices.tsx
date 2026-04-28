import type { ReactElement } from "react";

export function GlobalNotices(): ReactElement {
    return (
        <>
            <aside id="modsPathMigrationNotice" className="migration-notice hidden" aria-live="polite">
                        <div className="migration-notice-copy">
                            <strong id="modsPathMigrationNoticeTitle" className="migration-notice-title">Moving managed mods</strong>
                            <span id="modsPathMigrationNoticeMessage" className="migration-notice-message">Working • 0% complete</span>
                        </div>
                        <button id="modsPathMigrationNoticeOpen" type="button" className="button-secondary">Open progress</button>
                    </aside>
            
                    <aside id="mergerProgressNotice" className="merger-progress-notice hidden" aria-live="polite">
                        <div className="merger-progress-notice-copy">
                            <strong id="mergerProgressNoticeTitle" className="merger-progress-notice-title">Merger working</strong>
                            <span id="mergerProgressNoticeMessage" className="merger-progress-notice-message">Preparing • 0%
                                complete</span>
                        </div>
                        <button id="mergerProgressNoticeOpen" type="button" className="button-secondary">Open progress</button>
                    </aside>
            
                    <aside id="downloadFailureNotice" className="download-failure-notice hidden" aria-live="polite">
                        <div className="download-failure-notice-copy">
                            <strong id="downloadFailureNoticeTitle" className="download-failure-notice-title">Download failed</strong>
                            <span id="downloadFailureNoticeMessage" className="download-failure-notice-message">Open Downloads for
                                details.</span>
                        </div>
                        <button id="downloadFailureNoticeOpen" type="button" className="button-secondary">Open downloads</button>
                    </aside>
        </>
    );
}
