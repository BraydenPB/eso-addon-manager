use std::sync::{Arc, Mutex};
use tauri::State;

use super::{discovery, encounter, parser, types::*, watcher};
use crate::AllowedAddonsPath;

/// Managed state holding the active log watcher handle (if any).
pub struct ActiveLogWatcher(pub Mutex<Option<watcher::LogWatchHandle>>);

/// Managed state holding events received from the live watcher.
pub struct LiveLogBuffer(pub Mutex<LiveBufferInner>);

pub struct LiveBufferInner {
    pub events: Vec<super::types::CombatEvent>,
    pub file_path: Option<String>,
    pub last_event_time: Option<std::time::Instant>,
    pub encounters_completed: usize,
}

impl Default for LiveBufferInner {
    fn default() -> Self {
        Self {
            events: Vec::new(),
            file_path: None,
            last_event_time: None,
            encounters_completed: 0,
        }
    }
}

/// Validate that a file path points to a `.log` file and doesn't contain
/// path traversal sequences. This prevents a compromised webview from
/// reading arbitrary files via the log analysis commands.
fn validate_log_file_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);

    // Must have a .log extension
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "log" {
        return Err("Only .log files can be analyzed".to_string());
    }

    // Reject paths containing traversal components
    for component in p.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Path traversal is not allowed".to_string());
        }
    }

    Ok(())
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Detect the ESO log directory, using the addon path if available.
#[tauri::command]
pub fn detect_log_path(allowed: State<'_, AllowedAddonsPath>) -> Result<LogPathDetection, String> {
    let addons_path = allowed.0.lock().map_err(|_| "Failed to read addons path")?;

    let ap_str = addons_path
        .as_ref()
        .map(|a| a.configured.to_string_lossy().into_owned());

    Ok(discovery::detect_log_path(ap_str.as_deref()))
}

/// List all log files in the given directory.
#[tauri::command]
pub fn list_logs(logs_path: String) -> Result<Vec<LogFileInfo>, String> {
    discovery::list_log_files(&logs_path)
}

/// Analyze a single log file: parse all events and detect encounters.
#[tauri::command]
pub fn analyze_log(file_path: String) -> Result<LogAnalysis, String> {
    validate_log_file_path(&file_path)?;
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let events_with_offsets = parser::parse_with_offsets(&content);
    let total_events = events_with_offsets.len();
    let encounters = encounter::detect_encounters(&events_with_offsets);

    let metadata = std::fs::metadata(&file_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| format!("{}", d.as_secs()))
        })
        .unwrap_or_default();

    Ok(LogAnalysis {
        file: LogFileInfo {
            path: file_path,
            file_name,
            size_bytes: metadata.len(),
            modified_at,
            encounter_count: Some(encounters.len()),
            tags: Vec::new(),
        },
        encounters,
        total_events,
        is_complete: true,
    })
}

/// Get a summary of a specific encounter by index within a log file.
#[tauri::command]
pub fn get_encounter_detail(
    file_path: String,
    encounter_index: usize,
) -> Result<Encounter, String> {
    validate_log_file_path(&file_path)?;
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let events_with_offsets = parser::parse_with_offsets(&content);
    let encounters = encounter::detect_encounters(&events_with_offsets);

    encounters
        .into_iter()
        .find(|e| e.index == encounter_index)
        .ok_or_else(|| format!("Encounter {} not found", encounter_index))
}

