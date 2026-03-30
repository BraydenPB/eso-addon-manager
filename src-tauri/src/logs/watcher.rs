use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;

use super::parser;
use super::types::CombatEvent;

/// Handle to a running file watcher. Drop or call `stop()` to end watching.
pub struct LogWatchHandle {
    /// Signal the watcher thread to stop.
    stop_flag: Arc<Mutex<bool>>,
    /// Join handle for the watcher thread.
    _thread: Option<thread::JoinHandle<()>>,
}

impl LogWatchHandle {
    /// Signal the watcher to stop. The background thread will exit shortly after.
    pub fn stop(&self) {
        if let Ok(mut flag) = self.stop_flag.lock() {
            *flag = true;
        }
    }
}

impl Drop for LogWatchHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Callback invoked whenever new events are parsed from appended log data.
pub type OnNewEvents = Box<dyn Fn(Vec<CombatEvent>) + Send + 'static>;

/// Shared file-tailing loop used by both watchers.
///
/// Watches `path` for changes using `notify` with a polling fallback.
/// Whenever new bytes are appended, reads the new portion and calls
/// `on_new_data` with the text and current byte offset. Returns only
/// when `stop_flag` is set to `true`.
fn tail_file(
    path: PathBuf,
    initial_offset: u64,
    stop_flag: Arc<Mutex<bool>>,
    on_new_data: impl Fn(&str, u64) + Send + 'static,
) {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = match RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default().with_poll_interval(Duration::from_secs(1)),
    ) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[log_watcher] Failed to create watcher: {}", e);
            return;
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = watcher.watch(parent, RecursiveMode::NonRecursive) {
            eprintln!("[log_watcher] Failed to watch directory: {}", e);
            return;
        }
    }

    let mut last_offset = initial_offset;
    let mut last_check = Instant::now();

    loop {
        // Check stop flag
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        // Wait for file system events with a timeout
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                if !matches!(event.kind, EventKind::Modify(_)) {
                    continue;
                }
                let is_our_file = event.paths.iter().any(|p| p == &path);
                if !is_our_file {
                    continue;
                }
            }
            Ok(Err(e)) => {
                eprintln!("[log_watcher] Watch error: {}", e);
                continue;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Periodic check: also read if enough time has passed (fallback polling)
                if last_check.elapsed() < Duration::from_secs(2) {
                    continue;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        last_check = Instant::now();

        // Read new data from the file
        let current_size = match std::fs::metadata(&path) {
            Ok(m) => m.len(),
            Err(_) => continue,
        };

        if current_size <= last_offset {
            // File may have been truncated/rotated — reset
            if current_size < last_offset {
                last_offset = 0;
            }
            continue;
        }

        match read_range(&path, last_offset, current_size) {
            Ok(new_text) => {
                on_new_data(&new_text, last_offset);
                last_offset = current_size;
            }
            Err(e) => {
                eprintln!("[log_watcher] Failed to read new data: {}", e);
            }
        }
    }
}

/// Start watching a log file for new data. Returns a handle to control the watcher.
///
/// When new lines are appended to the file, they are parsed and the callback
/// is invoked with the resulting events. The watcher tails the file by tracking
/// the last-read byte offset.
pub fn watch_log_file(file_path: &str, on_events: OnNewEvents) -> Result<LogWatchHandle, String> {
    let path = Path::new(file_path).to_path_buf();
    if !path.is_file() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let initial_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let stop_flag = Arc::new(Mutex::new(false));
    let stop_flag_clone = Arc::clone(&stop_flag);

    let thread = thread::spawn(move || {
        tail_file(
            path,
            initial_size,
            stop_flag_clone,
            move |new_text, _offset| {
                let events = parser::parse_chunk(new_text);
                if !events.is_empty() {
                    on_events(events);
                }
            },
        );
    });

    Ok(LogWatchHandle {
        stop_flag,
        _thread: Some(thread),
    })
}

// ── Line-level watcher that emits Tauri events ────────────────────────

/// Payload emitted on the "log-updated" Tauri event.
#[derive(Clone, Serialize)]
pub struct LogUpdatedPayload {
    pub path: String,
    pub new_lines: Vec<String>,
}

/// Start watching a log file and emit a "log-updated" Tauri event whenever
/// new lines are appended. Returns a `LogWatchHandle` to stop watching.
pub fn watch_log_lines(
    file_path: &str,
    app_handle: tauri::AppHandle,
) -> Result<LogWatchHandle, String> {
    let path = Path::new(file_path).to_path_buf();
    if !path.is_file() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let initial_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let stop_flag = Arc::new(Mutex::new(false));
    let stop_flag_clone = Arc::clone(&stop_flag);
    let path_string = file_path.to_string();

    let thread = thread::spawn(move || {
        tail_file(
            path,
            initial_size,
            stop_flag_clone,
            move |new_text, _offset| {
                let lines: Vec<String> = new_text
                    .lines()
                    .filter(|l| !l.is_empty())
                    .map(|l| l.to_string())
                    .collect();

                if !lines.is_empty() {
                    let payload = LogUpdatedPayload {
                        path: path_string.clone(),
                        new_lines: lines,
                    };
                    let _ = app_handle.emit("log-updated", payload);
                }
            },
        );
    });

    Ok(LogWatchHandle {
        stop_flag,
        _thread: Some(thread),
    })
}

/// Read a byte range from a file and return it as a UTF-8 string.
///
/// Refuses to allocate more than 64 MiB to prevent OOM from corrupted
/// metadata or extremely large appends.
fn read_range(path: &Path, start: u64, end: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};

    if end < start {
        return Err(format!(
            "Invalid byte range: end ({}) < start ({})",
            end, start
        ));
    }

    const MAX_READ: u64 = 64 * 1024 * 1024; // 64 MiB
    let byte_len = end - start;
    if byte_len > MAX_READ {
        return Err(format!(
            "Read too large: {} bytes exceeds {} byte limit",
            byte_len, MAX_READ
        ));
    }

    let mut file = std::fs::File::open(path).map_err(|e| format!("Open failed: {}", e))?;

    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("Seek failed: {}", e))?;

    let len = byte_len as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("Read failed: {}", e))?;

    String::from_utf8(buf).map_err(|e| format!("UTF-8 decode failed: {}", e))
}
