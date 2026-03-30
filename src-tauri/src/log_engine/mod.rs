use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

// ── Data types ──────────────────────────────────────────────────────────

/// Metadata for a single ESO combat log file on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_at: i64,
}

/// The result of a boss encounter: kill, wipe, or indeterminate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EncounterOutcome {
    Kill,
    Wipe,
    Unknown,
}

/// A single encounter (boss fight) detected within a log file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Encounter {
    pub id: String,
    pub log_file_id: String,
    pub name: String,
    pub start_line: usize,
    pub end_line: usize,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: u64,
    pub outcome: EncounterOutcome,
}

/// A player that participated in an encounter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub name: String,
    pub is_local: bool,
}

/// The full result of parsing a log file: the file metadata plus all
/// encounters that were detected inside it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLog {
    pub log_file: LogFile,
    pub encounters: Vec<Encounter>,
}

// ── Public API ──────────────────────────────────────────────────────────

/// Walk `base_path` for `*.log` files and return a [`LogFile`] for each,
/// populated from filesystem metadata.
pub fn discover_logs(base_path: &str) -> Vec<LogFile> {
    let dir = Path::new(base_path);
    if !dir.is_dir() {
        return Vec::new();
    }

    let mut logs: Vec<LogFile> = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

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

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let full_path = path.to_string_lossy().into_owned();

        // Derive a stable ID from the file path
        let id = stable_id(&full_path);

        logs.push(LogFile {
            id,
            path: full_path,
            file_name,
            size_bytes: metadata.len(),
            modified_at,
        });
    }

    // Newest first
    logs.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    logs
}

/// Parse a log file and return the encounters found inside it.
///
/// This is a **stub implementation** — it returns an empty `ParsedLog`
/// with a single placeholder encounter so the Tauri command can be wired
/// up and tested end-to-end before real parsing is built.
pub fn parse_log(path: &str) -> Result<ParsedLog, String> {
    let file_path = Path::new(path);
    if !file_path.is_file() {
        return Err(format!("File does not exist: {}", path));
    }

    let metadata =
        fs::metadata(file_path).map_err(|e| format!("Cannot read file metadata: {}", e))?;

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let full_path = file_path.to_string_lossy().into_owned();
    let log_file_id = stable_id(&full_path);

    let log_file = LogFile {
        id: log_file_id.clone(),
        path: full_path,
        file_name,
        size_bytes: metadata.len(),
        modified_at,
    };

    let stub_encounter = Encounter {
        id: format!("{}-enc-0", log_file_id),
        log_file_id,
        name: "Stub Encounter".to_string(),
        start_line: 0,
        end_line: 0,
        started_at: modified_at,
        ended_at: modified_at,
        duration_ms: 0,
        outcome: EncounterOutcome::Unknown,
    };

    Ok(ParsedLog {
        log_file,
        encounters: vec![stub_encounter],
    })
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Produce a short, deterministic hex ID from a file path.
fn stable_id(input: &str) -> String {
    // Simple FNV-1a-style hash for a stable, non-cryptographic ID.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn discover_logs_finds_log_files() {
        let tmp = tempfile::tempdir().unwrap();
        // Create two .log files and one .txt file
        for name in &["combat_2025.log", "other.log", "readme.txt"] {
            let p = tmp.path().join(name);
            let mut f = fs::File::create(p).unwrap();
            writeln!(f, "sample data").unwrap();
        }

        let logs = discover_logs(tmp.path().to_str().unwrap());
        assert_eq!(logs.len(), 2);
        let names: Vec<&str> = logs.iter().map(|l| l.file_name.as_str()).collect();
        assert!(names.contains(&"combat_2025.log"));
        assert!(names.contains(&"other.log"));
    }

    #[test]
    fn discover_logs_empty_on_missing_dir() {
        let logs = discover_logs("/nonexistent/path/that/should/not/exist");
        assert!(logs.is_empty());
    }

    #[test]
    fn parse_log_returns_stub_encounter() {
        let tmp = tempfile::tempdir().unwrap();
        let log_path = tmp.path().join("test.log");
        fs::write(&log_path, "fake log content\n").unwrap();

        let result = parse_log(log_path.to_str().unwrap()).unwrap();
        assert_eq!(result.encounters.len(), 1);
        assert_eq!(result.encounters[0].name, "Stub Encounter");
        assert_eq!(result.log_file.file_name, "test.log");
    }

    #[test]
    fn parse_log_errors_on_missing_file() {
        let result = parse_log("/no/such/file.log");
        assert!(result.is_err());
    }

    #[test]
    fn stable_id_is_deterministic() {
        let a = stable_id("/some/path.log");
        let b = stable_id("/some/path.log");
        assert_eq!(a, b);
        assert_ne!(a, stable_id("/other/path.log"));
    }
}
