//! Events sent from worker threads to the UI thread.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Connecting,
    Downloading,
    Verifying,
    Launching,
    Installing,
}

#[derive(Debug, Clone)]
pub enum UpdateEvent {
    Phase(Phase),
    Progress {
        downloaded: u64,
        total: u64,
        bytes_per_sec: f64,
        eta_secs: u64,
    },
    VerifyProgress(f32),
    InstallProgress {
        progress: f32,
        elapsed_secs: u64,
    },
    Done,
    Failed(String),
}
