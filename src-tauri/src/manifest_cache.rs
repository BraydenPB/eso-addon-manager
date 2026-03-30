use crate::manifest::{self, AddonManifest};
use rusqlite::Connection;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Open (or create) the manifest cache database in the AddOns directory.
fn open_cache(addons_dir: &Path) -> Result<Connection, rusqlite::Error> {
    let db_path = addons_dir.join(".eso-addon-manager-cache.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS manifest_cache (
             folder_name TEXT PRIMARY KEY,
             mtime_secs  INTEGER NOT NULL,
             mtime_nanos INTEGER NOT NULL,
             data         TEXT NOT NULL
         );",
    )?;
    Ok(conn)
}

/// Get the file mtime as (secs, nanos) since UNIX epoch.
fn file_mtime(path: &Path) -> Option<(i64, u32)> {
    let metadata = std::fs::metadata(path).ok()?;
    let mtime = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some((mtime.as_secs() as i64, mtime.subsec_nanos()))
}

/// Try to load a cached manifest if the mtime matches. Returns None on miss.
pub fn parse_manifest_cached(
    conn: &Connection,
    _addons_dir: &Path,
    folder_name: &str,
    manifest_path: &Path,
) -> Option<AddonManifest> {
    let (mtime_secs, mtime_nanos) = file_mtime(manifest_path)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT data FROM manifest_cache WHERE folder_name = ?1 AND mtime_secs = ?2 AND mtime_nanos = ?3",
        )
        .ok()?;
    let data: String = stmt
        .query_row(
            rusqlite::params![folder_name, mtime_secs, mtime_nanos],
            |row| row.get(0),
        )
        .ok()?;
    serde_json::from_str(&data).ok()
}

/// Store a parsed manifest in the cache, keyed by folder name and file mtime.
pub fn store_parsed(
    conn: &Connection,
    folder_name: &str,
    manifest_path: &Path,
    manifest: &AddonManifest,
) {
    let Some((mtime_secs, mtime_nanos)) = file_mtime(manifest_path) else {
        return;
    };
    if let Ok(json) = serde_json::to_string(manifest) {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO manifest_cache (folder_name, mtime_secs, mtime_nanos, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![folder_name, mtime_secs, mtime_nanos, json],
        );
    }
}

/// Remove stale entries from the cache for folders that no longer exist.
/// Uses a direct parameterized IN clause — efficient for typical addon
/// counts (under ~1000 folders).
fn prune_stale(conn: &Connection, existing_folders: &[String]) {
    if existing_folders.is_empty() {
        let _ = conn.execute("DELETE FROM manifest_cache", []);
        return;
    }
    let placeholders: Vec<&str> = existing_folders.iter().map(|_| "?").collect();
    let sql = format!(
        "DELETE FROM manifest_cache WHERE folder_name NOT IN ({})",
        placeholders.join(",")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = existing_folders
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let _ = conn.execute(&sql, params.as_slice());
}

/// Open the cache and prune stale entries. Returns the connection for use
/// during the scan. If the cache can't be opened, returns None (caller
/// should fall back to uncached parsing).
pub fn open_and_prune(addons_dir: &Path, existing_folders: &[String]) -> Option<Connection> {
    let conn = open_cache(addons_dir).ok()?;
    prune_stale(&conn, existing_folders);
    Some(conn)
}
