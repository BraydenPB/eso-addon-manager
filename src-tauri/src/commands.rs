use crate::auth::{self, AuthState, AuthTokens, AuthUser};
use crate::esoui::{self, EsouiAddonDetail, EsouiAddonInfo, EsouiCategory, EsouiSearchResult};
use crate::installer;
use crate::manifest::{self, AddonManifest};
use crate::metadata;
use crate::AllowedAddonsPath;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Validate that `addons_path` matches the approved path stored in managed state.
/// Prevents a compromised webview from targeting arbitrary filesystem locations.
fn canonicalize_addons_path(addons_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(addons_path);
    if !path.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    if canonical.file_name().and_then(|n| n.to_str()) != Some("AddOns") {
        return Err("Selected directory must be the ESO AddOns folder.".to_string());
    }

    Ok(canonical)
}

fn require_allowed_path(
    state: &tauri::State<'_, AllowedAddonsPath>,
    addons_path: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_addons_path(addons_path)?;
    let guard = state.0.lock().map_err(|_| "Internal error.".to_string())?;
    let Some(allowed_canonical) = &*guard else {
        return Err("Addons path has not been initialized.".to_string());
    };
    if canonical != *allowed_canonical {
        return Err("Addons path does not match the configured path.".to_string());
    }
    Ok(canonical)
}

/// Called by the frontend to register the approved addons directory.
/// Stores the canonicalized path to avoid repeated canonicalization on every command.
#[tauri::command]
pub fn set_addons_path(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<(), String> {
    let canonical = canonicalize_addons_path(&addons_path)?;
    let mut guard = state.0.lock().map_err(|_| "Internal error.".to_string())?;
    *guard = Some(canonical);
    Ok(())
}

/// Validate a user-supplied name (backup name, etc.) to prevent path traversal
/// and reject Windows reserved device names.
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("Name contains invalid characters.".to_string());
    }

    // Reject Windows reserved device names (case-insensitive).
    // These include CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9.
    // Check the stem (name without extension) since "CON.txt" is also reserved.
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_uppercase();
    let is_reserved = matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if is_reserved {
        return Err(format!(
            "\"{}\" is a Windows reserved name and cannot be used.",
            stem
        ));
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub installed_folders: Vec<String>,
    pub installed_deps: Vec<String>,
    pub failed_deps: Vec<String>,
    pub skipped_deps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub folder_name: String,
    pub esoui_id: u32,
    pub current_version: String,
    pub remote_version: String,
    pub download_url: String,
    pub has_update: bool,
}

/// Determine the "primary" folder from a list of installed folders.
///
/// Prefer a folder whose name appears in the ESOUI title, otherwise
/// fall back to the first folder in the list.
fn determine_primary_folder(installed_folders: &[String], esoui_title: &str) -> String {
    installed_folders
        .iter()
        .find(|f| esoui_title.contains(f.as_str()))
        .or(installed_folders.first())
        .cloned()
        .unwrap_or_default()
}

/// Record metadata for a set of installed folders. The primary folder gets
/// the esoui_id and version from ESOUI; secondary folders get id 0 and
/// their local manifest version.
#[allow(clippy::too_many_arguments)]
fn record_installed_folders(
    store: &mut metadata::MetadataStore,
    addons_dir: &Path,
    installed_folders: &[String],
    esoui_id: u32,
    esoui_version: &str,
    esoui_title: &str,
    download_url: &str,
    esoui_last_update: u64,
) {
    let primary = determine_primary_folder(installed_folders, esoui_title);
    for folder in installed_folders {
        let is_primary = *folder == primary;
        let version = if is_primary && !esoui_version.is_empty() {
            esoui_version.to_string()
        } else {
            read_local_version(addons_dir, folder)
        };
        metadata::record_install_ext(
            store,
            folder,
            if is_primary { esoui_id } else { 0 },
            &version,
            download_url,
            if is_primary { esoui_last_update } else { 0 },
        );
    }
}

/// Try to auto-install a single missing dependency from ESOUI.
/// Returns Ok(folders) on success, or Err(reason) on failure.
fn try_install_dep(
    dep_name: &str,
    addons_dir: &Path,
    store: &mut metadata::MetadataStore,
) -> Result<Vec<String>, &'static str> {
    let dep_id = match esoui::search_addon_by_name(dep_name) {
        Ok(Some(id)) => id,
        Ok(None) => return Err("not_found"),
        Err(_) => return Err("search_failed"),
    };
    let dep_info = esoui::fetch_addon_info(dep_id).map_err(|_| "fetch_failed")?;
    let dep_tmp = esoui::download_addon(&dep_info.download_url).map_err(|_| "download_failed")?;
    let dep_folders =
        installer::extract_addon_zip(dep_tmp.path(), addons_dir).map_err(|_| "extract_failed")?;

    for f in &dep_folders {
        let dep_version = read_local_version(addons_dir, f);
        metadata::record_install(store, f, dep_id, &dep_version, &dep_info.download_url);
    }
    Ok(dep_folders)
}

/// Read the local manifest version for a folder, or empty string if not found.
fn read_local_version(addons_dir: &Path, folder: &str) -> String {
    find_manifest(addons_dir, folder)
        .and_then(|p| manifest::parse_manifest(folder, &p))
        .map(|m| m.version)
        .unwrap_or_default()
}

fn find_manifest(addons_dir: &std::path::Path, folder_name: &str) -> Option<PathBuf> {
    let dir = addons_dir.join(folder_name);
    let txt = dir.join(format!("{}.txt", folder_name));
    if txt.exists() {
        return Some(txt);
    }
    let addon = dir.join(format!("{}.addon", folder_name));
    if addon.exists() {
        return Some(addon);
    }
    None
}

fn default_addons_path() -> Option<PathBuf> {
    let docs = dirs::document_dir()?;
    let addons = docs
        .join("Elder Scrolls Online")
        .join("live")
        .join("AddOns");
    if addons.is_dir() {
        Some(addons)
    } else {
        None
    }
}

#[tauri::command]
pub fn detect_addons_folder() -> Result<String, String> {
    default_addons_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find ESO AddOns folder. Please set it manually.".to_string())
}

