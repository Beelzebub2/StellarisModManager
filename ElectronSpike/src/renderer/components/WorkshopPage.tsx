import type { ReactElement } from "react";

export function WorkshopPage(): ReactElement {
    return (
        <>
            {/* ======== WORKSHOP PAGE ======== */}
                            <section id="pageWorkshop" className="page-section hidden">
                                <header className="workshop-toolbar">
                                    <button id="workshopBack" type="button" className="button-icon" title="Back"><span
                                            data-icon="back"></span></button>
                                    <button id="workshopForward" type="button" className="button-icon" title="Forward"><span
                                            data-icon="forward"></span></button>
                                    <button id="workshopRefresh" type="button" className="button-icon" title="Refresh"><span
                                            data-icon="refresh"></span></button>
                                    <button id="workshopHome" type="button" className="button-icon" title="Home"><span
                                            data-icon="home"></span></button>
                                    <input id="workshopUrl" className="field-input workshop-url" type="text"
                                        defaultValue="https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems&days=90" />
                                    <button id="workshopGo" type="button" className="button-secondary">Go</button>
                                </header>
            
                                <div id="workshopBrowserContainer" className="workshop-browser-container">
                                    <div id="workshopLoading" className="workshop-loading">
                                        <div className="workshop-loading-bar"></div>
                                    </div>
                                    <webview id="workshopWebview"
                                        src="https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems&days=90"
                                        className="workshop-webview" partition="persist:workshop" preload="../webviewPreload.js"
                                        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36">
                                    </webview>
                                </div>
            
                                <footer className="workshop-footer">
                                    <span className="muted">Workshop browser powered by Electron's built-in Chromium engine.</span>
                                </footer>
                            </section>
        </>
    );
}
