use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::Path;

/// Maximum total extracted size (500 MB) to guard against ZIP bombs.
const MAX_EXTRACT_SIZE: u64 = 500 * 1024 * 1024;

pub fn extract_addon_zip(zip_path: &Path, addons_dir: &Path) -> Result<Vec<String>, String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Failed to open ZIP file: {}", e))?;

    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let mut created_folders: HashSet<String> = HashSet::new();
    let mut total_extracted: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;

        // Skip symlink entries (check unix mode for symlink bit 0o120000)
        if let Some(mode) = entry.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                continue;
            }
        }

        // Use enclosed_name for path traversal safety
        let relative_path = match entry.enclosed_name() {
            Some(p) => p.to_owned(),
            None => continue,
        };

        let out_path = addons_dir.join(&relative_path);

        // Track top-level folder names
        if let Some(first_component) = relative_path.components().next() {
            let folder = first_component.as_os_str().to_string_lossy().to_string();
            created_folders.insert(folder);
        }

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory {:?}: {}", out_path, e))?;
        } else {
            // Check declared size against remaining budget before extracting
            let declared_size = entry.size();
            if total_extracted + declared_size > MAX_EXTRACT_SIZE {
                return Err(format!(
                    "ZIP extraction aborted: total size exceeds {} MB limit. Possible ZIP bomb.",
                    MAX_EXTRACT_SIZE / (1024 * 1024)
                ));
            }

            // Ensure parent directory exists
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
            }

            let mut outfile = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file {:?}: {}", out_path, e))?;

            let bytes_written = io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract {:?}: {}", out_path, e))?;

            total_extracted += bytes_written;

            // Double-check actual bytes written against budget
            if total_extracted > MAX_EXTRACT_SIZE {
                // Clean up the file we just wrote
                let _ = fs::remove_file(&out_path);
                return Err(format!(
                    "ZIP extraction aborted: total size exceeds {} MB limit. Possible ZIP bomb.",
                    MAX_EXTRACT_SIZE / (1024 * 1024)
                ));
            }
        }
    }

    if created_folders.is_empty() {
        return Err("ZIP archive contained no addon folders.".to_string());
    }

    Ok(created_folders.into_iter().collect())
}

pub fn remove_addon(addons_dir: &Path, folder_name: &str) -> Result<(), String> {
    // Validate folder name — no path traversal
    if folder_name.contains("..")
        || folder_name.contains('/')
        || folder_name.contains('\\')
        || folder_name.is_empty()
    {
        return Err("Invalid addon folder name.".to_string());
    }

    let addon_path = addons_dir.join(folder_name);

    if !addon_path.is_dir() {
        return Err(format!("Addon folder not found: {}", folder_name));
    }

    // Verify the folder is actually inside the addons directory
    let canonical_addons = addons_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve addons path: {}", e))?;
    let canonical_addon = addon_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve addon path: {}", e))?;

    if !canonical_addon.starts_with(&canonical_addons) {
        return Err("Addon path is outside the AddOns directory.".to_string());
    }

    fs::remove_dir_all(&addon_path)
        .map_err(|e| format!("Failed to remove addon {}: {}", folder_name, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    /// Create a simple valid ZIP with one folder and one file.
    fn create_test_zip(dir: &Path, zip_name: &str, folder: &str, file_content: &str) -> PathBuf {
        let zip_path = dir.join(zip_name);
        let file = fs::File::create(&zip_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);

        let options = zip::write::SimpleFileOptions::default();
        archive
            .start_file(format!("{}/test.txt", folder), options)
            .unwrap();
        archive.write_all(file_content.as_bytes()).unwrap();
        archive.finish().unwrap();

        zip_path
    }

    #[test]
    fn extracts_valid_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        let zip_path = create_test_zip(tmp.path(), "test.zip", "TestAddon", "hello");
        let folders = extract_addon_zip(&zip_path, &addons_dir).unwrap();

        assert_eq!(folders, vec!["TestAddon".to_string()]);
        assert!(addons_dir.join("TestAddon/test.txt").exists());
        assert_eq!(
            fs::read_to_string(addons_dir.join("TestAddon/test.txt")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn rejects_empty_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        // Create an empty ZIP
        let zip_path = tmp.path().join("empty.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let archive = zip::ZipWriter::new(file);
        archive.finish().unwrap();

        let result = extract_addon_zip(&zip_path, &addons_dir);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no addon folders"));
    }

    #[test]
    fn remove_addon_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        assert!(remove_addon(&addons_dir, "..").is_err());
        assert!(remove_addon(&addons_dir, "../etc").is_err());
        assert!(remove_addon(&addons_dir, "foo/bar").is_err());
        assert!(remove_addon(&addons_dir, "foo\\bar").is_err());
        assert!(remove_addon(&addons_dir, "").is_err());
    }

    #[test]
    fn remove_addon_rejects_nonexistent() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        let result = remove_addon(&addons_dir, "NoSuchAddon");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn removes_addon_successfully() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        let addon_path = addons_dir.join("TestAddon");
        fs::create_dir_all(&addon_path).unwrap();
        fs::write(addon_path.join("test.txt"), "data").unwrap();

        assert!(addon_path.exists());
        remove_addon(&addons_dir, "TestAddon").unwrap();
        assert!(!addon_path.exists());
    }

    #[test]
    fn tracks_multiple_top_level_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let addons_dir = tmp.path().join("AddOns");
        fs::create_dir_all(&addons_dir).unwrap();

        let zip_path = tmp.path().join("multi.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        archive.start_file("AddonA/init.lua", options).unwrap();
        archive.write_all(b"-- lua").unwrap();
        archive.start_file("AddonB/init.lua", options).unwrap();
        archive.write_all(b"-- lua").unwrap();
        archive.finish().unwrap();

        let mut folders = extract_addon_zip(&zip_path, &addons_dir).unwrap();
        folders.sort();
        assert_eq!(folders, vec!["AddonA".to_string(), "AddonB".to_string()]);
    }
}
