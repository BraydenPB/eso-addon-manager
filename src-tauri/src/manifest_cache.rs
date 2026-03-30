use crate::manifest::AddonManifest;
use rusqlite::Connection;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Open (or create) the manifest cache database in the app data directory.
/// Stored outside the ESO AddOns folder so the game's recursive folder scanner
/// doesn't encounter unexpected files.
fn open_cache(cache_dir: &Path) -> Result<Connection, rusqlite::Error> {
    // Ensure the app data directory exists (Tauri doesn't guarantee it on first run)
    let _ = std::fs::create_dir_all(cache_dir);
    let db_path = cache_dir.join("manifest-cache.db");
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
/// Note: on filesystems without sub-second precision (FAT32, some network
/// shares), `nanos` will always be 0. The cache still works — it just keys
/// on seconds only, which is sufficient for detecting file changes.
fn file_mtime(path: &Path) -> Option<(i64, u32)> {
    let metadata = std::fs::metadata(path).ok()?;
    let mtime = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some((mtime.as_secs() as i64, mtime.subsec_nanos()))
}

/// Try to load a cached manifest if the mtime matches. Returns None on miss.
pub fn parse_manifest_cached(
    conn: &Connection,
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
/// Batches deletes in groups of 500 to stay under SQLite's 999-parameter limit.
fn prune_stale(conn: &Connection, existing_folders: &[&str]) {
    if existing_folders.is_empty() {
        let _ = conn.execute("DELETE FROM manifest_cache", []);
        return;
    }

    // Use a temp table to hold existing folder names, then delete rows not in it.
    // This avoids the SQLITE_LIMIT_VARIABLE_NUMBER (999) cap for large addon lists.
    let _ = conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS _existing_folders (name TEXT PRIMARY KEY);
         DELETE FROM _existing_folders;",
    );

    for chunk in existing_folders.chunks(500) {
        let placeholders: Vec<&str> = chunk.iter().map(|_| "(?)").collect();
        let sql = format!(
            "INSERT INTO _existing_folders (name) VALUES {}",
            placeholders.join(",")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = chunk
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let _ = conn.execute(&sql, params.as_slice());
    }

    let _ = conn.execute(
        "DELETE FROM manifest_cache WHERE folder_name NOT IN (SELECT name FROM _existing_folders)",
        [],
    );
}

/// Open the cache and prune stale entries. Returns the connection for use
/// during the scan. If the cache can't be opened, returns None (caller
/// should fall back to uncached parsing).
pub fn open_and_prune(cache_dir: &Path, existing_folders: &[&str]) -> Option<Connection> {
    let conn = open_cache(cache_dir).ok()?;
    prune_stale(&conn, existing_folders);
    Some(conn)
}
