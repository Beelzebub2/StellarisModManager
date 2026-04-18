use clap::{Parser, ValueEnum};

#[derive(Parser, Debug, Clone)]
#[command(
    name = "smm-updater",
    about = "Stellaris Mod Manager native update companion",
    version
)]
pub struct Cli {
    /// Download URL of the installer (required unless --demo).
    #[arg(long)]
    pub url: Option<String>,

    /// Version being installed (used for display).
    #[arg(long)]
    pub version: Option<String>,

    /// Expected SHA-256 of the installer, hex (optional).
    #[arg(long)]
    pub sha256: Option<String>,

    /// Public release page to open on manual-download fallback.
    #[arg(long)]
    pub release_url: Option<String>,

    /// App executable to relaunch after a successful update.
    #[arg(long)]
    pub app_exe: Option<String>,

    /// Temporary updater root to delete after this process exits.
    #[arg(long)]
    pub cleanup_root: Option<String>,

    /// Run a simulated lifecycle instead of downloading.
    #[arg(long, default_value_t = false)]
    pub demo: bool,

    /// Pin a specific UI phase (requires --demo).
    #[arg(long, value_enum)]
    pub phase: Option<DemoPhase>,

    /// Demo-mode speed multiplier.
    #[arg(long, default_value_t = 1.0)]
    pub demo_speed: f32,
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum DemoPhase {
    Connecting,
    Downloading,
    Verifying,
    Launching,
    Installing,
    Done,
    Failed,
}

impl Cli {
    pub fn validate(&self) -> Result<(), String> {
        if self.demo {
            return Ok(());
        }
        if self.url.is_none() {
            return Err("--url is required (or use --demo)".into());
        }
        if self.version.is_none() {
            return Err("--version is required (or use --demo)".into());
        }
        Ok(())
    }
}
