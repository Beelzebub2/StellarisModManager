use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::events::{Phase, UpdateEvent};
use crate::log;

const NUM_CHUNKS: u64 = 4;
const MIN_PARALLEL_SIZE: u64 = 8 * 1024 * 1024; // don't bother splitting <8 MB
const CHUNK_MAX_RETRIES: u32 = 3;
const READ_BUFFER_BYTES: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

pub struct DownloadRequest {
    pub url: String,
    pub dest_dir: PathBuf,
    pub version: String,
}

pub struct DownloadResult {
    pub file_path: PathBuf,
    pub total_bytes: u64,
}

pub fn run(
    req: DownloadRequest,
    cancel: Arc<AtomicBool>,
    tx: Sender<UpdateEvent>,
) -> Result<DownloadResult, String> {
    std::fs::create_dir_all(&req.dest_dir).map_err(|e| format!("create dest dir: {e}"))?;

    let file_name = format!("StellarisModManager-Setup-{}.exe", req.version);
    let final_path = req.dest_dir.join(&file_name);
    let part_path = req.dest_dir.join(format!("{file_name}.part"));

    let _ = tx.send(UpdateEvent::Phase(Phase::Connecting));

    let agent = build_agent();
    let (total_bytes, accepts_ranges) = probe(&agent, &req.url)?;
    log::info(&format!(
        "probed {}: size={}, ranges={}",
        req.url, total_bytes, accepts_ranges
    ));

    if total_bytes == 0 {
        return Err("server did not report content length".into());
    }

    // If the finalized file already exists with the right size, short-circuit.
    if final_path.exists() {
        if let Ok(meta) = std::fs::metadata(&final_path) {
            if meta.len() == total_bytes {
                log::info("destination file already present with expected size; skipping download");
                let _ = tx.send(UpdateEvent::Progress {
                    downloaded: total_bytes,
                    total: total_bytes,
                    bytes_per_sec: 0.0,
                    eta_secs: 0,
                });
                return Ok(DownloadResult {
                    file_path: final_path,
                    total_bytes,
                });
            }
        }
        // Size mismatch — remove and re-download.
        let _ = std::fs::remove_file(&final_path);
    }

    // Pre-allocate the .part file to full size so chunks can seek-write.
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&part_path)
        .map_err(|e| format!("open part file: {e}"))?;
    file.set_len(total_bytes)
        .map_err(|e| format!("allocate part file: {e}"))?;
    let file = Arc::new(Mutex::new(file));

    let downloaded = Arc::new(AtomicU64::new(0));
    let _ = tx.send(UpdateEvent::Phase(Phase::Downloading));

    let start = Instant::now();

    // Progress reporter thread
    let stop_progress = Arc::new(AtomicBool::new(false));
    let downloaded_rp = downloaded.clone();
    let tx_rp = tx.clone();
    let stop_progress_rp = stop_progress.clone();
    let cancel_rp = cancel.clone();
    let progress_handle = thread::spawn(move || {
        let mut last_dl: u64 = 0;
        let mut last_tick = Instant::now();
        let mut sent_eof = false;
        loop {
            if cancel_rp.load(Ordering::Relaxed) || stop_progress_rp.load(Ordering::Relaxed) {
                break;
            }
            thread::sleep(Duration::from_millis(120));
            let now = Instant::now();
            let dl = downloaded_rp.load(Ordering::Relaxed);
            let dt = now.duration_since(last_tick).as_secs_f64().max(0.001);
            let bps = ((dl.saturating_sub(last_dl)) as f64) / dt;
            let remaining = total_bytes.saturating_sub(dl);
            let eta = if bps > 1.0 { (remaining as f64 / bps) as u64 } else { 0 };
            let _ = tx_rp.send(UpdateEvent::Progress {
                downloaded: dl,
                total: total_bytes,
                bytes_per_sec: bps,
                eta_secs: eta,
            });
            last_dl = dl;
            last_tick = now;
            if dl >= total_bytes {
                sent_eof = true;
                break;
            }
        }
        if !sent_eof {
            let dl = downloaded_rp.load(Ordering::Relaxed);
            let _ = tx_rp.send(UpdateEvent::Progress {
                downloaded: dl,
                total: total_bytes,
                bytes_per_sec: 0.0,
                eta_secs: 0,
            });
        }
    });

    let mut chunk_errors: Vec<String> = Vec::new();

    if accepts_ranges && total_bytes >= MIN_PARALLEL_SIZE {
        let ranges = split_ranges(total_bytes, NUM_CHUNKS);
        let mut handles = Vec::new();
        for (idx, (start_b, end_b)) in ranges.into_iter().enumerate() {
            let url = req.url.clone();
            let file = file.clone();
            let downloaded = downloaded.clone();
            let cancel = cancel.clone();
            let agent = agent.clone();
            handles.push(thread::spawn(move || {
                download_range(&agent, &url, start_b, end_b, file, downloaded, cancel, idx)
            }));
        }
        for h in handles {
            match h.join() {
                Ok(Ok(())) => {}
                Ok(Err(e)) => chunk_errors.push(e),
                Err(_) => chunk_errors.push("chunk thread panicked".into()),
            }
        }
    } else {
        // Single-stream fallback
        if let Err(e) = download_range(
            &agent,
            &req.url,
            0,
            total_bytes - 1,
            file.clone(),
            downloaded.clone(),
            cancel.clone(),
            0,
        ) {
            chunk_errors.push(e);
        }
    }

    stop_progress.store(true, Ordering::Relaxed);
    let _ = progress_handle.join();

    // Check if the user initiated a real cancellation
    if cancel.load(Ordering::Relaxed) {
        return Err("Update cancelled.".into());
    }

    if !chunk_errors.is_empty() {
        return Err(chunk_errors.join("; "));
    }

    // Close the shared file handle before rename
    drop(file);

    std::fs::rename(&part_path, &final_path)
        .map_err(|e| format!("finalize file: {e}"))?;

    let elapsed = start.elapsed().as_secs_f64();
    let mb = total_bytes as f64 / 1_048_576.0;
    log::info(&format!(
        "download complete: {:.1} MB in {:.1}s ({:.1} MB/s)",
        mb,
        elapsed,
        mb / elapsed.max(0.001)
    ));

    Ok(DownloadResult {
        file_path: final_path,
        total_bytes,
    })
}

