use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::cli::{Cli, DemoPhase};
use crate::events::{Phase, UpdateEvent};
use crate::worker::WorkerHandle;

const FAKE_TOTAL: u64 = 128 * 1024 * 1024; // pretend a 128 MB installer

pub fn spawn(cli: Cli, tx: Sender<UpdateEvent>) -> WorkerHandle {
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_worker = cancel.clone();
    let join = thread::spawn(move || {
        run(cli, tx, cancel_worker);
    });
    WorkerHandle { cancel, _join: join }
}

fn run(cli: Cli, tx: Sender<UpdateEvent>, cancel: Arc<AtomicBool>) {
    let speed = cli.demo_speed.max(0.05);
    let scale = |ms: u64| Duration::from_millis(((ms as f32) / speed) as u64);

    // Fast-path: if a specific phase is pinned, freeze on it forever so
    // designers can screenshot each state.
    if let Some(phase) = cli.phase {
        return pin_phase(phase, tx, cancel);
    }

    // Connecting (2s)
    let _ = tx.send(UpdateEvent::Phase(Phase::Connecting));
    sleep_cancellable(scale(2000), &cancel);
    if cancel.load(Ordering::Relaxed) {
        return;
    }

    // Downloading (~8s, progress ticks)
    let _ = tx.send(UpdateEvent::Phase(Phase::Downloading));
    let steps = 80u64;
    for i in 0..=steps {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let done = (FAKE_TOTAL * i) / steps;
        let bps = (FAKE_TOTAL as f64) / 8.0; // 8s total
        let eta = if i == steps {
            0
        } else {
            ((8.0 * (steps - i) as f64) / steps as f64) as u64
        };
        let _ = tx.send(UpdateEvent::Progress {
            downloaded: done,
            total: FAKE_TOTAL,
            bytes_per_sec: bps,
            eta_secs: eta,
        });
        sleep_cancellable(scale(100), &cancel);
    }

    // Verifying (1s)
    let _ = tx.send(UpdateEvent::Phase(Phase::Verifying));
    let vsteps = 20u64;
    for i in 0..=vsteps {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let _ = tx.send(UpdateEvent::VerifyProgress((i as f32) / (vsteps as f32)));
        sleep_cancellable(scale(50), &cancel);
    }

    // Launching (1s)
    let _ = tx.send(UpdateEvent::Phase(Phase::Launching));
    sleep_cancellable(scale(1000), &cancel);

    let _ = tx.send(UpdateEvent::Done);
}

fn pin_phase(phase: DemoPhase, tx: Sender<UpdateEvent>, cancel: Arc<AtomicBool>) {
    match phase {
        DemoPhase::Connecting => {
            let _ = tx.send(UpdateEvent::Phase(Phase::Connecting));
        }
        DemoPhase::Downloading => {
            let _ = tx.send(UpdateEvent::Phase(Phase::Downloading));
            let _ = tx.send(UpdateEvent::Progress {
                downloaded: FAKE_TOTAL / 3,
                total: FAKE_TOTAL,
                bytes_per_sec: 8.0 * 1_048_576.0,
                eta_secs: 12,
            });
        }
        DemoPhase::Verifying => {
            let _ = tx.send(UpdateEvent::Phase(Phase::Verifying));
            let _ = tx.send(UpdateEvent::VerifyProgress(0.6));
        }
        DemoPhase::Launching => {
            let _ = tx.send(UpdateEvent::Phase(Phase::Launching));
        }
        DemoPhase::Done => {
            let _ = tx.send(UpdateEvent::Done);
        }
        DemoPhase::Failed => {
            let _ = tx.send(UpdateEvent::Failed(
                "Demo failure: network unreachable (this is a UI preview).".into(),
            ));
        }
    }
    // Keep the thread alive so the UI keeps rendering the pinned state.
    while !cancel.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn sleep_cancellable(total: Duration, cancel: &AtomicBool) {
    let step = Duration::from_millis(25);
    let mut elapsed = Duration::ZERO;
    while elapsed < total {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        std::thread::sleep(step.min(total - elapsed));
        elapsed += step;
    }
}
