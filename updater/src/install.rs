use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use crate::log;

pub struct InstallerProcess {
    child: Child,
    started: Instant,
}

/// Launches the Inno Setup installer in silent mode and returns a process handle.
/// Inno's manifest still triggers UAC elevation when required.
pub fn launch_background(installer_path: &Path) -> Result<InstallerProcess, String> {
    if !installer_path.exists() {
        return Err(format!(
            "installer not found: {}",
            installer_path.display()
        ));
    }

    log::info(&format!(
        "launching installer in background mode: {}",
        installer_path.display()
    ));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_PROCESS_GROUP keeps installer independent from updater lifecycle.
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

        let child = Command::new(installer_path)
            .args([
                "/VERYSILENT",
                "/NORESTART",
                "/CLOSEAPPLICATIONS",
                "/FORCECLOSEAPPLICATIONS",
                "/SUPPRESSMSGBOXES",
                "/SP-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;

        return Ok(InstallerProcess {
            child,
            started: Instant::now(),
        });
    }

    #[cfg(not(windows))]
    {
        let child = Command::new(installer_path)
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;

        Ok(InstallerProcess {
            child,
            started: Instant::now(),
        })
    }
}

impl InstallerProcess {
    pub fn wait_with_progress<F>(
        &mut self,
        cancel: &AtomicBool,
        mut on_tick: F,
    ) -> Result<i32, String>
    where
        F: FnMut(u64),
    {
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = self.child.kill();
                return Err("Update cancelled.".into());
            }

            match self.child.try_wait() {
                Ok(Some(status)) => {
                    return Ok(status.code().unwrap_or(0));
                }
                Ok(None) => {
                    on_tick(self.started.elapsed().as_secs());
                    thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    return Err(format!("failed while waiting for installer: {e}"));
                }
            }
        }
    }
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
