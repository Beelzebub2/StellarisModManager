//! Events sent from worker threads to the UI thread.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Connecting,
    Downloading,
    Verifying,
    WaitingForApp,
    Launching,
    Installing,
    Relaunching,
    CleaningUp,
}

#[derive(Debug, Clone)]
pub enum UpdateEvent {
    Phase(Phase),
    DownloadProgress {
        downloaded: u64,
        total: u64,
        bytes_per_sec: f64,
        eta_secs: u64,
    },
    VerifyProgress {
        checked: u64,
        total: u64,
    },
    ActivityTick {
        phase: Phase,
        elapsed_secs: u64,
    },
    Done,
    Failed(String),
}
