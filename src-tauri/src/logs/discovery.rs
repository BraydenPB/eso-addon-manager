use super::types::{LogFileInfo, LogPathDetection};
use std::fs;
use std::path::{Path, PathBuf};

/// Attempt to discover the ESO Logs directory.
///
/// Strategy:
/// 1. If an addons path is provided (from the addon manager's config),
///    derive the logs directory from it (sibling to the AddOns folder).
/// 2. Fall back to scanning common ESO directories under Documents.
pub fn detect_log_path(addons_path: Option<&str>) -> LogPathDetection {
    // Strategy 1: derive from the known addons path
    if let Some(ap) = addons_path {
        let addons_dir = PathBuf::from(ap);
        // AddOns is typically at .../Elder Scrolls Online/live/AddOns
        // Logs are at .../Elder Scrolls Online/live/Logs
        if let Some(parent) = addons_dir.parent() {
            let logs_dir = parent.join("Logs");
            if logs_dir.is_dir() {
                return LogPathDetection {
                    path: Some(logs_dir.to_string_lossy().into_owned()),
                    from_addon_path: true,
                    message: "Log directory found next to your AddOns folder.".into(),
                };
            }
            // The Logs folder may not exist yet if logging hasn't been enabled
            // Still return the expected path so the UI can guide the user
            return LogPathDetection {
                path: Some(logs_dir.to_string_lossy().into_owned()),
                from_addon_path: true,
                message: "Expected log directory location detected, but the folder does not exist yet. You may need to enable combat logging in-game.".into(),
            };
        }
    }

    // Strategy 2: scan common document directories
    if let Some(docs) = dirs::document_dir() {
        for env_name in &["live", "liveeu", "pts"] {
            let logs_dir = docs
                .join("Elder Scrolls Online")
                .join(env_name)
                .join("Logs");
            if logs_dir.is_dir() {
                return LogPathDetection {
                    path: Some(logs_dir.to_string_lossy().into_owned()),
                    from_addon_path: false,
                    message: format!(
                        "Log directory found in your Documents folder ({}).",
                        env_name
                    ),
                };
            }
        }
    }

    LogPathDetection {
        path: None,
        from_addon_path: false,
        message: "Could not find an ESO log directory. Please select it manually or enable combat logging in-game.".into(),
    }
}

/// List all log files (*.log) in the given directory.
pub fn list_log_files(logs_dir: &str) -> Result<Vec<LogFileInfo>, String> {
    let dir = Path::new(logs_dir);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", logs_dir));
    }

    let mut files: Vec<LogFileInfo> = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        // Accept .log files and common ESO log naming patterns
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "log" {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| {
                        // Simple ISO 8601 approximation
                        let secs = d.as_secs();
                        format!("{}", secs)
                    })
            })
            .unwrap_or_default();

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        files.push(LogFileInfo {
            path: path.to_string_lossy().into_owned(),
            file_name,
            size_bytes: metadata.len(),
            modified_at,
            encounter_count: None,
            tags: Vec::new(),
        });
    }

    // Sort by modified time descending (newest first)
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(files)
}
