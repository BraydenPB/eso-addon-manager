use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

/// Regex that matches ESO rich-text formatting codes:
///   |cXXXXXX  — color start (6 or 8 hex digits)
///   |r        — color reset
///   |t        — tab
///   |u..:|u   — hyperlink markup
static ESO_FORMAT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\|c[0-9a-f]{6}|\|r|\|t|\|u[^|]*:\|u").unwrap());

/// Strip ESO rich-text formatting codes from a string.
fn strip_eso_codes(s: &str) -> String {
    ESO_FORMAT_RE.replace_all(s, "").trim().to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct Dependency {
    pub name: String,
    pub min_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
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
    })
}
