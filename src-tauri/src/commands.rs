use crate::esoui::{self, EsouiAddonInfo, EsouiSearchResult};
use crate::installer;
use crate::manifest::{self, AddonManifest};
use crate::metadata;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

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
pub fn scan_installed_addons(addons_path: String) -> Result<Vec<AddonManifest>, String> {
    let addons_dir = PathBuf::from(&addons_path);
    if !addons_dir.is_dir() {
        return Err(format!("AddOns folder not found: {}", addons_path));
    }

    let entries = fs::read_dir(&addons_dir)
        .map_err(|e| format!("Failed to read AddOns folder: {}", e))?;

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
        let addon = find_manifest(&addons_dir, folder)
            .and_then(|p| manifest::parse_manifest(folder, &p));
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
    let _ = metadata::save_metadata(&addons_dir, &store);

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
    let _ = metadata::save_metadata(&addons_dir, &store);

    Ok(())
}

#[tauri::command]
pub fn check_for_updates(addons_path: String) -> Result<Vec<UpdateCheckResult>, String> {
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
                let has_update = !info.version.is_empty()
                    && !meta.installed_version.is_empty()
                    && info.version != meta.installed_version;

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
    let _ = metadata::save_metadata(&addons_dir, &store);

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

    let _ = metadata::save_metadata(&addons_dir, &store);

    Ok(ImportResult {
        installed,
        failed,
        skipped,
    })
}
