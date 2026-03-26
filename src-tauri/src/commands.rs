use crate::esoui::{self, EsouiAddonDetail, EsouiAddonInfo, EsouiSearchResult};
use crate::installer;
use crate::manifest::{self, AddonManifest};
use crate::metadata;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

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
pub async fn scan_installed_addons(addons_path: String) -> Result<Vec<AddonManifest>, String> {
    tokio::task::spawn_blocking(move || scan_installed_addons_blocking(&addons_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn scan_installed_addons_blocking(addons_path: &str) -> Result<Vec<AddonManifest>, String> {
    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    let entries =
        fs::read_dir(&addons_dir).map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

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

        let manifest_path = match find_manifest(&addons_dir, &folder_name) {
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
    if let Ok(top_entries) = fs::read_dir(&addons_dir) {
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

    // Load metadata to enrich addons with ESOUI IDs
    let store = metadata::load_metadata(&addons_dir);

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
        }
    }

    addons.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    Ok(addons)
}

#[tauri::command]
pub fn resolve_esoui_addon(input: String) -> Result<EsouiAddonInfo, String> {
    let id = esoui::parse_esoui_input(&input)?;
    esoui::fetch_addon_info(id)
}

#[tauri::command]
pub fn fetch_esoui_detail(esoui_id: u32) -> Result<EsouiAddonDetail, String> {
    esoui::fetch_addon_detail(esoui_id)
}

#[tauri::command]
pub fn search_esoui_addons(query: String) -> Result<Vec<EsouiSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    esoui::search_esoui(&query)
}

#[tauri::command]
pub fn install_addon(
    addons_path: String,
    download_url: String,
    esoui_id: u32,
) -> Result<InstallResult, String> {
    // Validate download URL to only allow known ESOUI domains
    if !download_url.starts_with("https://cdn.esoui.com/")
        && !download_url.starts_with("https://www.esoui.com/")
    {
        return Err("Invalid download URL: only ESOUI download links are allowed.".to_string());
    }

    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    // Download and extract the main addon
    let tmp_file = esoui::download_addon(&download_url)?;
    let installed_folders = installer::extract_addon_zip(tmp_file.path(), &addons_dir)?;

    // Load metadata store and record the install
    let mut store = metadata::load_metadata(&addons_dir);

    // Record metadata for each installed folder
    for folder in &installed_folders {
        let version = find_manifest(&addons_dir, folder)
            .and_then(|p| manifest::parse_manifest(folder, &p))
            .map(|m| m.version)
            .unwrap_or_default();
        metadata::record_install(&mut store, folder, esoui_id, &version, &download_url);
    }

    // Collect all installed folder names (existing + newly installed)
    let mut all_installed: HashSet<String> = HashSet::new();
    if let Ok(entries) = fs::read_dir(&addons_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    all_installed.insert(name.to_string());
                }
            }
        }
    }

    // Parse manifests of newly installed addons to find dependencies
    let mut missing_deps: Vec<String> = Vec::new();
    for folder in &installed_folders {
        let addon =
            find_manifest(&addons_dir, folder).and_then(|p| manifest::parse_manifest(folder, &p));
        if let Some(addon) = addon {
            for dep in &addon.depends_on {
                if !all_installed.contains(&dep.name) && !missing_deps.contains(&dep.name) {
                    missing_deps.push(dep.name.clone());
                }
            }
        }
    }

    // Try to auto-install missing dependencies
    let mut installed_deps: Vec<String> = Vec::new();
    let mut failed_deps: Vec<String> = Vec::new();
    let mut skipped_deps: Vec<String> = Vec::new();

    for dep_name in &missing_deps {
        match esoui::search_addon_by_name(dep_name) {
            Ok(Some(dep_id)) => {
                match esoui::fetch_addon_info(dep_id) {
                    Ok(dep_info) => match esoui::download_addon(&dep_info.download_url) {
                        Ok(dep_tmp) => {
                            match installer::extract_addon_zip(dep_tmp.path(), &addons_dir) {
                                Ok(dep_folders) => {
                                    // Record metadata for auto-installed deps
                                    for f in &dep_folders {
                                        let dep_manifest_path =
                                            addons_dir.join(f).join(format!("{}.txt", f));
                                        let dep_version =
                                            manifest::parse_manifest(f, &dep_manifest_path)
                                                .map(|m| m.version)
                                                .unwrap_or_default();
                                        metadata::record_install(
                                            &mut store,
                                            f,
                                            dep_id,
                                            &dep_version,
                                            &dep_info.download_url,
                                        );
                                        all_installed.insert(f.clone());
                                    }
                                    installed_deps.push(dep_name.clone());
                                }
                                Err(_) => failed_deps.push(dep_name.clone()),
                            }
                        }
                        Err(_) => failed_deps.push(dep_name.clone()),
                    },
                    Err(_) => failed_deps.push(dep_name.clone()),
                }
            }
            Ok(None) => skipped_deps.push(dep_name.clone()),
            Err(_) => failed_deps.push(dep_name.clone()),
        }
    }

    // Save metadata
    metadata::save_metadata(&addons_dir, &store)?;

    Ok(InstallResult {
        installed_folders,
        installed_deps,
        failed_deps,
        skipped_deps,
    })
}

