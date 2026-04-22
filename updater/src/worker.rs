use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;

use crate::artifacts::{CleanupOutcome, UpdateArtifacts};
use crate::cli::Cli;
use crate::download::{self, DownloadRequest};
use crate::events::{Phase, UpdateEvent};
use crate::install;
use crate::log;
use crate::verify;

pub struct WorkerHandle {
    pub cancel: Arc<AtomicBool>,
    pub _join: thread::JoinHandle<()>,
}

pub fn spawn_real(cli: Cli, tx: Sender<UpdateEvent>) -> WorkerHandle {
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_worker = cancel.clone();
    let join = thread::spawn(move || {
        run(cli, tx, cancel_worker);
    });
    WorkerHandle { cancel, _join: join }
}

fn run(cli: Cli, tx: Sender<UpdateEvent>, cancel: Arc<AtomicBool>) {
    let url = match cli.url.as_ref() {
        Some(u) => u.clone(),
        None => {
            let _ = tx.send(UpdateEvent::Failed("missing --url".into()));
            return;
        }
    };
    let version = cli.version.clone().unwrap_or_else(|| "unknown".into());
    let artifacts = UpdateArtifacts::for_version(&version);
    let dest_dir = artifacts.download_dir().to_path_buf();

    let req = DownloadRequest {
        url,
        dest_dir: dest_dir.clone(),
        version: version.clone(),
    };

    let result = download::run(req, cancel.clone(), tx.clone());
    let dl = match result {
        Ok(d) => d,
        Err(e) => {
            log::error(&format!("download failed: {e}"));
            artifacts.cleanup(CleanupOutcome::Failure {
                keep_installer: false,
            });
            let _ = tx.send(UpdateEvent::Failed(e));
            return;
        }
    };

    if let Some(expected) = cli.sha256.as_deref() {
        let _ = tx.send(UpdateEvent::Phase(Phase::Verifying));
        match verify::sha256_file(&dl.file_path, dl.total_bytes, cancel.clone(), tx.clone()) {
            Ok(actual) => {
                if !verify::matches(&actual, expected) {
                    log::error(&format!(
                        "sha256 mismatch: expected {expected}, got {actual}"
                    ));
                    artifacts.cleanup(CleanupOutcome::Failure {
                        keep_installer: false,
                    });
                    let _ = tx.send(UpdateEvent::Failed(
                        "Downloaded installer failed integrity check.".into(),
                    ));
                    return;
                }
                log::info(&format!("sha256 verified: {actual}"));
            }
            Err(e) => {
                log::error(&format!("hash computation failed: {e}"));
                artifacts.cleanup(CleanupOutcome::Failure {
                    keep_installer: false,
                });
                let _ = tx.send(UpdateEvent::Failed(format!(
                    "Could not verify installer: {e}"
                )));
                return;
            }
        }
    } else {
        log::warn("no sha256 supplied; skipping integrity check");
    }

    // Wait for the main app process to exit before invoking the installer.
    // If the exe is still locked when Inno Setup tries to replace it, Windows
    // file-locking will cause the installation to silently fail and the user
    // will relaunch into the old binary.  We block here (up to 15 s) until
    // the PID disappears, then give the OS a brief moment to fully release
    // all file handles before touching the directory.
    if let Some(pid) = cli.app_pid {
        let _ = tx.send(UpdateEvent::Phase(Phase::WaitingForApp));
        log::info(&format!(
            "waiting for app PID {pid} to exit before running installer…"
        ));
        install::wait_for_pid_exit(pid, 15_000);
        log::info("app process exited (or timed out); proceeding with installer");
    }

    // Small buffer after PID exit to let the OS flush any pending file handles.
    std::thread::sleep(std::time::Duration::from_millis(400));

    let _ = tx.send(UpdateEvent::Phase(Phase::Launching));
    let mut installer = match install::launch_background(&dl.file_path) {
        Ok(p) => p,
        Err(e) => {
            log::error(&format!("installer launch failed: {e}"));
            artifacts.cleanup(CleanupOutcome::Failure {
                keep_installer: true,
            });
            let _ = tx.send(UpdateEvent::Failed(format!(
                "{e} The installer was kept at {}.",
                artifacts.installer_path().display()
            )));
            return;
        }
    };

    let _ = tx.send(UpdateEvent::Phase(Phase::Installing));
    let wait_result = installer.wait_with_progress(&cancel, |elapsed_secs| {
        let _ = tx.send(UpdateEvent::ActivityTick {
            phase: Phase::Installing,
            elapsed_secs,
        });
    });

    match wait_result {
        Ok(0) => {
            if let Some(app_exe) = cli.app_exe.as_deref() {
                let _ = tx.send(UpdateEvent::Phase(Phase::Relaunching));
                let app_path = PathBuf::from(app_exe);
                if let Err(e) = install::try_start_app(&app_path) {
                    log::error(&format!("app relaunch failed: {e}"));
                    artifacts.cleanup(CleanupOutcome::Success);
                    let _ = tx.send(UpdateEvent::Failed(
                        "Update installed, but relaunch failed. Start the app manually.".into(),
                    ));
                    return;
                }
            }

            let _ = tx.send(UpdateEvent::Phase(Phase::CleaningUp));
            artifacts.cleanup(CleanupOutcome::Success);
            let _ = tx.send(UpdateEvent::Done);
        }
        Ok(code) => {
            artifacts.cleanup(CleanupOutcome::Failure {
                keep_installer: true,
            });
            let msg = format!(
                "Installer exited with code {code}. The installer was kept at {}.",
                artifacts.installer_path().display()
            );
            log::error(&msg);
            let _ = tx.send(UpdateEvent::Failed(msg));
        }
        Err(e) => {
            log::error(&format!("installer execution failed: {e}"));
            artifacts.cleanup(CleanupOutcome::Failure {
                keep_installer: true,
            });
            let _ = tx.send(UpdateEvent::Failed(format!(
                "{e} The installer was kept at {}.",
                artifacts.installer_path().display()
            )));
        }
    }
}
