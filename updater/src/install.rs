use std::path::{Path, PathBuf};
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

    let log_path = installer_log_path(installer_path);
    log::info(&format!(
        "launching installer in background mode: {} (log={})",
        installer_path.display(),
        log_path.display()
    ));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

        let child = Command::new(installer_path)
            .args([
                "/VERYSILENT",
                "/NORESTART",
                "/CLOSEAPPLICATIONS",
                "/SUPPRESSMSGBOXES",
                "/SP-",
                &format!("/LOG={}", log_path.display()),
            ])
            .current_dir(
                installer_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
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
            .current_dir(
                installer_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
            .spawn()
            .map_err(|e| format!("failed to launch installer: {e}"))?;

        Ok(InstallerProcess {
            child,
            started: Instant::now(),
        })
    }
}

pub fn installer_log_path(installer_path: &Path) -> PathBuf {
    let installer_dir = installer_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::create_dir_all(&installer_dir);
    installer_dir.join("installer-run.log")
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

pub fn try_start_app(app_exe_path: &Path) -> Result<(), String> {
    if !app_exe_path.exists() {
        return Err(format!(
            "app executable not found: {}",
            app_exe_path.display()
        ));
    }

    log::info(&format!("relaunching app: {}", app_exe_path.display()));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

        Command::new(app_exe_path)
            .current_dir(app_exe_path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("failed to relaunch app: {e}"))?;

        return Ok(());
    }

    #[cfg(not(windows))]
    {
        Command::new(app_exe_path)
            .current_dir(app_exe_path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("failed to relaunch app: {e}"))
    }
}

pub fn try_delete_file(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {
            log::info(&format!("deleted file: {}", path.display()));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::warn(&format!("failed to delete {}: {e}", path.display()));
        }
    }
}

pub fn schedule_self_delete(cleanup_root: &Path) {
    let Ok(self_path) = std::env::current_exe() else {
        return;
    };

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let escaped_self = self_path.display().to_string().replace('"', "\"\"");
        let escaped_root = cleanup_root.display().to_string().replace('"', "\"\"");
        let command = format!(
            "/C timeout /t 2 /nobreak >nul & del /f /q \"{escaped_self}\" & rmdir /s /q \"{escaped_root}\""
        );

        let _ = Command::new("cmd.exe")
            .arg(command)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("sh")
            .args([
                "-c",
                &format!(
                    "sleep 2; rm -f '{}' ; rm -rf '{}'",
                    self_path.display(),
                    cleanup_root.display()
                ),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
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
