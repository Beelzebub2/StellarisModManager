import { setText } from "./dom.js";
import { state } from "./state.js";

export function setGlobalStatus(text) {
    setText("statusbarText", text);
}

export function setVersionStatus(text) {
    setText("versionStatus", text);
    if (state.selectedTab === "version") setGlobalStatus(text);
}

export function setSettingsStatus(text) {
    setText("settingsStatus", text);
    if (state.selectedTab === "settings") setGlobalStatus(text);
}

export function setLibraryStatus(text) {
    setText("libraryStatus", text);
    if (state.selectedTab === "library") setGlobalStatus(text);
}

export function setMergerStatus(text) {
    setText("mergerStatus", text);
    setText("mergerResultsStatus", text);
    if (state.selectedTab === "merger") setGlobalStatus(text);
}

export function setResultSummary(total, page, pages) {
    setText("resultCountChip", `${total} matches`);
    setText("pageCursorChip", `Page ${page}/${pages}`);
}
