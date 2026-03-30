use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

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

/// Start watching a log file for new data. Returns a handle to control the watcher.
///
/// When new lines are appended to the file, they are parsed and the callback
/// is invoked with the resulting events. The watcher tails the file by tracking
/// the last-read byte offset.
pub fn watch_log_file(
    file_path: &str,
    on_events: OnNewEvents,
) -> Result<LogWatchHandle, String> {
    let path = Path::new(file_path).to_path_buf();
    if !path.is_file() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let initial_size = std::fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0);

    let stop_flag = Arc::new(Mutex::new(false));
    let stop_flag_clone = Arc::clone(&stop_flag);

    let path_clone = path.clone();

    let thread = thread::spawn(move || {
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

        if let Some(parent) = path_clone.parent() {
            if let Err(e) = watcher.watch(parent, RecursiveMode::NonRecursive) {
                eprintln!("[log_watcher] Failed to watch directory: {}", e);
                return;
            }
        }

        let mut last_offset = initial_size;
        let mut last_check = Instant::now();

        loop {
            // Check stop flag
            if let Ok(flag) = stop_flag_clone.lock() {
                if *flag {
                    break;
                }
            }

            // Wait for file system events with a timeout
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    // Only process modify events for our target file
                    if !matches!(event.kind, EventKind::Modify(_)) {
                        continue;
                    }
                    let is_our_file = event.paths.iter().any(|p| p == &path_clone);
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
            let current_size = match std::fs::metadata(&path_clone) {
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

            // Read the new portion
            match read_range(&path_clone, last_offset, current_size) {
                Ok(new_text) => {
                    let events = parser::parse_chunk(&new_text);
                    if !events.is_empty() {
                        on_events(events);
                    }
                    last_offset = current_size;
                }
                Err(e) => {
                    eprintln!("[log_watcher] Failed to read new data: {}", e);
                }
            }
        }
    });

    Ok(LogWatchHandle {
        stop_flag,
        _thread: Some(thread),
    })
}

/// Read a byte range from a file and return it as a UTF-8 string.
fn read_range(path: &Path, start: u64, end: u64) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).map_err(|e| format!("Open failed: {}", e))?;

    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("Seek failed: {}", e))?;

    let len = (end - start) as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("Read failed: {}", e))?;

    String::from_utf8(buf).map_err(|e| format!("UTF-8 decode failed: {}", e))
}
