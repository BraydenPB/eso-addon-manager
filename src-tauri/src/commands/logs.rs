use crate::logs::{discovery, encounter, parser, types::*};

/// List all log files in the given directory.
#[tauri::command]
pub fn cmd_list_logs(logs_dir: String) -> Result<Vec<LogFileInfo>, String> {
    discovery::list_log_files(&logs_dir)
}

/// Analyze a single log file: parse all events and detect encounters.
#[tauri::command]
pub fn cmd_analyze_log(path: String) -> Result<LogAnalysis, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let events_with_offsets = parser::parse_with_offsets(&content);
    let total_events = events_with_offsets.len();
    let encounters = encounter::detect_encounters(&events_with_offsets);

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let file_name = std::path::Path::new(&path)
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
            path,
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

/// Return the default ESO log directory path for the current platform.
#[tauri::command]
pub fn get_logs_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let path = std::path::PathBuf::from(profile)
                .join("Documents")
                .join("Elder Scrolls Online")
                .join("live")
                .join("Logs");
            return path.to_string_lossy().into_owned();
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
            return path.to_string_lossy().into_owned();
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(docs) = dirs::document_dir() {
            let path = docs
                .join("Elder Scrolls Online")
                .join("live")
                .join("Logs");
            return path.to_string_lossy().into_owned();
        }
    }

    String::new()
}
