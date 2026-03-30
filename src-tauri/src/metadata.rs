use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonMetadata {
    pub esoui_id: u32,
    pub installed_version: String,
    pub download_url: String,
    pub installed_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// ESOUI last-updated timestamp in epoch milliseconds (from the API).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub esoui_last_update: u64,
}

fn is_zero(v: &u64) -> bool {
    *v == 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataStore {
    pub version: u32,
    pub addons: HashMap<String, AddonMetadata>,
}

impl Default for MetadataStore {
    fn default() -> Self {
        Self {
            version: 1,
            addons: HashMap::new(),
        }
    }
}

fn metadata_path(addons_path: &Path) -> std::path::PathBuf {
    addons_path.join("kalpa.json")
}

/// Load a JSON file with automatic backup recovery.
///
/// If the primary file is corrupted, tries the `.json.bak` backup.
/// Returns `T::default()` if both are missing or corrupted.
pub fn load_json_with_backup<T: DeserializeOwned + Default>(path: &Path) -> T {
    match fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(data) => data,
            Err(e) => {
                eprintln!(
                    "Warning: {} corrupted ({}), trying backup...",
                    path.display(),
                    e
                );
                let bak = path.with_extension("json.bak");
                match fs::read_to_string(&bak) {
                    Ok(bak_content) => match serde_json::from_str(&bak_content) {
                        Ok(data) => {
                            eprintln!("Recovered data from backup file {}.", bak.display());
                            data
                        }
                        Err(e2) => {
                            eprintln!("Backup also corrupted ({}), using defaults.", e2);
                            T::default()
                        }
                    },
                    Err(_) => {
                        eprintln!("No backup file found, using defaults.");
                        T::default()
                    }
                }
            }
        },
        Err(_) => T::default(),
    }
}

/// Save data as JSON with atomic write and automatic backup.
///
/// Creates a `.json.bak` of the existing file before overwriting,
/// then writes to a `.json.tmp` file and renames atomically.
pub fn save_json_with_backup<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize: {}", e))?;

    // Create backup of existing file before writing (ignore if file doesn't exist)
    let bak = path.with_extension("json.bak");
    let _ = fs::copy(path, &bak);

    // Write to temp file first, then atomically rename
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Failed to finalize write: {}", e))
}

pub fn format_timestamp(secs: u64) -> String {
    // Simple UTC timestamp without chrono dependency
    let days = secs / 86400;
    let rem = secs % 86400;
    let hours = rem / 3600;
    let mins = (rem % 3600) / 60;
    let s = rem % 60;

    // Days since epoch to date (simplified)
    let mut y = 1970i64;
    let mut d = days as i64;
    loop {
        let year_days = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if d < year_days {
            break;
        }
        d -= year_days;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0;
    for &md in &month_days {
        if d < md {
            break;
        }
        d -= md;
        m += 1;
    }
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m + 1,
        d + 1,
        hours,
        mins,
        s
    )
}

pub fn load_metadata(addons_path: &Path) -> MetadataStore {
    load_json_with_backup(&metadata_path(addons_path))
}

pub fn save_metadata(addons_path: &Path, store: &MetadataStore) -> Result<(), String> {
    save_json_with_backup(&metadata_path(addons_path), store)
}

pub fn record_install(
    store: &mut MetadataStore,
    folder_name: &str,
    esoui_id: u32,
    version: &str,
    download_url: &str,
) {
    record_install_ext(store, folder_name, esoui_id, version, download_url, 0);
}

pub fn record_install_ext(
    store: &mut MetadataStore,
    folder_name: &str,
    esoui_id: u32,
    version: &str,
    download_url: &str,
    esoui_last_update: u64,
) {
    let existing = store.addons.get(folder_name);
    // Preserve existing tags when re-recording an install (e.g. update)
    let existing_tags = existing.map(|m| m.tags.clone()).unwrap_or_default();
    // Keep existing last_update if new one is 0
    let last_update = if esoui_last_update == 0 {
        existing.map(|m| m.esoui_last_update).unwrap_or(0)
    } else {
        esoui_last_update
    };
    store.addons.insert(
        folder_name.to_string(),
        AddonMetadata {
            esoui_id,
            installed_version: version.to_string(),
            download_url: download_url.to_string(),
            installed_at: format_timestamp(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            ),
            tags: existing_tags,
            esoui_last_update: last_update,
        },
    );
}

