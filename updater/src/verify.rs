use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::events::UpdateEvent;

const BUFFER: usize = 256 * 1024;

pub fn sha256_file(
    path: &Path,
    total_bytes: u64,
    cancel: Arc<AtomicBool>,
    tx: Sender<UpdateEvent>,
) -> Result<String, String> {
    let file = File::open(path).map_err(|e| format!("open for hash: {e}"))?;
    let mut reader = BufReader::with_capacity(BUFFER, file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; BUFFER];
    let mut done: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let n = reader.read(&mut buf).map_err(|e| format!("hash read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        done += n as u64;
        let now = std::time::Instant::now();
        if now.duration_since(last_tick).as_millis() > 100 {
            last_tick = now;
            let pct = if total_bytes > 0 {
                (done as f32) / (total_bytes as f32)
            } else {
                0.0
            };
            let _ = tx.send(UpdateEvent::VerifyProgress(pct));
        }
    }
    let _ = tx.send(UpdateEvent::VerifyProgress(1.0));
    Ok(hex::encode(hasher.finalize()))
}

pub fn matches(actual: &str, expected: &str) -> bool {
    let a = actual.trim().to_ascii_lowercase();
    let b = expected.trim().to_ascii_lowercase();
    // Constant-time-ish compare: same length, byte-equal
    a.len() == b.len() && a.as_bytes().iter().zip(b.as_bytes()).all(|(x, y)| x == y)
}
