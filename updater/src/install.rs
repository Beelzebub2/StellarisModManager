use std::path::Path;
use std::process::Command;

use crate::log;

/// Launches the Inno Setup installer and returns as soon as the process starts.
/// Inno's manifest triggers UAC elevation, so a consent prompt may appear.
pub fn launch(installer_path: &Path) -> Result<(), String> {
    if !installer_path.exists() {
        return Err(format!(
            "installer not found: {}",
            installer_path.display()
        ));
    }

    log::info(&format!("launching installer: {}", installer_path.display()));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP so closing the updater
        // doesn't kill the spawned installer.
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        Command::new(installer_path)
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;
    }

    #[cfg(not(windows))]
    {
        Command::new(installer_path)
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;
    }

    Ok(())
}

pub fn open_in_browser(url: &str) {
    log::info(&format!("opening browser: {url}"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let _ = Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(DETACHED_PROCESS)
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}