#[tauri::command]
pub async fn scan_installed_addons(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<Vec<AddonManifest>, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || scan_installed_addons_blocking(&addons_dir))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn scan_installed_addons_blocking(addons_dir: &Path) -> Result<Vec<AddonManifest>, String> {
    let entries =
        fs::read_dir(addons_dir).map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

    let mut addons: Vec<AddonManifest> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let manifest_path = match find_manifest(addons_dir, &folder_name) {
            Some(p) => p,
            None => continue,
        };

        if let Some(addon) = manifest::parse_manifest(&folder_name, &manifest_path) {
            addons.push(addon);
        }
    }

    // Build set of ALL directory names in AddOns folder for dependency checking.
    // This includes folders without manifests (data folders) and catches everything
    // ESO would recognize. ESO also searches subfolders up to 3 levels deep for
    // embedded libraries, so we scan those too.
    let mut installed: HashSet<String> = HashSet::new();
    if let Ok(top_entries) = fs::read_dir(addons_dir) {
        for entry in top_entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                installed.insert(name.to_string());
            }
            // Scan subfolders (1-2 levels deep) for embedded libraries
            if let Ok(sub_entries) = fs::read_dir(&path) {
                for sub in sub_entries.flatten() {
                    if sub.path().is_dir() {
                        if let Some(name) = sub.path().file_name().and_then(|n| n.to_str()) {
                            installed.insert(name.to_string());
                        }
                        // One more level (libs/LibFoo/)
                        if let Ok(sub2_entries) = fs::read_dir(sub.path()) {
                            for sub2 in sub2_entries.flatten() {
                                if sub2.path().is_dir() {
                                    if let Some(name) =
                                        sub2.path().file_name().and_then(|n| n.to_str())
                                    {
                                        installed.insert(name.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Load metadata and clean up stale entries:
    // - Remove entries for addon folders that no longer exist on disk
    // - Deduplicate entries with the same esoui_id (keep the one that exists)
    let mut store = metadata::load_metadata(addons_dir);
    let stale: Vec<String> = store
        .addons
        .keys()
        .filter(|name| !addons_dir.join(name).is_dir())
        .cloned()
        .collect();
    if !stale.is_empty() {
        for name in &stale {
            metadata::remove_entry(&mut store, name);
        }
        let _ = metadata::save_metadata(addons_dir, &store);
    }

    // Check for missing dependencies and enrich with ESOUI ID
    for addon in &mut addons {
        addon.missing_dependencies = addon
            .depends_on
            .iter()
            .filter(|dep| !installed.contains(&dep.name))
            .map(|dep| dep.name.clone())
            .collect();

        if let Some(meta) = store.addons.get(&addon.folder_name) {
            addon.esoui_id = Some(meta.esoui_id);
            addon.tags = meta.tags.clone();
            addon.esoui_last_update = meta.esoui_last_update;
        }
    }

    addons.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    Ok(addons)
}

#[tauri::command]
pub async fn set_addon_tags(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    folder_name: String,
    tags: Vec<String>,
) -> Result<(), String> {
    validate_name(&folder_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || {
        let mut store = metadata::load_metadata(&addons_dir);
        match store.addons.get_mut(&folder_name) {
            Some(meta) => meta.tags = tags,
            None => {
                // Create a minimal entry for untracked addons so tags can be saved
                store.addons.insert(
                    folder_name.clone(),
                    metadata::AddonMetadata {
                        esoui_id: 0,
                        installed_version: String::new(),
                        download_url: String::new(),
                        installed_at: String::new(),
                        tags,
                        esoui_last_update: 0,
                    },
                );
            }
        }
        metadata::save_metadata(&addons_dir, &store)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn resolve_esoui_addon(input: String) -> Result<EsouiAddonInfo, String> {
    tokio::task::spawn_blocking(move || {
        let id = esoui::parse_esoui_input(&input)?;
        esoui::fetch_addon_info(id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn fetch_esoui_detail(esoui_id: u32) -> Result<EsouiAddonDetail, String> {
    tokio::task::spawn_blocking(move || esoui::fetch_addon_detail(esoui_id))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn search_esoui_addons(query: String) -> Result<Vec<EsouiSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    tokio::task::spawn_blocking(move || esoui::search_esoui(&query))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn install_addon(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    download_url: String,
    esoui_id: u32,
    esoui_title: String,
    esoui_version: String,
) -> Result<InstallResult, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;

    if !download_url.starts_with("https://cdn.esoui.com/")
        && !download_url.starts_with("https://www.esoui.com/")
    {
        return Err("Invalid download URL: only ESOUI download links are allowed.".to_string());
    }

    tokio::task::spawn_blocking(move || {
        install_addon_blocking(
            &addons_dir,
            &download_url,
            esoui_id,
            &esoui_title,
            &esoui_version,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn install_addon_blocking(
    addons_dir: &Path,
    download_url: &str,
    esoui_id: u32,
    esoui_title: &str,
    esoui_version: &str,
) -> Result<InstallResult, String> {
    let tmp_file = esoui::download_addon(download_url)?;
    let installed_folders = installer::extract_addon_zip(tmp_file.path(), addons_dir)?;

    let mut store = metadata::load_metadata(addons_dir);

    // Only the primary folder gets the esoui_id so that check_for_updates
    // compares versions correctly. Secondary folders get esoui_id 0.
    record_installed_folders(
        &mut store,
        addons_dir,
        &installed_folders,
        esoui_id,
        esoui_version,
        esoui_title,
        download_url,
        0, // esoui_last_update will be populated during next update check
    );

    let mut all_installed: HashSet<String> = HashSet::new();
    if let Ok(entries) = fs::read_dir(addons_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    all_installed.insert(name.to_string());
                }
            }
        }
    }

    let mut missing_deps: Vec<String> = Vec::new();
    for folder in &installed_folders {
        let addon =
            find_manifest(addons_dir, folder).and_then(|p| manifest::parse_manifest(folder, &p));
        if let Some(addon) = addon {
            for dep in &addon.depends_on {
                if !all_installed.contains(&dep.name) && !missing_deps.contains(&dep.name) {
                    missing_deps.push(dep.name.clone());
                }
            }
        }
    }

    let mut installed_deps: Vec<String> = Vec::new();
    let mut failed_deps: Vec<String> = Vec::new();
    let mut skipped_deps: Vec<String> = Vec::new();

    for dep_name in &missing_deps {
        match try_install_dep(dep_name, addons_dir, &mut store) {
            Ok(dep_folders) => {
                for f in &dep_folders {
                    all_installed.insert(f.clone());
                }
                installed_deps.push(dep_name.clone());
            }
            Err("not_found") => skipped_deps.push(dep_name.clone()),
            Err(_) => failed_deps.push(dep_name.clone()),
        }
    }

    metadata::save_metadata(addons_dir, &store)?;

    Ok(InstallResult {
        installed_folders,
        installed_deps,
        failed_deps,
        skipped_deps,
    })
}

#[tauri::command]
pub fn remove_addon(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    folder_name: String,
) -> Result<(), String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    installer::remove_addon(&addons_dir, &folder_name)?;

    // Clean up metadata
    let mut store = metadata::load_metadata(&addons_dir);
    metadata::remove_entry(&mut store, &folder_name);
    metadata::save_metadata(&addons_dir, &store)?;

    Ok(())
}

#[tauri::command]
pub async fn install_dependency(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    dep_name: String,
) -> Result<InstallResult, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || install_dependency_blocking(&addons_dir, &dep_name))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn install_dependency_blocking(addons_dir: &Path, dep_name: &str) -> Result<InstallResult, String> {
    let mut store = metadata::load_metadata(addons_dir);
    match try_install_dep(dep_name, addons_dir, &mut store) {
        Ok(folders) => {
            metadata::save_metadata(addons_dir, &store)?;
            Ok(InstallResult {
                installed_folders: folders,
                installed_deps: vec![],
                failed_deps: vec![],
                skipped_deps: vec![],
            })
        }
        Err(reason) => Err(format!("Failed to install {}: {}", dep_name, reason)),
    }
}

#[tauri::command]
pub async fn check_for_updates(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<Vec<UpdateCheckResult>, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || check_for_updates_blocking(&addons_dir))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn check_for_updates_blocking(addons_dir: &Path) -> Result<Vec<UpdateCheckResult>, String> {
    let mut store = metadata::load_metadata(addons_dir);
    let mut metadata_changed = false;

    // Fetch the full ESOUI filelist in a single API call
    let api_lookup = esoui::fetch_filelist_lookup()?;

    let mut results: Vec<UpdateCheckResult> = Vec::new();

    let folder_names: Vec<String> = store.addons.keys().cloned().collect();

    for folder_name in &folder_names {
        if !addons_dir.join(folder_name).is_dir() {
            continue;
        }

        let meta = match store.addons.get(folder_name) {
            Some(m) => m.clone(),
            None => continue,
        };

        // Skip bundled secondary folders (esoui_id 0)
        if meta.esoui_id == 0 {
            continue;
        }

        // Look up the addon in the API data
        let api_entry = match api_lookup.get(folder_name) {
            Some(entry) => entry,
            None => continue,
        };

        // Normalize versions: strip leading "v"/"V" and trim whitespace
        let local_ver = meta
            .installed_version
            .trim()
            .strip_prefix('v')
            .or_else(|| meta.installed_version.trim().strip_prefix('V'))
            .unwrap_or(meta.installed_version.trim());
        let remote_ver = api_entry
            .version
            .trim()
            .strip_prefix('v')
            .or_else(|| api_entry.version.trim().strip_prefix('V'))
            .unwrap_or(api_entry.version.trim());

        let has_update = !remote_ver.is_empty() && !local_ver.is_empty() && remote_ver != local_ver;

        // Sync stored version format
        if let Some(entry) = store.addons.get_mut(folder_name) {
            if !has_update && meta.installed_version != api_entry.version {
                entry.installed_version = api_entry.version.clone();
                metadata_changed = true;
            }
            // Sync last_update from API
            if entry.esoui_last_update != api_entry.last_update {
                entry.esoui_last_update = api_entry.last_update;
                metadata_changed = true;
            }
        }

        // Only fetch the download URL for addons that actually have updates
        // (avoids N extra HTTP requests for up-to-date addons)
        let download_url = if has_update {
            esoui::fetch_addon_info(meta.esoui_id)
                .map(|info| info.download_url)
                .unwrap_or_else(|_| meta.download_url.clone())
        } else {
            meta.download_url.clone()
        };

        results.push(UpdateCheckResult {
            folder_name: folder_name.clone(),
            esoui_id: meta.esoui_id,
            current_version: meta.installed_version.clone(),
            remote_version: api_entry.version.clone(),
            download_url,
            has_update,
        });
    }

    if metadata_changed {
        let _ = metadata::save_metadata(addons_dir, &store);
    }

    Ok(results)
}

#[tauri::command]
pub async fn update_addon(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    esoui_id: u32,
    api_version: Option<String>,
) -> Result<InstallResult, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || {
        update_addon_blocking(&addons_dir, esoui_id, api_version.as_deref())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn update_addon_blocking(
    addons_dir: &Path,
    esoui_id: u32,
    api_version: Option<&str>,
) -> Result<InstallResult, String> {
    // Fetch latest info from ESOUI
    let info = esoui::fetch_addon_info(esoui_id)?;

    // Download and extract
    let tmp_file = esoui::download_addon(&info.download_url)?;
    let installed_folders = installer::extract_addon_zip(tmp_file.path(), addons_dir)?;

    // Store the API version (from filelist.json) when available, since
    // check_for_updates compares against the API version. Using the
    // HTML-scraped version here caused perpetual "update available" when
    // the two sources returned slightly different version strings.
    let version = api_version.unwrap_or(&info.version);

    // Clean up any old metadata entries for the same esoui_id
    // that aren't in the newly extracted folders (handles addon renames).
    let mut store = metadata::load_metadata(addons_dir);
    let old_folders: Vec<String> = store
        .addons
        .iter()
        .filter(|(_, m)| m.esoui_id == esoui_id)
        .map(|(name, _)| name.clone())
        .collect();
    for old in &old_folders {
        if !installed_folders.contains(old) {
            metadata::remove_entry(&mut store, old);
        }
    }
    record_installed_folders(
        &mut store,
        addons_dir,
        &installed_folders,
        esoui_id,
        version,
        &info.title,
        &info.download_url,
        0, // preserved from existing metadata
    );
    metadata::save_metadata(addons_dir, &store)?;

    Ok(InstallResult {
        installed_folders,
        installed_deps: Vec::new(),
        failed_deps: Vec::new(),
        skipped_deps: Vec::new(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEntry {
    pub esoui_id: u32,
    pub folder_name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub version: u32,
    pub addons: Vec<ExportEntry>,
}

#[tauri::command]
pub fn export_addon_list(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<String, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let store = metadata::load_metadata(&addons_dir);

    let mut entries: Vec<ExportEntry> = store
        .addons
        .iter()
        .filter(|(folder, _)| addons_dir.join(folder).is_dir())
        .map(|(folder, meta)| ExportEntry {
            esoui_id: meta.esoui_id,
            folder_name: folder.clone(),
            version: meta.installed_version.clone(),
        })
        .collect();

    entries.sort_by(|a, b| a.folder_name.cmp(&b.folder_name));

    // Deduplicate by esoui_id (multiple folders can share an ID),
    // but keep all untracked entries (esoui_id == 0)
    let mut seen_ids: HashSet<u32> = HashSet::new();
    entries.retain(|e| e.esoui_id == 0 || seen_ids.insert(e.esoui_id));

    let export = ExportData {
        version: 1,
        addons: entries,
    };

    serde_json::to_string_pretty(&export).map_err(|e| format!("Failed to export: {}", e))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub installed: Vec<String>,
    pub failed: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLinkResult {
    pub linked: Vec<String>,
    pub not_found: Vec<String>,
}

/// Try to auto-link untracked addons to their ESOUI IDs by searching ESOUI.
#[tauri::command]
pub async fn auto_link_addons(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<AutoLinkResult, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    tokio::task::spawn_blocking(move || auto_link_addons_blocking(&addons_dir))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn auto_link_addons_blocking(addons_dir: &Path) -> Result<AutoLinkResult, String> {
    // Fetch the full ESOUI filelist in a single API call (~4000 addons).
    let api_lookup = esoui::fetch_filelist_lookup()?;

    let mut store = metadata::load_metadata(addons_dir);

    let entries =
        fs::read_dir(addons_dir).map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

    let mut linked: Vec<String> = Vec::new();
    let mut not_found: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Must have a manifest to be a real addon
        if find_manifest(addons_dir, &folder_name).is_none() {
            continue;
        }

        // Look up this folder name in the API data
        if let Some(api_entry) = api_lookup.get(&folder_name) {
            let already_tracked = store.addons.get(&folder_name);

            // Skip bundled secondary folders: if esouiId is 0 and another
            // addon in the store installed this folder (shares download_url),
            // don't auto-link it to its own ESOUI entry — that would cause
            // version mismatches since the bundled version differs from the
            // standalone version.
            let is_bundled_secondary = already_tracked.is_some_and(|m| {
                m.esoui_id == 0
                    && store
                        .addons
                        .values()
                        .any(|other| other.esoui_id != 0 && other.download_url == m.download_url)
            });
            if is_bundled_secondary {
                continue;
            }

            let needs_update = match already_tracked {
                Some(meta) => {
                    // Update existing entries: fill in missing esoui_id or last_update
                    (meta.esoui_id == 0 && api_entry.esoui_id > 0)
                        || meta.esoui_last_update == 0
                        || meta.esoui_last_update != api_entry.last_update
                }
                None => true,
            };
            if needs_update {
                let version = already_tracked
                    .map(|m| m.installed_version.clone())
                    .unwrap_or_else(|| read_local_version(addons_dir, &folder_name));
                let download_url = already_tracked
                    .map(|m| m.download_url.clone())
                    .unwrap_or_else(|| api_entry.file_info_uri.clone());
                metadata::record_install_ext(
                    &mut store,
                    &folder_name,
                    api_entry.esoui_id,
                    &version,
                    &download_url,
                    api_entry.last_update,
                );
                linked.push(folder_name);
            }
        } else if !store.addons.contains_key(&folder_name) {
            not_found.push(folder_name);
        }
    }

    metadata::save_metadata(addons_dir, &store)?;

    Ok(AutoLinkResult { linked, not_found })
}

/// Batch remove multiple addons.
#[tauri::command]
pub fn batch_remove_addons(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    folder_names: Vec<String>,
) -> Result<Vec<String>, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let mut store = metadata::load_metadata(&addons_dir);
    let mut removed: Vec<String> = Vec::new();

    for name in &folder_names {
        if installer::remove_addon(&addons_dir, name).is_ok() {
            metadata::remove_entry(&mut store, name);
            removed.push(name.clone());
        }
    }

    metadata::save_metadata(&addons_dir, &store)?;
    Ok(removed)
}

#[tauri::command]
pub async fn import_addon_list(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    json_data: String,
) -> Result<ImportResult, String> {
    let export: ExportData =
        serde_json::from_str(&json_data).map_err(|e| format!("Invalid export file: {}", e))?;

    let addons_dir = require_allowed_path(&state, &addons_path)?;

    tokio::task::spawn_blocking(move || import_addon_list_blocking(&addons_dir, &export))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn import_addon_list_blocking(
    addons_dir: &Path,
    export: &ExportData,
) -> Result<ImportResult, String> {
    let mut installed: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    let mut store = metadata::load_metadata(addons_dir);

    for entry in &export.addons {
        // Skip if already installed
        if addons_dir.join(&entry.folder_name).is_dir() {
            skipped.push(entry.folder_name.clone());
            continue;
        }

        match esoui::fetch_addon_info(entry.esoui_id) {
            Ok(info) => match esoui::download_addon(&info.download_url) {
                Ok(tmp) => match installer::extract_addon_zip(tmp.path(), addons_dir) {
                    Ok(folders) => {
                        record_installed_folders(
                            &mut store,
                            addons_dir,
                            &folders,
                            entry.esoui_id,
                            &info.version,
                            &info.title,
                            &info.download_url,
                            0, // will be populated by auto_link
                        );
                        installed.push(entry.folder_name.clone());
                    }
                    Err(_) => failed.push(entry.folder_name.clone()),
                },
                Err(_) => failed.push(entry.folder_name.clone()),
            },
            Err(_) => failed.push(entry.folder_name.clone()),
        }

        // Be respectful to ESOUI
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    metadata::save_metadata(addons_dir, &store)?;

    Ok(ImportResult {
        installed,
        failed,
        skipped,
    })
}

// ─── Category Browsing ───────────────────────────────────────

#[tauri::command]
pub async fn get_esoui_categories() -> Result<Vec<EsouiCategory>, String> {
    tokio::task::spawn_blocking(esoui::fetch_categories)
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn browse_esoui_category(
    category_id: u32,
    page: u32,
    sort_by: String,
) -> Result<Vec<esoui::EsouiSearchResult>, String> {
    tokio::task::spawn_blocking(move || esoui::browse_category(category_id, page, &sort_by))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

// ─── API Version Compatibility ───────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCompatInfo {
    pub game_api_version: u32,
    pub outdated_addons: Vec<String>,
    pub up_to_date_addons: Vec<String>,
}

#[tauri::command]
pub fn check_api_compatibility(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<ApiCompatInfo, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    // Read the game's current API version from AddOnSettings.txt
    let settings_path = addons_dir
        .parent()
        .map(|p| p.join("AddOnSettings.txt"))
        .ok_or("Could not find AddOnSettings.txt.")?;

    let game_api_version = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read AddOnSettings.txt: {}", e))?;
        content
            .lines()
            .find(|line| line.starts_with("#Version"))
            .and_then(|line| line.strip_prefix("#Version").map(|s| s.trim()))
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0)
    } else {
        return Err(
            "AddOnSettings.txt not found. Make sure you've launched ESO at least once.".to_string(),
        );
    };

    if game_api_version == 0 {
        return Err("Could not determine game API version.".to_string());
    }

    // Check each addon's APIVersion against the game's version
    let entries =
        fs::read_dir(&addons_dir).map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

    let mut outdated_addons: Vec<String> = Vec::new();
    let mut up_to_date_addons: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let manifest = find_manifest(&addons_dir, &folder_name)
            .and_then(|p| manifest::parse_manifest(&folder_name, &p));

        if let Some(m) = manifest {
            if m.api_version.is_empty() {
                continue;
            }
            // Addon is compatible if any of its API versions matches the game's
            let compatible = m.api_version.contains(&game_api_version);
            if compatible {
                up_to_date_addons.push(m.title);
            } else {
                outdated_addons.push(m.title);
            }
        }
    }

    outdated_addons.sort();
    up_to_date_addons.sort();

    Ok(ApiCompatInfo {
        game_api_version,
        outdated_addons,
        up_to_date_addons,
    })
}

// ─── SavedVariables Backup & Restore ─────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub created_at: String,
    pub file_count: u32,
    pub total_size: u64,
}

fn backups_dir(addons_dir: &std::path::Path) -> PathBuf {
    addons_dir
        .parent()
        .unwrap_or(addons_dir)
        .join("eso-addon-manager-backups")
}

fn saved_variables_dir(addons_dir: &std::path::Path) -> PathBuf {
    addons_dir
        .parent()
        .unwrap_or(addons_dir)
        .join("SavedVariables")
}

#[tauri::command]
pub fn list_backups(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<Vec<BackupInfo>, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let backups = backups_dir(&addons_dir);
    if !backups.is_dir() {
        return Ok(Vec::new());
    }

    let mut results: Vec<BackupInfo> = Vec::new();
    let entries =
        fs::read_dir(&backups).map_err(|e| format!("Failed to read backups folder: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Count files and total size
        let mut file_count: u32 = 0;
        let mut total_size: u64 = 0;
        if let Ok(files) = fs::read_dir(&path) {
            for f in files.flatten() {
                if f.path().is_file() {
                    file_count += 1;
                    total_size += f.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }

        // Extract timestamp from folder name or use modification time
        let created_at = fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| {
                let secs = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                metadata::format_timestamp(secs)
            })
            .unwrap_or_default();

        results.push(BackupInfo {
            name,
            created_at,
            file_count,
            total_size,
        });
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(results)
}

#[tauri::command]
pub fn create_backup(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    backup_name: String,
) -> Result<BackupInfo, String> {
    validate_name(&backup_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let sv_dir = saved_variables_dir(&addons_dir);
    if !sv_dir.is_dir() {
        return Err("SavedVariables folder not found.".to_string());
    }

    let backups = backups_dir(&addons_dir);
    fs::create_dir_all(&backups).map_err(|e| format!("Failed to create backups folder: {}", e))?;

    let backup_path = backups.join(&backup_name);
    if backup_path.exists() {
        return Err(format!("Backup '{}' already exists.", backup_name));
    }

    fs::create_dir_all(&backup_path).map_err(|e| format!("Failed to create backup: {}", e))?;

    // Copy all .lua files from SavedVariables
    let mut file_count: u32 = 0;
    let mut total_size: u64 = 0;
    let entries =
        fs::read_dir(&sv_dir).map_err(|e| format!("Failed to read SavedVariables: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                let dest = backup_path.join(name);
                if fs::copy(&path, &dest).is_ok() {
                    file_count += 1;
                    total_size += fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }

    let created_at = metadata::format_timestamp(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );

    Ok(BackupInfo {
        name: backup_name,
        created_at,
        file_count,
        total_size,
    })
}

#[tauri::command]
pub fn restore_backup(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    backup_name: String,
) -> Result<u32, String> {
    validate_name(&backup_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let sv_dir = saved_variables_dir(&addons_dir);
    let backup_path = backups_dir(&addons_dir).join(&backup_name);

    if !backup_path.is_dir() {
        return Err(format!("Backup '{}' not found.", backup_name));
    }

    fs::create_dir_all(&sv_dir)
        .map_err(|e| format!("Failed to create SavedVariables folder: {}", e))?;

    let mut restored: u32 = 0;
    let entries =
        fs::read_dir(&backup_path).map_err(|e| format!("Failed to read backup: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                let dest = sv_dir.join(name);
                if fs::copy(&path, &dest).is_ok() {
                    restored += 1;
                }
            }
        }
    }

    Ok(restored)
}

#[tauri::command]
pub fn delete_backup(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    backup_name: String,
) -> Result<(), String> {
    validate_name(&backup_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let backup_path = backups_dir(&addons_dir).join(&backup_name);

    if !backup_path.is_dir() {
        return Err(format!("Backup '{}' not found.", backup_name));
    }

    fs::remove_dir_all(&backup_path).map_err(|e| format!("Failed to delete backup: {}", e))
}

// ─── Addon Profiles ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonProfile {
    pub name: String,
    pub enabled_addons: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfileStore {
    pub profiles: Vec<AddonProfile>,
    pub active_profile: Option<String>,
}

fn profiles_path(addons_dir: &std::path::Path) -> PathBuf {
    addons_dir.join("eso-addon-manager-profiles.json")
}

fn load_profiles(addons_dir: &std::path::Path) -> ProfileStore {
    metadata::load_json_with_backup(&profiles_path(addons_dir))
}

fn save_profiles(addons_dir: &std::path::Path, store: &ProfileStore) -> Result<(), String> {
    metadata::save_json_with_backup(&profiles_path(addons_dir), store)
}

#[tauri::command]
pub fn list_profiles(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<(Vec<AddonProfile>, Option<String>), String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let store = load_profiles(&addons_dir);
    Ok((store.profiles, store.active_profile))
}

#[tauri::command]
pub fn create_profile(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    profile_name: String,
) -> Result<AddonProfile, String> {
    validate_name(&profile_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let mut store = load_profiles(&addons_dir);

    if store.profiles.iter().any(|p| p.name == profile_name) {
        return Err(format!("Profile '{}' already exists.", profile_name));
    }

    // Snapshot currently enabled addons (those with manifests in the AddOns folder)
    let mut enabled: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&addons_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let folder_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };
            // Only include folders with manifests (actual addons)
            if find_manifest(&addons_dir, &folder_name).is_some() {
                enabled.push(folder_name);
            }
        }
    }
    enabled.sort();

    let profile = AddonProfile {
        name: profile_name,
        enabled_addons: enabled,
        created_at: metadata::format_timestamp(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        ),
    };

    store.profiles.push(profile.clone());
    save_profiles(&addons_dir, &store)?;

    Ok(profile)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateProfileResult {
    pub enabled: Vec<String>,
    pub disabled: Vec<String>,
    pub failed: Vec<String>,
}

#[tauri::command]
pub fn activate_profile(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    profile_name: String,
) -> Result<ActivateProfileResult, String> {
    validate_name(&profile_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let mut store = load_profiles(&addons_dir);

    let profile = store
        .profiles
        .iter()
        .find(|p| p.name == profile_name)
        .cloned()
        .ok_or_else(|| format!("Profile '{}' not found.", profile_name))?;

    let enabled_set: HashSet<String> = profile.enabled_addons.iter().cloned().collect();

    let mut disabled: Vec<String> = Vec::new();
    let mut enabled: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    if let Ok(entries) = fs::read_dir(&addons_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let folder_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            // Skip non-addon folders and our own files
            if folder_name.starts_with("eso-addon-manager") {
                continue;
            }

            let is_disabled = folder_name.ends_with(".disabled");
            let base_name = folder_name
                .strip_suffix(".disabled")
                .unwrap_or(&folder_name)
                .to_string();

            if enabled_set.contains(&base_name) {
                // Should be enabled
                if is_disabled {
                    let new_path = addons_dir.join(&base_name);
                    match fs::rename(&path, &new_path) {
                        Ok(_) => enabled.push(base_name),
                        Err(e) => failed.push(format!("{} (enable: {})", base_name, e)),
                    }
                }
            } else {
                // Should be disabled
                if !is_disabled && find_manifest(&addons_dir, &folder_name).is_some() {
                    let new_path = addons_dir.join(format!("{}.disabled", folder_name));
                    match fs::rename(&path, &new_path) {
                        Ok(_) => disabled.push(folder_name),
                        Err(e) => failed.push(format!("{} (disable: {})", folder_name, e)),
                    }
                }
            }
        }
    }

    store.active_profile = Some(profile_name);
    save_profiles(&addons_dir, &store)?;

    Ok(ActivateProfileResult {
        enabled,
        disabled,
        failed,
    })
}

#[tauri::command]
pub fn delete_profile(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    profile_name: String,
) -> Result<(), String> {
    validate_name(&profile_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let mut store = load_profiles(&addons_dir);

    store.profiles.retain(|p| p.name != profile_name);
    if store.active_profile.as_deref() == Some(&profile_name) {
        store.active_profile = None;
    }

    save_profiles(&addons_dir, &store)
}

// ─── Multi-Character SavedVariables ──────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterInfo {
    pub server: String,
    pub name: String,
}

#[tauri::command]
pub fn list_characters(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<Vec<CharacterInfo>, String> {
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let settings_path = addons_dir
        .parent()
        .map(|p| p.join("AddOnSettings.txt"))
        .ok_or("Could not find AddOnSettings.txt.")?;

    if !settings_path.exists() {
        return Err("AddOnSettings.txt not found.".to_string());
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read AddOnSettings.txt: {}", e))?;

    let mut characters: Vec<CharacterInfo> = Vec::new();
    let skip_prefixes = ["Version", "Acknowledged", "AddOnsEnabled"];

    for line in content.lines() {
        let Some(line) = line.strip_prefix('#') else {
            continue;
        };
        if skip_prefixes.iter().any(|p| line.starts_with(p)) {
            continue;
        }
        if let Some(pos) = line.find('-') {
            let server = line[..pos].trim().to_string();
            let name = line[pos + 1..].trim().to_string();
            if !server.is_empty() && !name.is_empty() {
                // Deduplicate
                if !characters
                    .iter()
                    .any(|c| c.server == server && c.name == name)
                {
                    characters.push(CharacterInfo { server, name });
                }
            }
        }
    }

    Ok(characters)
}

#[tauri::command]
pub fn backup_character_settings(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
    character_name: String,
    backup_name: String,
) -> Result<u32, String> {
    if character_name.trim().is_empty() {
        return Err("Character name cannot be empty.".to_string());
    }
    validate_name(&backup_name)?;
    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let sv_dir = saved_variables_dir(&addons_dir);
    if !sv_dir.is_dir() {
        return Err("SavedVariables folder not found.".to_string());
    }

    let backups = backups_dir(&addons_dir).join(format!("char-{}", backup_name));
    fs::create_dir_all(&backups).map_err(|e| format!("Failed to create backup folder: {}", e))?;

    // Copy all SavedVariables files that contain this character's data
    let mut count: u32 = 0;
    if let Ok(entries) = fs::read_dir(&sv_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                // Check if file mentions this character
                if let Ok(content) = fs::read_to_string(&path) {
                    if content.contains(&character_name) {
                        if let Some(name) = path.file_name() {
                            let dest = backups.join(name);
                            if fs::copy(&path, &dest).is_ok() {
                                count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(count)
}

// ─── Minion Migration ────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinionAddon {
    pub uid: u32,
    pub version: String,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinionMigrationResult {
    pub found: bool,
    pub addon_count: u32,
    pub imported: u32,
    pub already_tracked: u32,
}

fn find_minion_xml() -> Option<PathBuf> {
    if let Some(home) = dirs::home_dir() {
        let path = home.join(".minion").join("minion.xml");
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn parse_minion_addons(xml_content: &str) -> Vec<MinionAddon> {
    let mut addons: Vec<MinionAddon> = Vec::new();
    static RE_ADDON: OnceLock<Regex> = OnceLock::new();
    let re_addon = RE_ADDON.get_or_init(|| {
        Regex::new(r#"<addon[^>]*uid="(\d+)"[^>]*ui-version="([^"]*)"[^>]*>"#).unwrap()
    });
    static RE_DIR: OnceLock<Regex> = OnceLock::new();
    let re_dir = RE_DIR.get_or_init(|| Regex::new(r"<dir>([^<]+)</dir>").unwrap());

    // Simple state machine parser for Minion XML
    let mut current_uid: Option<u32> = None;
    let mut current_version = String::new();
    let mut current_dirs: Vec<String> = Vec::new();

    for line in xml_content.lines() {
        let line = line.trim();
        if let Some(caps) = re_addon.captures(line) {
            // Save previous addon if any
            if let Some(uid) = current_uid {
                if !current_dirs.is_empty() {
                    addons.push(MinionAddon {
                        uid,
                        version: current_version.clone(),
                        folders: current_dirs.clone(),
                    });
                }
            }
            current_uid = caps[1].parse::<u32>().ok();
            current_version = caps[2].to_string();
            current_dirs = Vec::new();
        } else if let Some(caps) = re_dir.captures(line) {
            current_dirs.push(caps[1].to_string());
        } else if line.contains("</addon>") {
            if let Some(uid) = current_uid {
                if !current_dirs.is_empty() {
                    addons.push(MinionAddon {
                        uid,
                        version: current_version.clone(),
                        folders: current_dirs.clone(),
                    });
                }
            }
            current_uid = None;
            current_dirs = Vec::new();
        }
    }

    addons
}

#[tauri::command]
pub fn detect_minion() -> Result<bool, String> {
    Ok(find_minion_xml().is_some())
}

#[tauri::command]
pub fn migrate_from_minion(
    state: tauri::State<'_, AllowedAddonsPath>,
    addons_path: String,
) -> Result<MinionMigrationResult, String> {
    let xml_path = find_minion_xml().ok_or("Minion installation not found.")?;

    let content =
        fs::read_to_string(&xml_path).map_err(|e| format!("Failed to read Minion data: {}", e))?;

    let minion_addons = parse_minion_addons(&content);
    let addon_count = minion_addons.len() as u32;

    let addons_dir = require_allowed_path(&state, &addons_path)?;
    let mut store = metadata::load_metadata(&addons_dir);

    let mut imported: u32 = 0;
    let mut already_tracked: u32 = 0;

    for addon in &minion_addons {
        for folder in &addon.folders {
            if store.addons.contains_key(folder) {
                already_tracked += 1;
                continue;
            }
            // Only import if the folder actually exists on disk
            if addons_dir.join(folder).is_dir() {
                metadata::record_install(
                    &mut store,
                    folder,
                    addon.uid,
                    &addon.version,
                    &format!(
                        "https://www.esoui.com/downloads/landing.php?fileid={}",
                        addon.uid
                    ),
                );
                imported += 1;
            }
        }
    }

    metadata::save_metadata(&addons_dir, &store)?;

    Ok(MinionMigrationResult {
        found: true,
        addon_count,
        imported,
        already_tracked,
    })
}

// ── Pack Hub API (roster-hub-api) ──────────────────────────────────────────

/// Base URL for the Pack Hub (shared with the website).
fn pack_hub_url() -> &'static str {
    static URL: OnceLock<String> = OnceLock::new();
    URL.get_or_init(|| {
        std::env::var("PACK_HUB_API_URL")
            .unwrap_or_else(|_| "https://roster-hub-api.eso-toolkit.workers.dev".to_string())
    })
}

/// Validate a pack ID to prevent path traversal in URL interpolation.
fn validate_pack_id(id: &str) -> Result<(), String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap());
    if id.is_empty() || id.len() > 100 || !re.is_match(id) {
        return Err("Invalid pack ID.".to_string());
    }
    Ok(())
}

fn pack_hub_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .user_agent(format!("ESOAddonManager/{}", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build pack hub HTTP client")
    })
}

// ── Pack structs (matching roster-hub-api response) ───────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackAddonEntry {
    pub esoui_id: u32,
    pub name: String,
    #[serde(default = "default_true")]
    pub required: bool,
    pub note: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Full pack object returned by the roster-hub-api.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct HubPack {
    pub id: String,
    #[serde(default)]
    pub author_id: String,
    pub author_name: String,
    pub is_anonymous: bool,
    pub title: String,
    pub description: String,
    pub pack_type: String,
    pub addons: serde_json::Value, // JSON string from D1 or parsed array
    pub vote_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub user_voted: Option<bool>,
}

/// Frontend-friendly pack struct sent to the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
    pub id: String,
    pub author_id: String,
    pub title: String,
    pub description: String,
    pub pack_type: String,
    pub author_name: String,
    pub is_anonymous: bool,
    pub vote_count: i64,
    pub user_voted: bool,
    pub tags: Vec<String>,
    pub addons: Vec<PackAddonEntry>,
    pub created_at: String,
    pub updated_at: String,
}

impl Pack {
    fn from_hub(hub: HubPack) -> Self {
        let addons: Vec<PackAddonEntry> = match &hub.addons {
            serde_json::Value::String(s) => serde_json::from_str(s).unwrap_or_else(|e| {
                eprintln!(
                    "Warning: failed to parse addons JSON string for pack {}: {}",
                    hub.id, e
                );
                Vec::new()
            }),
            serde_json::Value::Array(_) => serde_json::from_value(hub.addons.clone())
                .unwrap_or_else(|e| {
                    eprintln!(
                        "Warning: failed to parse addons array for pack {}: {}",
                        hub.id, e
                    );
                    Vec::new()
                }),
            _ => {
                eprintln!(
                    "Warning: unexpected addons type for pack {}: {}",
                    hub.id, hub.addons
                );
                Vec::new()
            }
        };
        Self {
            id: hub.id,
            author_id: hub.author_id,
            title: hub.title,
            description: hub.description,
            pack_type: hub.pack_type,
            author_name: if hub.is_anonymous {
                "Anonymous".to_string()
            } else {
                hub.author_name
            },
            is_anonymous: hub.is_anonymous,
            vote_count: hub.vote_count,
            user_voted: hub.user_voted.unwrap_or(false),
            tags: hub.tags,
            addons,
            created_at: hub.created_at,
            updated_at: hub.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackListResponse {
    pub packs: Vec<HubPack>,
    pub page: i64,
    pub sort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSingleResponse {
    pub pack: HubPack,
}

/// Response sent to the frontend with packs and the current page number.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPage {
    pub packs: Vec<Pack>,
    pub page: i64,
}

#[tauri::command]
pub async fn list_packs(
    state: tauri::State<'_, AuthState>,
    pack_type: Option<String>,
    tag: Option<String>,
    query: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
) -> Result<PackPage, String> {
    let access_token = get_current_token(&state);

    tokio::task::spawn_blocking(move || {
        let client = pack_hub_client();
        let base = pack_hub_url();
        let url = format!("{}/packs", base);

        let mut query_params: Vec<(&str, String)> = Vec::new();
        if let Some(t) = &pack_type {
            query_params.push(("type", t.clone()));
        }
        if let Some(t) = &tag {
            query_params.push(("tag", t.clone()));
        }
        if let Some(q) = &query {
            query_params.push(("q", q.clone()));
        }
        if let Some(s) = &sort {
            query_params.push(("sort", s.clone()));
        }
        if let Some(p) = &page {
            query_params.push(("page", p.to_string()));
        }

        let mut req = client.get(&url).query(&query_params);
        if let Some(token) = &access_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let response = req.send().map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                "Could not connect to Pack Hub. Check your internet connection.".to_string()
            } else {
                format!("Network error: {}", e)
            }
        })?;

        if !response.status().is_success() {
            return Err(format!("Pack Hub returned HTTP {}", response.status()));
        }

        let body: PackListResponse = response
            .json()
            .map_err(|e| format!("Failed to parse packs response: {}", e))?;

        Ok(PackPage {
            packs: body.packs.into_iter().map(Pack::from_hub).collect(),
            page: body.page,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_pack(state: tauri::State<'_, AuthState>, id: String) -> Result<Pack, String> {
    validate_pack_id(&id)?;
    let access_token = get_current_token(&state);

    tokio::task::spawn_blocking(move || {
        let client = pack_hub_client();
        let base = pack_hub_url();
        let url = format!("{}/packs/{}", base, id);

        let mut req = client.get(&url);
        if let Some(token) = &access_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        let response = req.send().map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                "Could not connect to Pack Hub. Check your internet connection.".to_string()
            } else {
                format!("Network error: {}", e)
            }
        })?;

        match response.status().as_u16() {
            200 => {}
            404 => return Err(format!("Pack \"{}\" not found.", id)),
            status => return Err(format!("Pack Hub returned HTTP {}", status)),
        }

        let body: PackSingleResponse = response
            .json()
            .map_err(|e| format!("Failed to parse pack response: {}", e))?;

        Ok(Pack::from_hub(body.pack))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Extract the current access token from auth state (if signed in).
fn get_current_token(state: &tauri::State<'_, AuthState>) -> Option<String> {
    state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|t| t.access_token.clone()))
}

// ── Vote response from the hub API ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteResponse {
    pub voted: bool,
    pub vote_count: i64,
}

#[tauri::command]
pub async fn vote_pack(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
    pack_id: String,
) -> Result<VoteResponse, String> {
    validate_pack_id(&pack_id)?;
    // Get current access token (refresh if needed)
    let access_token = {
        let tokens = {
            let guard = state
                .0
                .lock()
                .map_err(|e| format!("Auth lock poisoned: {}", e))?;
            guard.clone()
        };

        let Some(tokens) = tokens else {
            return Err("Sign in to vote on packs.".to_string());
        };

        match tokio::task::spawn_blocking({
            let tokens = tokens.clone();
            move || auth::ensure_valid_token(&tokens)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        {
            Ok(Some(new_tokens)) => {
                let token = new_tokens.access_token.clone();
                save_auth_tokens(&app, &new_tokens);
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = Some(new_tokens);
                token
            }
            Ok(None) => tokens.access_token.clone(),
            Err(e) => {
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = None;
                return Err(e);
            }
        }
    };

    tokio::task::spawn_blocking(move || {
        let client = pack_hub_client();
        let base = pack_hub_url();
        let url = format!("{}/packs/{}/vote", base, pack_id);

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    "Could not connect to Pack Hub. Check your internet connection.".to_string()
                } else {
                    format!("Network error: {}", e)
                }
            })?;

        match response.status().as_u16() {
            200 => {}
            401 => return Err("Session expired. Please sign in again.".to_string()),
            404 => return Err("Pack not found.".to_string()),
            429 => return Err("Too many votes. Please wait a moment.".to_string()),
            status => {
                let body = response.text().unwrap_or_default();
                return Err(format!("Pack Hub returned HTTP {} — {}", status, body));
            }
        }

        let body: VoteResponse = response
            .json()
            .map_err(|e| format!("Failed to parse vote response: {}", e))?;

        Ok(body)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ── Auth Helpers ─────────────────────────────────────────────────────────

fn save_auth_tokens(app: &tauri::AppHandle, tokens: &AuthTokens) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        store.set(
            "auth_tokens",
            serde_json::to_value(tokens).unwrap_or_default(),
        );
    }
}

fn clear_auth_tokens(app: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        let _ = store.delete("auth_tokens");
    }
}

// ── Auth Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn auth_login(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<AuthUser, String> {
    let tokens = tokio::task::spawn_blocking(auth::login)
        .await
        .map_err(|e| format!("Task failed: {}", e))??;

    let user = AuthUser {
        user_id: tokens.user_id.clone(),
        user_name: tokens.user_name.clone(),
    };

    // Save to store
    save_auth_tokens(&app, &tokens);

    // Update in-memory state
    *state
        .0
        .lock()
        .map_err(|e| format!("Auth lock poisoned: {}", e))? = Some(tokens);

    Ok(user)
}

#[tauri::command]
pub async fn auth_logout(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Clear in-memory state
    *state
        .0
        .lock()
        .map_err(|e| format!("Auth lock poisoned: {}", e))? = None;

    // Clear from store
    clear_auth_tokens(&app);

    Ok(())
}

#[tauri::command]
pub async fn auth_get_user(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
) -> Result<Option<AuthUser>, String> {
    let tokens = {
        let guard = state
            .0
            .lock()
            .map_err(|e| format!("Auth lock poisoned: {}", e))?;
        guard.clone()
    };

    let Some(tokens) = tokens else {
        return Ok(None);
    };

    // Check if token needs refresh
    match tokio::task::spawn_blocking({
        let tokens = tokens.clone();
        move || auth::ensure_valid_token(&tokens)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
    {
        Ok(Some(new_tokens)) => {
            // Tokens were refreshed — save them
            let user = AuthUser {
                user_id: new_tokens.user_id.clone(),
                user_name: new_tokens.user_name.clone(),
            };

            save_auth_tokens(&app, &new_tokens);

            *state
                .0
                .lock()
                .map_err(|e| format!("Auth lock poisoned: {}", e))? = Some(new_tokens);
            Ok(Some(user))
        }
        Ok(None) => {
            // Token still valid
            Ok(Some(AuthUser {
                user_id: tokens.user_id,
                user_name: tokens.user_name,
            }))
        }
        Err(_) => {
            // Refresh failed — clear session
            *state
                .0
                .lock()
                .map_err(|e| format!("Auth lock poisoned: {}", e))? = None;
            clear_auth_tokens(&app);
            Ok(None)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePackPayload {
    pub title: String,
    pub description: String,
    pub pack_type: String,
    pub addons: Vec<PackAddonEntry>,
    pub tags: Vec<String>,
    pub is_anonymous: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackPayload {
    pub id: String,
    pub title: String,
    pub description: String,
    pub pack_type: String,
    pub addons: Vec<PackAddonEntry>,
    pub tags: Vec<String>,
    pub is_anonymous: bool,
}

#[tauri::command]
pub async fn create_pack(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
    payload: CreatePackPayload,
) -> Result<Pack, String> {
    // Get current access token (refresh if needed)
    let access_token = {
        let tokens = {
            let guard = state
                .0
                .lock()
                .map_err(|e| format!("Auth lock poisoned: {}", e))?;
            guard.clone()
        };

        let Some(tokens) = tokens else {
            return Err("Not signed in. Please sign in first.".to_string());
        };

        match tokio::task::spawn_blocking({
            let tokens = tokens.clone();
            move || auth::ensure_valid_token(&tokens)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        {
            Ok(Some(new_tokens)) => {
                let token = new_tokens.access_token.clone();
                save_auth_tokens(&app, &new_tokens);
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = Some(new_tokens);
                token
            }
            Ok(None) => tokens.access_token.clone(),
            Err(e) => {
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = None;
                return Err(e);
            }
        }
    };

    // POST to Pack Hub API
    tokio::task::spawn_blocking(move || {
        let client = pack_hub_client();
        let base = pack_hub_url();
        let url = format!("{}/packs", base);

        let body = serde_json::json!({
            "title": payload.title,
            "description": payload.description,
            "pack_type": payload.pack_type,
            "addons": payload.addons,
            "tags": payload.tags,
            "is_anonymous": payload.is_anonymous,
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    "Could not connect to Pack Hub. Check your internet connection.".to_string()
                } else {
                    format!("Network error: {}", e)
                }
            })?;

        match response.status().as_u16() {
            200 | 201 => {}
            401 => return Err("Session expired. Please sign in again.".to_string()),
            429 => {
                return Err("Rate limit reached. Please wait before publishing again.".to_string())
            }
            status => {
                let body = response.text().unwrap_or_default();
                return Err(format!("Pack Hub returned HTTP {} — {}", status, body));
            }
        }

        let body: PackSingleResponse = response
            .json()
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(Pack::from_hub(body.pack))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn update_pack(
    state: tauri::State<'_, AuthState>,
    app: tauri::AppHandle,
    payload: UpdatePackPayload,
) -> Result<Pack, String> {
    validate_pack_id(&payload.id)?;

    let access_token = {
        let tokens = {
            let guard = state
                .0
                .lock()
                .map_err(|e| format!("Auth lock poisoned: {}", e))?;
            guard.clone()
        };

        let Some(tokens) = tokens else {
            return Err("Not signed in. Please sign in first.".to_string());
        };

        match tokio::task::spawn_blocking({
            let tokens = tokens.clone();
            move || auth::ensure_valid_token(&tokens)
        })
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        {
            Ok(Some(new_tokens)) => {
                let token = new_tokens.access_token.clone();
                save_auth_tokens(&app, &new_tokens);
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = Some(new_tokens);
                token
            }
            Ok(None) => tokens.access_token.clone(),
            Err(e) => {
                *state
                    .0
                    .lock()
                    .map_err(|e| format!("Auth lock poisoned: {}", e))? = None;
                return Err(e);
            }
        }
    };

    tokio::task::spawn_blocking(move || {
        let client = pack_hub_client();
        let base = pack_hub_url();
        let url = format!("{}/packs/{}", base, payload.id);

        let body = serde_json::json!({
            "title": payload.title,
            "description": payload.description,
            "pack_type": payload.pack_type,
            "addons": payload.addons,
            "tags": payload.tags,
            "is_anonymous": payload.is_anonymous,
        });

        let response = client
            .put(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| {
                if e.is_connect() || e.is_timeout() {
                    "Could not connect to Pack Hub. Check your internet connection.".to_string()
                } else {
                    format!("Network error: {}", e)
                }
            })?;

        match response.status().as_u16() {
            200 => {}
            401 => return Err("Session expired. Please sign in again.".to_string()),
            403 => return Err("You can only edit packs you created.".to_string()),
            404 => return Err("Pack not found.".to_string()),
            status => {
                let body = response.text().unwrap_or_default();
                return Err(format!("Pack Hub returned HTTP {} - {}", status, body));
            }
        }

        let body: PackSingleResponse = response
            .json()
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(Pack::from_hub(body.pack))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
