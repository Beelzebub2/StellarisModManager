import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RendererShell } from "./components/RendererShell";
import "./styles.css";

function LegacyRendererRuntime(): null {
    useEffect(() => {
        let cancelled = false;

        async function loadLegacyRenderer(): Promise<void> {
            await import("./installPrerequisites.js");
            await import("./appUpdateState.js");
            await import("./downloadQueueState.js");
            await import("./libraryVisibility.js");
            await import("./promptInputBehavior.js");

            if (!cancelled) {
                await import("./renderer.js");
            }
        }

        void loadLegacyRenderer().catch((error: unknown) => {
            console.error("Failed to load renderer runtime", error);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return null;
}

const runtimeRoot = document.getElementById("reactRuntimeRoot");

if (!runtimeRoot) {
    throw new Error("Missing React renderer runtime root.");
}

createRoot(runtimeRoot).render(
    <>
        <RendererShell />
        <LegacyRendererRuntime />
    </>
);