pub fn remove_entry(store: &mut MetadataStore, folder_name: &str) {
    store.addons.remove(folder_name);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");

        let mut store = MetadataStore::default();
        record_install(&mut store, "TestAddon", 123, "1.0.0", "https://example.com");

        save_json_with_backup(&path, &store).unwrap();

        let loaded: MetadataStore = load_json_with_backup(&path);
        assert_eq!(loaded.version, 1);
        assert_eq!(loaded.addons.len(), 1);
        assert_eq!(loaded.addons["TestAddon"].esoui_id, 123);
        assert_eq!(loaded.addons["TestAddon"].installed_version, "1.0.0");
    }

    #[test]
    fn load_returns_default_for_missing_file() {
        let loaded: MetadataStore = load_json_with_backup(Path::new("/nonexistent/path.json"));
        assert_eq!(loaded.version, 1);
        assert!(loaded.addons.is_empty());
    }

    #[test]
    fn load_recovers_from_corrupted_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");
        let bak = tmp.path().join("test.json.bak");

        // Write a valid backup
        let mut store = MetadataStore::default();
        record_install(&mut store, "Recovered", 42, "2.0.0", "https://example.com");
        let json = serde_json::to_string(&store).unwrap();
        fs::write(&bak, &json).unwrap();

        // Write corrupted primary
        fs::write(&path, "this is not valid json{{{").unwrap();

        let loaded: MetadataStore = load_json_with_backup(&path);
        assert_eq!(loaded.addons.len(), 1);
        assert_eq!(loaded.addons["Recovered"].esoui_id, 42);
    }

    #[test]
    fn load_returns_default_when_both_corrupted() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");
        let bak = tmp.path().join("test.json.bak");

        fs::write(&path, "corrupted").unwrap();
        fs::write(&bak, "also corrupted").unwrap();

        let loaded: MetadataStore = load_json_with_backup(&path);
        assert!(loaded.addons.is_empty());
    }

    #[test]
    fn save_creates_backup_of_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");
        let bak = tmp.path().join("test.json.bak");

        // First save
        let store1 = MetadataStore::default();
        save_json_with_backup(&path, &store1).unwrap();
        assert!(!bak.exists());

        // Second save should create backup
        let mut store2 = MetadataStore::default();
        record_install(&mut store2, "New", 1, "1.0", "url");
        save_json_with_backup(&path, &store2).unwrap();
        assert!(bak.exists());

        // Backup should contain the first version (empty addons)
        let backup: MetadataStore =
            serde_json::from_str(&fs::read_to_string(&bak).unwrap()).unwrap();
        assert!(backup.addons.is_empty());
    }

    #[test]
    fn record_and_remove_entry() {
        let mut store = MetadataStore::default();

        record_install(&mut store, "Addon1", 10, "1.0", "url1");
        record_install(&mut store, "Addon2", 20, "2.0", "url2");
        assert_eq!(store.addons.len(), 2);

        remove_entry(&mut store, "Addon1");
        assert_eq!(store.addons.len(), 1);
        assert!(!store.addons.contains_key("Addon1"));
        assert!(store.addons.contains_key("Addon2"));
    }

    #[test]
    fn format_timestamp_produces_valid_iso8601() {
        // 2024-01-01T00:00:00Z
        let ts = format_timestamp(1704067200);
        assert_eq!(ts, "2024-01-01T00:00:00Z");
    }

    #[test]
    fn save_is_atomic_via_temp_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.json");
        let tmp_path = tmp.path().join("test.json.tmp");

        let store = MetadataStore::default();
        save_json_with_backup(&path, &store).unwrap();

        // Temp file should not remain
        assert!(!tmp_path.exists());
        // Main file should exist
        assert!(path.exists());
    }
}
