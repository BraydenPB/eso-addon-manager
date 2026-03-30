use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

/// Strip ESO rich-text formatting codes from a string.
/// Matches: |cXXXXXX (color), |r (reset), |t (tab), |u..:|u (hyperlink).
fn strip_eso_codes(s: &str) -> String {
    static ESO_FORMAT_RE: OnceLock<Regex> = OnceLock::new();
    let re = ESO_FORMAT_RE
        .get_or_init(|| Regex::new(r"(?i)\|c[0-9a-f]{6}|\|r|\|t|\|u[^|]*:\|u").unwrap());
    re.replace_all(s, "").trim().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    pub name: String,
    pub min_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonManifest {
    pub folder_name: String,
    pub title: String,
    pub author: String,
    pub version: String,
    pub addon_version: Option<u32>,
    pub api_version: Vec<u32>,
    pub description: String,
    pub is_library: bool,
    pub depends_on: Vec<Dependency>,
    pub optional_depends_on: Vec<Dependency>,
    pub missing_dependencies: Vec<String>,
    pub esoui_id: Option<u32>,
    pub tags: Vec<String>,
    pub esoui_last_update: u64,
}

fn parse_dependencies(value: &str) -> Vec<Dependency> {
    value
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(|dep| {
            if let Some(pos) = dep.find(">=") {
                let name = dep[..pos].to_string();
                let min_version = dep[pos + 2..].parse::<u32>().ok();
                Dependency { name, min_version }
            } else {
                Dependency {
                    name: dep.to_string(),
                    min_version: None,
                }
            }
        })
        .collect()
}

pub fn parse_manifest(folder_name: &str, manifest_path: &Path) -> Option<AddonManifest> {
    let content = fs::read_to_string(manifest_path).ok()?;

    let mut title = String::new();
    let mut author = String::new();
    let mut version = String::new();
    let mut addon_version: Option<u32> = None;
    let mut api_version: Vec<u32> = Vec::new();
    let mut description = String::new();
    let mut is_library = false;
    let mut depends_on_raw = String::new();
    let mut optional_depends_on_raw = String::new();

    // Track which multi-line field we're continuing (DependsOn can span lines)
    let mut continuation: Option<&str> = None;

    for line in content.lines() {
        let line = line.trim();

        if let Some(line) = line.strip_prefix("## ") {
            continuation = None;
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };

            let key = key.trim();
            let value = value.trim();

            match key {
                "Title" => title = value.to_string(),
                "Author" => author = value.to_string(),
                "Version" => version = value.to_string(),
                "AddOnVersion" => addon_version = value.parse().ok(),
                "APIVersion" => {
                    api_version = value
                        .split_whitespace()
                        .filter_map(|v| v.parse().ok())
                        .collect();
                }
                "Description" => description = value.to_string(),
                "IsLibrary" => is_library = value.eq_ignore_ascii_case("true"),
                "DependsOn" => {
                    depends_on_raw = value.to_string();
                    continuation = Some("DependsOn");
                }
                "OptionalDependsOn" => {
                    optional_depends_on_raw = value.to_string();
                    continuation = Some("OptionalDependsOn");
                }
                _ => {}
            }
        } else if !line.is_empty() && !line.starts_with('#') {
            // Continuation line for multi-line DependsOn.
            // Valid dep lines only contain addon names (word chars, hyphens, dots, >=).
            // Stop if we hit file listings (.lua, .xml, paths with /, ;, :).
            let looks_like_deps = !line.contains(".lua")
                && !line.contains(".xml")
                && !line.contains('/')
                && !line.contains('\\')
                && !line.contains(';')
                && !line.contains(':');

            if looks_like_deps {
                match continuation {
                    Some("DependsOn") => {
                        depends_on_raw.push(' ');
                        depends_on_raw.push_str(line);
                    }
                    Some("OptionalDependsOn") => {
                        optional_depends_on_raw.push(' ');
                        optional_depends_on_raw.push_str(line);
                    }
                    _ => {
                        continuation = None;
                    }
                }
            } else {
                continuation = None;
            }
        }
    }

    let depends_on = parse_dependencies(&depends_on_raw);
    let optional_depends_on = parse_dependencies(&optional_depends_on_raw);

    title = strip_eso_codes(&title);
    author = strip_eso_codes(&author);
    description = strip_eso_codes(&description);

    if title.is_empty() {
        title = folder_name.to_string();
    }

    Some(AddonManifest {
        folder_name: folder_name.to_string(),
        title,
        author,
        version,
        addon_version,
        api_version,
        description,
        is_library,
        depends_on,
        optional_depends_on,
        missing_dependencies: Vec::new(),
        esoui_id: None,
        tags: Vec::new(),
        esoui_last_update: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn write_manifest(dir: &Path, folder: &str, content: &str) -> PathBuf {
        let addon_dir = dir.join(folder);
        fs::create_dir_all(&addon_dir).unwrap();
        let path = addon_dir.join(format!("{}.txt", folder));
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn parses_basic_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: My Cool Addon
## Author: TestAuthor
## Version: 1.2.3
## APIVersion: 101042
## Description: A test addon
";
        let path = write_manifest(dir.path(), "MyCoolAddon", content);
        let m = parse_manifest("MyCoolAddon", &path).unwrap();

        assert_eq!(m.title, "My Cool Addon");
        assert_eq!(m.author, "TestAuthor");
        assert_eq!(m.version, "1.2.3");
        assert_eq!(m.api_version, vec![101042]);
        assert_eq!(m.description, "A test addon");
        assert!(!m.is_library);
        assert!(m.depends_on.is_empty());
    }

    #[test]
    fn parses_library_flag() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: LibStub
## IsLibrary: true
";
        let path = write_manifest(dir.path(), "LibStub", content);
        let m = parse_manifest("LibStub", &path).unwrap();

        assert!(m.is_library);
    }

    #[test]
    fn parses_dependencies_with_versions() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: TestAddon
## DependsOn: LibAddonMenu-2.0>=32 LibStub
## OptionalDependsOn: LibAsync
";
        let path = write_manifest(dir.path(), "TestAddon", content);
        let m = parse_manifest("TestAddon", &path).unwrap();

        assert_eq!(m.depends_on.len(), 2);
        assert_eq!(m.depends_on[0].name, "LibAddonMenu-2.0");
        assert_eq!(m.depends_on[0].min_version, Some(32));
        assert_eq!(m.depends_on[1].name, "LibStub");
        assert_eq!(m.depends_on[1].min_version, None);
        assert_eq!(m.optional_depends_on.len(), 1);
        assert_eq!(m.optional_depends_on[0].name, "LibAsync");
    }

    #[test]
    fn parses_multiple_api_versions() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: TestAddon
## APIVersion: 101042 101043
";
        let path = write_manifest(dir.path(), "TestAddon", content);
        let m = parse_manifest("TestAddon", &path).unwrap();

        assert_eq!(m.api_version, vec![101042, 101043]);
    }

    #[test]
    fn strips_eso_formatting_codes() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: |cFFD700Fancy|r Addon
## Author: |c00FF00Green|r Author
";
        let path = write_manifest(dir.path(), "FancyAddon", content);
        let m = parse_manifest("FancyAddon", &path).unwrap();

        assert_eq!(m.title, "Fancy Addon");
        assert_eq!(m.author, "Green Author");
    }

    #[test]
    fn falls_back_to_folder_name_for_empty_title() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Version: 1.0
";
        let path = write_manifest(dir.path(), "NoTitle", content);
        let m = parse_manifest("NoTitle", &path).unwrap();

        assert_eq!(m.title, "NoTitle");
    }

    #[test]
    fn parses_addon_version_number() {
        let dir = tempfile::tempdir().unwrap();
        let content = "\
## Title: TestAddon
## AddOnVersion: 42
";
        let path = write_manifest(dir.path(), "TestAddon", content);
        let m = parse_manifest("TestAddon", &path).unwrap();

        assert_eq!(m.addon_version, Some(42));
    }

    #[test]
    fn returns_none_for_missing_file() {
        let result = parse_manifest("NoSuchAddon", Path::new("/nonexistent/path.txt"));
        assert!(result.is_none());
    }
}
