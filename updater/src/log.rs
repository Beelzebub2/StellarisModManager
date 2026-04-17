use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static WRITER: Mutex<Option<std::fs::File>> = Mutex::new(None);

pub fn init() {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        if let Ok(mut w) = WRITER.lock() {
            *w = Some(file);
        }
    }
    write_line("info", &format!("updater started (pid={})", std::process::id()));
}

pub fn log_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("StellarisModManager")
        .join("updater.log")
}

pub fn info(msg: &str) {
    write_line("info", msg);
}

pub fn warn(msg: &str) {
    write_line("warn", msg);
}

pub fn error(msg: &str) {
    write_line("error", msg);
}

fn write_line(level: &str, msg: &str) {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{stamp}] [{level:>5}] {msg}\n");
    eprint!("{line}");
    if let Ok(mut guard) = WRITER.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = file.write_all(line.as_bytes());
        }
    }
}
