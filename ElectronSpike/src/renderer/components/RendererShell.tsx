import type { ReactElement } from "react";
import { AppTooltip } from "./AppTooltip";
import { DetailDrawer } from "./DetailDrawer";
import { DownloadsPage } from "./DownloadsPage";
import { GlobalNotices } from "./GlobalNotices";
import { LibraryPage } from "./LibraryPage";
import { MergerPage } from "./MergerPage";
import { MergerResultsWorkspace } from "./MergerResultsWorkspace";
import { ModalSystem } from "./ModalSystem";
import { SettingsPage } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { Statusbar } from "./Statusbar";
import { Topbar } from "./Topbar";
import { UpdatePopup } from "./UpdatePopup";
import { VersionBrowserPage } from "./VersionBrowserPage";
import { WorkshopPage } from "./WorkshopPage";

export function RendererShell(): ReactElement {
    return (
        <>
            <div className="aurora aurora-one" aria-hidden="true"></div>
            <div className="aurora aurora-two" aria-hidden="true"></div>

            <main className="window-shell">
                <div id="mergerResultsDragRegion" className="merger-results-drag-region" aria-hidden="true"></div>

                <Topbar />
                <UpdatePopup />
                <GlobalNotices />

                <section className="workspace">
                    <Sidebar />

                    <section className="content">
                        <VersionBrowserPage />
                        <LibraryPage />
                        <MergerPage />
                        <DownloadsPage />
                        <WorkshopPage />
                        <SettingsPage />
                    </section>
                </section>

                <MergerResultsWorkspace />
                <Statusbar />
            </main>

            <DetailDrawer />
            <ModalSystem />
            <AppTooltip />
        </>
    );
}