/// Start watching a log file for live updates.
#[tauri::command]
pub fn watch_log_start(
    file_path: String,
    watcher_state: State<'_, ActiveLogWatcher>,
    buffer_state: State<'_, LiveLogBuffer>,
) -> Result<(), String> {
    validate_log_file_path(&file_path)?;
    // Stop any existing watcher first
    {
        let mut guard = watcher_state
            .0
            .lock()
            .map_err(|_| "Failed to lock watcher state")?;
        if let Some(handle) = guard.take() {
            handle.stop();
        }
    }

    // Reset the live buffer
    {
        let mut buf = buffer_state
            .0
            .lock()
            .map_err(|_| "Failed to lock buffer state")?;
        *buf = LiveBufferInner {
            file_path: Some(file_path.clone()),
            ..Default::default()
        };
    }

    // Clone buffer state reference for the callback
    let buffer = Arc::clone(&buffer_state.0);

    let handle = watcher::watch_log_file(
        &file_path,
        Box::new(move |events| {
            if let Ok(mut buf) = buffer.lock() {
                buf.last_event_time = Some(std::time::Instant::now());
                buf.events.extend(events);

                // Keep only the last 50,000 events in the rolling buffer
                if buf.events.len() > 50_000 {
                    let drain_count = buf.events.len() - 50_000;
                    buf.events.drain(..drain_count);
                }
            }
        }),
    )?;

    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|_| "Failed to lock watcher state")?;
    *guard = Some(handle);

    Ok(())
}

/// Stop watching the current log file.
#[tauri::command]
pub fn watch_log_stop(
    watcher_state: State<'_, ActiveLogWatcher>,
    buffer_state: State<'_, LiveLogBuffer>,
) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|_| "Failed to lock watcher state")?;

    if let Some(handle) = guard.take() {
        handle.stop();
    }

    // Clear the buffer
    let mut buf = buffer_state
        .0
        .lock()
        .map_err(|_| "Failed to lock buffer state")?;
    *buf = LiveBufferInner::default();

    Ok(())
}

/// Get the current live logging session status.
#[tauri::command]
pub fn get_live_status(
    buffer_state: State<'_, LiveLogBuffer>,
) -> Result<LiveSessionStatus, String> {
    let buf = buffer_state
        .0
        .lock()
        .map_err(|_| "Failed to lock buffer state")?;

    let file_size = buf
        .file_path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .unwrap_or(0);

    let secs_since_last = buf
        .last_event_time
        .map(|t| t.elapsed().as_secs_f64())
        .unwrap_or(f64::MAX);

    Ok(LiveSessionStatus {
        active: buf.file_path.is_some(),
        file_path: buf.file_path.clone(),
        file_size,
        secs_since_last_event: secs_since_last,
        current_encounter: None, // TODO: detect current in-progress encounter from buffer
        encounters_completed: buf.encounters_completed,
    })
}

// ── Line-level log watch commands (emit Tauri events) ──────────────────

/// Managed state holding the line-level log watcher handle (if any).
pub struct LineLogWatcher(pub Mutex<Option<watcher::LogWatchHandle>>);

/// Start watching a log file for new lines, emitting "log-updated" events.
#[tauri::command]
pub fn start_log_watch(
    path: String,
    app_handle: tauri::AppHandle,
    watcher_state: State<'_, LineLogWatcher>,
) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|_| "Failed to lock line watcher state")?;

    // Stop any existing line watcher first
    if let Some(handle) = guard.take() {
        handle.stop();
    }

    let handle = watcher::watch_log_lines(&path, app_handle)?;
    *guard = Some(handle);
    Ok(())
}

/// Stop the line-level log watcher.
#[tauri::command]
pub fn stop_log_watch(watcher_state: State<'_, LineLogWatcher>) -> Result<(), String> {
    let mut guard = watcher_state
        .0
        .lock()
        .map_err(|_| "Failed to lock line watcher state")?;

    if let Some(handle) = guard.take() {
        handle.stop();
    }
    Ok(())
}

/// Return the default ESO log directory path for the current platform.
#[tauri::command]
pub fn get_logs_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let path = std::path::PathBuf::from(profile)
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("Logs");
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let path = home
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("Logs");
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(docs) = dirs::document_dir() {
            let path = docs.join("Elder Scrolls Online").join("live").join("Logs");
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    Err("Could not determine the ESO log directory for this platform".to_string())
}