fn build_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        .timeout_write(READ_TIMEOUT)
        .user_agent(&format!(
            "smm-updater/{} (Windows)",
            env!("CARGO_PKG_VERSION")
        ))
        .redirects(10)
        .build()
}

fn probe(agent: &ureq::Agent, url: &str) -> Result<(u64, bool), String> {
    // Some CDNs (notably GitHub's) don't answer HEAD well but do answer a tiny ranged GET.
    let resp = agent
        .get(url)
        .set("Range", "bytes=0-0")
        .call()
        .map_err(|e| format!("probe request failed: {e}"))?;

    let status = resp.status();
    let accepts_ranges = status == 206
        || resp
            .header("accept-ranges")
            .map(|v| v.to_ascii_lowercase().contains("bytes"))
            .unwrap_or(false);

    let total = if status == 206 {
        // Content-Range: bytes 0-0/12345
        resp.header("content-range")
            .and_then(|cr| cr.split('/').nth(1))
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        resp.header("content-length")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    };

    // Drain the tiny body
    let mut reader = resp.into_reader().take(1024);
    let mut sink = [0u8; 64];
    while reader.read(&mut sink).unwrap_or(0) > 0 {}

    Ok((total, accepts_ranges))
}

fn split_ranges(total: u64, chunks: u64) -> Vec<(u64, u64)> {
    let mut ranges = Vec::with_capacity(chunks as usize);
    let base = total / chunks;
    let mut start = 0u64;
    for i in 0..chunks {
        let end = if i == chunks - 1 {
            total - 1
        } else {
            start + base - 1
        };
        ranges.push((start, end));
        start = end + 1;
    }
    ranges
}

fn download_range(
    agent: &ureq::Agent,
    url: &str,
    start: u64,
    end: u64,
    file: Arc<Mutex<File>>,
    downloaded: Arc<AtomicU64>,
    cancel: Arc<AtomicBool>,
    idx: usize,
) -> Result<(), String> {
    let mut attempt = 0u32;
    let mut chunk_start = start;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let range = format!("bytes={}-{}", chunk_start, end);
        let result = agent.get(url).set("Range", &range).call();
        match result {
            Ok(resp) => {
                let status = resp.status();
                if status != 200 && status != 206 {
                    return Err(format!("chunk {idx}: HTTP {status}"));
                }
                let mut reader = resp.into_reader();
                let mut buf = vec![0u8; READ_BUFFER_BYTES];
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        return Err("cancelled".into());
                    }
                    let n = match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(e) => {
                            return maybe_retry(
                                &mut attempt,
                                &cancel,
                                format!("chunk {idx} read: {e}"),
                                chunk_start,
                            );
                        }
                    };
                    {
                        let mut f = file
                            .lock()
                            .map_err(|_| format!("chunk {idx}: file mutex poisoned"))?;
                        f.seek(SeekFrom::Start(chunk_start))
                            .map_err(|e| format!("chunk {idx} seek: {e}"))?;
                        f.write_all(&buf[..n])
                            .map_err(|e| format!("chunk {idx} write: {e}"))?;
                    }
                    chunk_start += n as u64;
                    downloaded.fetch_add(n as u64, Ordering::Relaxed);
                }
                if chunk_start > end {
                    return Ok(());
                }
                // If we exited the read loop without reaching the end, retry from current offset
                match maybe_retry(
                    &mut attempt,
                    &cancel,
                    format!("chunk {idx}: stream ended early at {chunk_start}/{end}"),
                    chunk_start,
                ) {
                    Ok(()) => continue,
                    Err(e) => return Err(e),
                }
            }
            Err(e) => {
                match maybe_retry(
                    &mut attempt,
                    &cancel,
                    format!("chunk {idx} request: {e}"),
                    chunk_start,
                ) {
                    Ok(()) => continue,
                    Err(e) => return Err(e),
                }
            }
        }
    }
}

fn maybe_retry(
    attempt: &mut u32,
    cancel: &AtomicBool,
    reason: String,
    offset: u64,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    *attempt += 1;
    if *attempt > CHUNK_MAX_RETRIES {
        return Err(reason);
    }
    let backoff = Duration::from_millis(500 * (1u64 << (*attempt - 1)));
    log::warn(&format!(
        "retry #{attempt} at offset {offset}: {reason} (sleeping {}ms)",
        backoff.as_millis()
    ));
    thread::sleep(backoff);
    Ok(())
}

pub fn cleanup_partial(dest_dir: &Path, version: &str) {
    let part = dest_dir.join(format!("StellarisModManager-Setup-{version}.exe.part"));
    let _ = std::fs::remove_file(&part);
}
