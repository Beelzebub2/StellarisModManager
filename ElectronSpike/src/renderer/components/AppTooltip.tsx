import type { ReactElement } from "react";

export function AppTooltip(): ReactElement {
    return (
        <>
            <div id="appTooltip" className="app-tooltip" role="tooltip" aria-hidden="true"></div>
        </>
    );
}
