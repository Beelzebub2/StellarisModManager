use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;

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

    let dest_dir: PathBuf = std::env::temp_dir().join("StellarisModManager-Updates");

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
            download::cleanup_partial(&dest_dir, &version);
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
                    let _ = std::fs::remove_file(&dl.file_path);
                    let _ = tx.send(UpdateEvent::Failed(
                        "Downloaded installer failed integrity check.".into(),
                    ));
                    return;
                }
                log::info(&format!("sha256 verified: {actual}"));
            }
            Err(e) => {
                log::error(&format!("hash computation failed: {e}"));
                let _ = tx.send(UpdateEvent::Failed(format!(
                    "Could not verify installer: {e}"
                )));
                return;
            }
        }
    } else {
        log::warn("no sha256 supplied; skipping integrity check");
    }

    let _ = tx.send(UpdateEvent::Phase(Phase::Launching));
    std::thread::sleep(std::time::Duration::from_millis(500));
    match install::launch(&dl.file_path) {
        Ok(()) => {
            let _ = tx.send(UpdateEvent::Done);
        }
        Err(e) => {
            log::error(&format!("installer launch failed: {e}"));
            let _ = tx.send(UpdateEvent::Failed(e));
        }
    }
}