#[tauri::command]
pub fn remove_addon(addons_path: String, folder_name: String) -> Result<(), String> {
    let addons_dir = PathBuf::from(&addons_path);
    installer::remove_addon(&addons_dir, &folder_name)?;

    // Clean up metadata
    let mut store = metadata::load_metadata(&addons_dir);
    metadata::remove_entry(&mut store, &folder_name);
    metadata::save_metadata(&addons_dir, &store)?;

    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(addons_path: String) -> Result<Vec<UpdateCheckResult>, String> {
    tokio::task::spawn_blocking(move || check_for_updates_blocking(&addons_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn check_for_updates_blocking(addons_path: &str) -> Result<Vec<UpdateCheckResult>, String> {
    let addons_dir = PathBuf::from(&addons_path);
    let store = metadata::load_metadata(&addons_dir);

    let mut results: Vec<UpdateCheckResult> = Vec::new();

    for (folder_name, meta) in &store.addons {
        // Only check addons that still exist on disk
        if !addons_dir.join(folder_name).is_dir() {
            continue;
        }

        match esoui::fetch_addon_info(meta.esoui_id) {
            Ok(info) => {
                // Normalize versions: strip leading "v"/"V" and trim whitespace
                let local_ver = meta
                    .installed_version
                    .trim()
                    .strip_prefix('v')
                    .or_else(|| meta.installed_version.trim().strip_prefix('V'))
                    .unwrap_or(meta.installed_version.trim());
                let remote_ver = info
                    .version
                    .trim()
                    .strip_prefix('v')
                    .or_else(|| info.version.trim().strip_prefix('V'))
                    .unwrap_or(info.version.trim());

                let has_update =
                    !remote_ver.is_empty() && !local_ver.is_empty() && remote_ver != local_ver;

                results.push(UpdateCheckResult {
                    folder_name: folder_name.clone(),
                    esoui_id: meta.esoui_id,
                    current_version: meta.installed_version.clone(),
                    remote_version: info.version,
                    download_url: info.download_url,
                    has_update,
                });
            }
            Err(_) => {
                // Skip addons we can't check — don't block the whole batch
                continue;
            }
        }

        // Small delay between requests to be respectful to ESOUI
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    Ok(results)
}

#[tauri::command]
pub fn update_addon(addons_path: String, esoui_id: u32) -> Result<InstallResult, String> {
    let addons_dir = PathBuf::from(&addons_path);

    // Fetch latest info from ESOUI
    let info = esoui::fetch_addon_info(esoui_id)?;

    // Download and extract
    let tmp_file = esoui::download_addon(&info.download_url)?;
    let installed_folders = installer::extract_addon_zip(tmp_file.path(), &addons_dir)?;

    // Update metadata
    let mut store = metadata::load_metadata(&addons_dir);
    for folder in &installed_folders {
        let version = find_manifest(&addons_dir, folder)
            .and_then(|p| manifest::parse_manifest(folder, &p))
            .map(|m| m.version)
            .unwrap_or_default();
        metadata::record_install(&mut store, folder, esoui_id, &version, &info.download_url);
    }
    metadata::save_metadata(&addons_dir, &store)?;

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
pub fn export_addon_list(addons_path: String) -> Result<String, String> {
    let addons_dir = PathBuf::from(&addons_path);
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

    // Deduplicate by esoui_id (multiple folders can share an ID)
    let mut seen_ids: HashSet<u32> = HashSet::new();
    entries.retain(|e| seen_ids.insert(e.esoui_id));

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
pub async fn auto_link_addons(addons_path: String) -> Result<AutoLinkResult, String> {
    tokio::task::spawn_blocking(move || auto_link_addons_blocking(&addons_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn auto_link_addons_blocking(addons_path: &str) -> Result<AutoLinkResult, String> {
    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    let mut store = metadata::load_metadata(&addons_dir);

    // Find addons that exist on disk but aren't tracked
    let entries =
        fs::read_dir(&addons_dir).map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

    let mut untracked: Vec<(String, String)> = Vec::new(); // (folder_name, version)
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        if store.addons.contains_key(&folder_name) {
            continue;
        }
        // Must have a manifest to be a real addon
        let manifest = find_manifest(&addons_dir, &folder_name)
            .and_then(|p| manifest::parse_manifest(&folder_name, &p));
        if let Some(m) = manifest {
            // Skip libraries — they're usually bundled
            if !m.is_library {
                untracked.push((folder_name, m.version));
            }
        }
    }

    let mut linked: Vec<String> = Vec::new();
    let mut not_found: Vec<String> = Vec::new();

    for (folder_name, version) in &untracked {
        match esoui::search_addon_by_name(folder_name) {
            Ok(Some(esoui_id)) => {
                // Verify by fetching info — title should roughly match
                if let Ok(info) = esoui::fetch_addon_info(esoui_id) {
                    metadata::record_install(
                        &mut store,
                        folder_name,
                        esoui_id,
                        version,
                        &info.download_url,
                    );
                    linked.push(folder_name.clone());
                } else {
                    not_found.push(folder_name.clone());
                }
            }
            Ok(None) => not_found.push(folder_name.clone()),
            Err(_) => not_found.push(folder_name.clone()),
        }
        // Be respectful to ESOUI
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    metadata::save_metadata(&addons_dir, &store)?;

    Ok(AutoLinkResult { linked, not_found })
}

/// Batch remove multiple addons.
#[tauri::command]
pub fn batch_remove_addons(
    addons_path: String,
    folder_names: Vec<String>,
) -> Result<Vec<String>, String> {
    let addons_dir = PathBuf::from(&addons_path);
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
pub fn import_addon_list(addons_path: String, json_data: String) -> Result<ImportResult, String> {
    let export: ExportData =
        serde_json::from_str(&json_data).map_err(|e| format!("Invalid export file: {}", e))?;

    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    let mut installed: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    let mut store = metadata::load_metadata(&addons_dir);

    for entry in &export.addons {
        // Skip if already installed
        if addons_dir.join(&entry.folder_name).is_dir() {
            skipped.push(entry.folder_name.clone());
            continue;
        }

        match esoui::fetch_addon_info(entry.esoui_id) {
            Ok(info) => match esoui::download_addon(&info.download_url) {
                Ok(tmp) => match installer::extract_addon_zip(tmp.path(), &addons_dir) {
                    Ok(folders) => {
                        for f in &folders {
                            let ver = find_manifest(&addons_dir, f)
                                .and_then(|p| manifest::parse_manifest(f, &p))
                                .map(|m| m.version)
                                .unwrap_or_default();
                            metadata::record_install(
                                &mut store,
                                f,
                                entry.esoui_id,
                                &ver,
                                &info.download_url,
                            );
                        }
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

    metadata::save_metadata(&addons_dir, &store)?;

    Ok(ImportResult {
        installed,
        failed,
        skipped,
    })
}

// ─── Category Browsing ───────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiCategory {
    pub id: u32,
    pub name: String,
    pub depth: u32,
}

#[tauri::command]
pub fn get_esoui_categories() -> Result<Vec<EsouiCategory>, String> {
    esoui::fetch_categories()
}

#[tauri::command]
pub fn browse_esoui_category(
    category_id: u32,
    page: u32,
    sort_by: String,
) -> Result<Vec<esoui::EsouiSearchResult>, String> {
    esoui::browse_category(category_id, page, &sort_by)
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
pub fn check_api_compatibility(addons_path: String) -> Result<ApiCompatInfo, String> {
    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    // Read the game's current API version from AddOnSettings.txt
    let settings_path = addons_dir
        .parent()
        .map(|p| p.join("AddOnSettings.txt"))
        .ok_or("Could not find AddOnSettings.txt")?;

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
pub fn list_backups(addons_path: String) -> Result<Vec<BackupInfo>, String> {
    let addons_dir = PathBuf::from(&addons_path);
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
pub fn create_backup(addons_path: String, backup_name: String) -> Result<BackupInfo, String> {
    validate_name(&backup_name)?;
    let addons_dir = PathBuf::from(&addons_path);
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
pub fn restore_backup(addons_path: String, backup_name: String) -> Result<u32, String> {
    validate_name(&backup_name)?;
    let addons_dir = PathBuf::from(&addons_path);
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
pub fn delete_backup(addons_path: String, backup_name: String) -> Result<(), String> {
    validate_name(&backup_name)?;
    let addons_dir = PathBuf::from(&addons_path);
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
    let path = profiles_path(addons_dir);
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(store) => store,
            Err(e) => {
                eprintln!("Warning: profiles file corrupted ({}), trying backup...", e);
                let bak = path.with_extension("json.bak");
                match fs::read_to_string(&bak) {
                    Ok(bak_content) => match serde_json::from_str(&bak_content) {
                        Ok(store) => {
                            eprintln!("Recovered profiles from backup file.");
                            store
                        }
                        Err(e2) => {
                            eprintln!("Profiles backup also corrupted ({}), using defaults.", e2);
                            ProfileStore::default()
                        }
                    },
                    Err(_) => {
                        eprintln!("No profiles backup file found, using defaults.");
                        ProfileStore::default()
                    }
                }
            }
        },
        Err(_) => ProfileStore::default(),
    }
}

fn save_profiles(addons_dir: &std::path::Path, store: &ProfileStore) -> Result<(), String> {
    let path = profiles_path(addons_dir);
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    // Create backup of existing file before writing
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = fs::copy(&path, &bak);
    }

    // Write to temp file first, then atomically rename
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Failed to write profiles temp file: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to finalize profiles write: {}", e))
}

#[tauri::command]
pub fn list_profiles(addons_path: String) -> Result<(Vec<AddonProfile>, Option<String>), String> {
    let addons_dir = PathBuf::from(&addons_path);
    let store = load_profiles(&addons_dir);
    Ok((store.profiles, store.active_profile))
}

#[tauri::command]
pub fn create_profile(addons_path: String, profile_name: String) -> Result<AddonProfile, String> {
    let addons_dir = PathBuf::from(&addons_path);
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
    addons_path: String,
    profile_name: String,
) -> Result<ActivateProfileResult, String> {
    let addons_dir = PathBuf::from(&addons_path);
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
                        Err(e) => {
                            eprintln!("Failed to enable {}: {}", base_name, e);
                            failed.push(format!("{} (enable: {})", base_name, e));
                        }
                    }
                }
            } else {
                // Should be disabled
                if !is_disabled && find_manifest(&addons_dir, &folder_name).is_some() {
                    let new_path = addons_dir.join(format!("{}.disabled", folder_name));
                    match fs::rename(&path, &new_path) {
                        Ok(_) => disabled.push(folder_name),
                        Err(e) => {
                            eprintln!("Failed to disable {}: {}", folder_name, e);
                            failed.push(format!("{} (disable: {})", folder_name, e));
                        }
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
pub fn delete_profile(addons_path: String, profile_name: String) -> Result<(), String> {
    let addons_dir = PathBuf::from(&addons_path);
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
pub fn list_characters(addons_path: String) -> Result<Vec<CharacterInfo>, String> {
    let addons_dir = PathBuf::from(&addons_path);
    let settings_path = addons_dir
        .parent()
        .map(|p| p.join("AddOnSettings.txt"))
        .ok_or("Could not find AddOnSettings.txt")?;

    if !settings_path.exists() {
        return Err("AddOnSettings.txt not found.".to_string());
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read AddOnSettings.txt: {}", e))?;

    let mut characters: Vec<CharacterInfo> = Vec::new();
    let skip_prefixes = ["#Version", "#Acknowledged", "#AddOnsEnabled"];

    for line in content.lines() {
        if !line.starts_with('#') {
            continue;
        }
        let line = &line[1..]; // Strip #
        if skip_prefixes
            .iter()
            .any(|p| format!("#{}", line).starts_with(p))
        {
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
    addons_path: String,
    character_name: String,
    backup_name: String,
) -> Result<u32, String> {
    validate_name(&backup_name)?;
    let addons_dir = PathBuf::from(&addons_path);
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
    let re_addon =
        regex::Regex::new(r#"<addon[^>]*uid="(\d+)"[^>]*ui-version="([^"]*)"[^>]*>"#).unwrap();
    let re_dir = regex::Regex::new(r"<dir>([^<]+)</dir>").unwrap();

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
pub fn migrate_from_minion(addons_path: String) -> Result<MinionMigrationResult, String> {
    let xml_path = find_minion_xml().ok_or("Minion installation not found.")?;

    let content =
        fs::read_to_string(&xml_path).map_err(|e| format!("Failed to read Minion data: {}", e))?;

    let minion_addons = parse_minion_addons(&content);
    let addon_count = minion_addons.len() as u32;

    let addons_dir = PathBuf::from(&addons_path);
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
