use regex::Regex;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::sync::OnceLock;
use tempfile::NamedTempFile;

// ── ESOUI filedetails JSON API ──────────────────────────────────────────────

/// Response from `api.mmoui.com/v4/game/ESO/filedetails/{id}.json`.
/// The API wraps the result in a single-element array.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiFileDetail {
    id: u32,
    title: String,
    version: String,
    author: String,
    description: String,
    last_update: u64,
    download_uri: String,
    downloads: u64,
    downloads_monthly: u64,
    favorites: u64,
    #[serde(default)]
    images: Vec<ApiImage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiImage {
    image_url: String,
}

/// Fetch addon details from the ESOUI filedetails JSON API.
fn fetch_file_detail(client: &reqwest::blocking::Client, id: u32) -> Result<ApiFileDetail, String> {
    let url = format!("https://api.mmoui.com/v4/game/ESO/filedetails/{}.json", id);
    let response = client.get(&url).send().map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Could not reach ESOUI API. Check your internet connection.".to_string()
        } else {
            format!("ESOUI API request failed: {}", e)
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            404 => "Addon not found on ESOUI. It may have been removed.".to_string(),
            429 => "Too many requests to ESOUI. Please wait a moment and try again.".to_string(),
            500..=599 => "ESOUI is currently unavailable. Try again later.".to_string(),
            _ => format!("ESOUI API returned an error (HTTP {})", status),
        });
    }

    let entries: Vec<ApiFileDetail> = response
        .json()
        .map_err(|e| format!("Failed to parse ESOUI API response: {}", e))?;

    entries.into_iter().next().ok_or_else(|| {
        format!(
            "ESOUI API returned empty response for addon {}. It may have been removed.",
            id
        )
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiAddonInfo {
    pub id: u32,
    pub title: String,
    pub version: String,
    pub download_url: String,
    pub updated: String,
}

pub fn parse_esoui_input(input: &str) -> Result<u32, String> {
    let input = input.trim();

    // Bare numeric ID
    if let Ok(id) = input.parse::<u32>() {
        return Ok(id);
    }

    // URL with info{id} pattern: /downloads/info123 or /downloads/info123-Name.html
    static RE_INFO: OnceLock<Regex> = OnceLock::new();
    let re_info = RE_INFO.get_or_init(|| Regex::new(r"info(\d+)").unwrap());
    if let Some(caps) = re_info.captures(input) {
        if let Ok(id) = caps[1].parse::<u32>() {
            return Ok(id);
        }
    }

    // URL with id= query parameter: fileinfo.php?id=123
    static RE_ID: OnceLock<Regex> = OnceLock::new();
    let re_id = RE_ID.get_or_init(|| Regex::new(r"[?&]id=(\d+)").unwrap());
    if let Some(caps) = re_id.captures(input) {
        if let Ok(id) = caps[1].parse::<u32>() {
            return Ok(id);
        }
    }

    Err(format!("Could not parse ESOUI addon ID from: {}", input))
}

fn http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .user_agent(format!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kalpa/{}",
                env!("CARGO_PKG_VERSION")
            ))
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("failed to build HTTP client")
    })
}

fn fetch_page(
    client: &reqwest::blocking::Client,
    url: &str,
    query: Option<&[(&str, &str)]>,
) -> Result<String, String> {
    let mut builder = client.get(url);
    if let Some(q) = query {
        builder = builder.query(q);
    }

    let response = builder.send().map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Could not connect to ESOUI. Check your internet connection.".to_string()
        } else {
            format!("Network error: {}", e)
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            404 => "Addon not found on ESOUI. It may have been removed.".to_string(),
            429 => "Too many requests to ESOUI. Please wait a moment and try again.".to_string(),
            500..=599 => "ESOUI is currently unavailable. Try again later.".to_string(),
            _ => format!("ESOUI returned an error (HTTP {})", status),
        });
    }

    response
        .text()
        .map_err(|e| format!("Failed to read response: {}", e))
}

/// Fetch basic addon info (title, version, download URL) from ESOUI JSON API.
pub fn fetch_addon_info(id: u32) -> Result<EsouiAddonInfo, String> {
    let client = http_client();
    let detail = fetch_file_detail(client, id)?;

    Ok(EsouiAddonInfo {
        id: detail.id,
        title: detail.title,
        version: detail.version,
        download_url: detail.download_uri,
        updated: String::new(), // Not needed by callers — metadata uses last_update epoch
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiAddonDetail {
    pub id: u32,
    pub title: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub compatibility: String,
    pub file_size: String,
    pub total_downloads: String,
    pub monthly_downloads: String,
    pub favorites: String,
    pub updated: String,
    pub created: String,
    pub screenshots: Vec<String>,
    pub download_url: String,
}

/// Strip BBCode tags for plain-text display.
fn strip_bbcode(s: &str) -> String {
    static RE_BBCODE: OnceLock<Regex> = OnceLock::new();
    let re = RE_BBCODE.get_or_init(|| Regex::new(r"\[/?[A-Za-z]+[^\]]*\]").unwrap());
    re.replace_all(s, "").trim().to_string()
}

/// Format a number with comma separators (e.g., 1234567 → "1,234,567").
fn format_number(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::with_capacity(s.len() + s.len() / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            result.push(',');
        }
        result.push(c);
    }
    result
}

/// Format an epoch-millisecond timestamp as "MM/DD/YY HH:MM AM/PM".
fn format_epoch_millis(millis: u64) -> String {
    if millis == 0 {
        return String::new();
    }
    // Use the metadata module's timestamp formatter for date portion
    let secs = millis / 1000;
    // Simple date format matching ESOUI's display: "MM/DD/YY HH:MM AM/PM"
    // We'll use chrono-free approach: just format the epoch
    let days = secs / 86400;
    let day_secs = secs % 86400;
    let mut hours = (day_secs / 3600) as u32;
    let minutes = ((day_secs % 3600) / 60) as u32;
    let ampm = if hours >= 12 { "PM" } else { "AM" };
    if hours == 0 {
        hours = 12;
    } else if hours > 12 {
        hours -= 12;
    }

    // Convert days since epoch to date
    let mut y: u32 = 1970;
    let mut d = days;
    loop {
        let leap = y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400));
        let year_days: u64 = if leap { 366 } else { 365 };
        if d < year_days {
            break;
        }
        d -= year_days;
        y += 1;
        if y > 3000 {
            return String::new();
        }
    }
    let leap = y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400));
    let month_days: [u64; 12] = [
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
    let mut m: u32 = 0;
    for &md in &month_days {
        if d < md {
            break;
        }
        d -= md;
        m += 1;
    }

    format!(
        "{:02}/{:02}/{:02} {:02}:{:02} {}",
        m + 1,
        d + 1,
        y % 100,
        hours,
        minutes,
        ampm
    )
}

/// Fetch full addon details from the ESOUI JSON API.
pub fn fetch_addon_detail(id: u32) -> Result<EsouiAddonDetail, String> {
    let client = http_client();
    let detail = fetch_file_detail(client, id)?;

    let description = strip_bbcode(&detail.description);
    let screenshots: Vec<String> = detail.images.into_iter().map(|img| img.image_url).collect();
    let updated = format_epoch_millis(detail.last_update);

    Ok(EsouiAddonDetail {
        id: detail.id,
        title: detail.title,
        version: detail.version,
        author: detail.author,
        description,
        compatibility: String::new(), // Not available from API; gameVersions in filelist covers this
        file_size: String::new(),     // Not available from filedetails API
        total_downloads: format_number(detail.downloads),
        monthly_downloads: format_number(detail.downloads_monthly),
        favorites: format_number(detail.favorites),
        updated,
        created: String::new(), // Not available from API
        screenshots,
        download_url: detail.download_uri,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiSearchResult {
    pub id: u32,
    pub title: String,
    pub author: String,
    pub category: String,
    pub downloads: String,
    pub updated: String,
}

/// Search ESOUI and return rich results with metadata.
pub fn search_esoui(query: &str) -> Result<Vec<EsouiSearchResult>, String> {
    let client = http_client();
    let body = fetch_page(
        client,
        "https://www.esoui.com/downloads/search.php",
        Some(&[("search", query), ("se_search", "files")]),
    )?;
    let document = Html::parse_document(&body);

    static RE_SEARCH_ID: OnceLock<Regex> = OnceLock::new();
    let re_id = RE_SEARCH_ID.get_or_init(|| Regex::new(r"[?&]id=(\d+)").unwrap());
    let row_sel = Selector::parse("tr").unwrap();
    let td_sel = Selector::parse("td").unwrap();
    let a_sel = Selector::parse("a[href]").unwrap();

    let mut results: Vec<EsouiSearchResult> = Vec::new();

    for row in document.select(&row_sel) {
        let cells: Vec<_> = row.select(&td_sel).collect();
        if cells.len() < 5 {
            continue;
        }

        // Find which cell contains the fileinfo.php link (title cell)
        let mut title_idx = None;
        let mut title = String::new();
        let mut id: u32 = 0;

        for (i, cell) in cells.iter().enumerate() {
            if let Some(a) = cell.select(&a_sel).find(|a| {
                a.value()
                    .attr("href")
                    .is_some_and(|h| h.contains("fileinfo.php"))
            }) {
                let href = a.value().attr("href").unwrap_or("");
                if let Some(caps) = re_id.captures(href) {
                    if let Ok(parsed_id) = caps[1].parse::<u32>() {
                        title = a.text().collect::<String>().trim().to_string();
                        id = parsed_id;
                        title_idx = Some(i);
                        break;
                    }
                }
            }
        }

        let title_idx = match title_idx {
            Some(i) => i,
            None => continue,
        };

        let author = cells
            .get(title_idx + 1)
            .map(|c| c.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let category = cells
            .get(title_idx + 2)
            .map(|c| c.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let downloads = cells
            .get(title_idx + 3)
            .map(|c| c.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let updated = cells
            .get(title_idx + 4)
            .map(|c| c.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        results.push(EsouiSearchResult {
            id,
            title,
            author,
            category,
            downloads,
            updated,
        });
    }

    Ok(results)
}

/// Search ESOUI for an addon by name, return the best-matching ESOUI ID.
/// Searches the ESOUI search page and matches results by title.
pub fn search_addon_by_name(name: &str) -> Result<Option<u32>, String> {
    let client = http_client();
    let body = fetch_page(
        client,
        "https://www.esoui.com/downloads/search.php",
        Some(&[("search", name), ("se_search", "files")]),
    )?;
    let document = Html::parse_document(&body);

    // Search results have links like: <a href="fileinfo.php?s=...&id=7">LibAddonMenu-2.0</a>
    let a_sel = Selector::parse("a[href]").unwrap();
    static RE_NAME_ID: OnceLock<Regex> = OnceLock::new();
    let re_id = RE_NAME_ID.get_or_init(|| Regex::new(r"[?&]id=(\d+)").unwrap());

    let name_lower = name.to_lowercase();

    for element in document.select(&a_sel) {
        let href = match element.value().attr("href") {
            Some(h) if h.contains("fileinfo.php") => h,
            _ => continue,
        };

        let link_text = element.text().collect::<String>();
        let link_text_lower = link_text.trim().to_lowercase();

        // Exact match on the link text
        if link_text_lower == name_lower {
            if let Some(caps) = re_id.captures(href) {
                if let Ok(id) = caps[1].parse::<u32>() {
                    return Ok(Some(id));
                }
            }
        }
    }

    // No exact match found — try a looser match (link text contains the name)
    for element in document.select(&a_sel) {
        let href = match element.value().attr("href") {
            Some(h) if h.contains("fileinfo.php") => h,
            _ => continue,
        };

        let link_text = element.text().collect::<String>();
        let link_text_lower = link_text.trim().to_lowercase();

        if link_text_lower.contains(&name_lower) || name_lower.contains(&link_text_lower) {
            if let Some(caps) = re_id.captures(href) {
                if let Ok(id) = caps[1].parse::<u32>() {
                    return Ok(Some(id));
                }
            }
        }
    }

    Ok(None)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiCategory {
    pub id: u32,
    pub name: String,
    pub depth: u32,
}

/// Fetch the full category list from ESOUI search page.
pub fn fetch_categories() -> Result<Vec<EsouiCategory>, String> {
    let client = http_client();
    let body = fetch_page(client, "https://www.esoui.com/downloads/search.php", None)?;
    let document = Html::parse_document(&body);

    let option_sel = Selector::parse("option[value]").unwrap();
    let mut categories: Vec<EsouiCategory> = Vec::new();

    for el in document.select(&option_sel) {
        let value = el.value().attr("value").unwrap_or("0");
        let id = match value.parse::<u32>() {
            Ok(id) if id > 0 => id,
            _ => continue,
        };
        let text = el.text().collect::<String>();
        let name = text.trim().to_string();
        if name.is_empty() {
            continue;
        }

        let depth = if name.starts_with("--") {
            2
        } else if name.starts_with('-') {
            1
        } else {
            0
        };
        let clean_name = name.trim_start_matches('-').trim().to_string();

        categories.push(EsouiCategory {
            id,
            name: clean_name,
            depth,
        });
    }

    Ok(categories)
}

/// Browse addons in a specific ESOUI category.
pub fn browse_category(
    category_id: u32,
    page: u32,
    sort_by: &str,
) -> Result<Vec<EsouiSearchResult>, String> {
    let client = http_client();

    let sb = match sort_by {
        "downloads" => "dec_download",
        "newest" => "lastupdate",
        "name" => "title",
        _ => "dec_download",
    };

    let url = format!(
        "https://www.esoui.com/downloads/index.php?cid={}&sb={}&so=desc&pt=f&dp={}",
        category_id, sb, page
    );

    let body = fetch_page(client, &url, None)?;
    let document = Html::parse_document(&body);

    static RE_BROWSE_ID: OnceLock<Regex> = OnceLock::new();
    let re_id = RE_BROWSE_ID.get_or_init(|| Regex::new(r"info(\d+)").unwrap());
    let a_sel = Selector::parse("a.addonLink").unwrap();
    let cat_sel = Selector::parse("li.category").unwrap();

    // Parse the listing — each addon has a title link and a category label
    let mut results: Vec<EsouiSearchResult> = Vec::new();
    let mut categories: Vec<String> = Vec::new();

    // Collect all category labels in order
    for el in document.select(&cat_sel) {
        categories.push(el.text().collect::<String>().trim().to_string());
    }

    let mut idx = 0;
    for el in document.select(&a_sel) {
        let href = el.value().attr("href").unwrap_or("");
        let title = el.text().collect::<String>().trim().to_string();

        let id = match re_id.captures(href) {
            Some(caps) => match caps[1].parse::<u32>() {
                Ok(id) => id,
                Err(_) => {
                    idx += 1;
                    continue;
                }
            },
            None => {
                idx += 1;
                continue;
            }
        };

        let category = categories.get(idx).cloned().unwrap_or_default();
        idx += 1;

        // Skip duplicates (ESOUI sometimes lists addons twice)
        if results.iter().any(|r| r.id == id) {
            continue;
        }

        results.push(EsouiSearchResult {
            id,
            title,
            author: String::new(), // Not available in category listing
            category,
            downloads: String::new(),
            updated: String::new(),
        });
    }

    Ok(results)
}

pub fn download_addon(url: &str) -> Result<NamedTempFile, String> {
    let client = http_client();

    let response = client.get(url).send().map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Download failed. Check your internet connection.".to_string()
        } else {
            format!("Download failed: {}", e)
        }
    })?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed (HTTP {}). The file may have been removed from ESOUI.",
            response.status()
        ));
    }

    let mut tmp = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Stream the response directly to disk instead of buffering the entire ZIP in memory.
    // reqwest::blocking::Response implements std::io::Read, so io::copy streams in chunks.
    let mut response = response;
    io::copy(&mut response, &mut tmp)
        .map_err(|e| format!("Failed to write download to temp file: {}", e))?;

    Ok(tmp)
}

// ── ESOUI REST API (api.mmoui.com) ──────────────────────────────────────────

/// A single addon entry from the ESOUI filelist API.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFileEntry {
    pub id: u32,
    pub version: String,
    pub last_update: u64, // epoch millis
    pub title: String,
    pub author: String,
    pub file_info_uri: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    pub addons: Vec<ApiAddonPath>,
}

fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::deserialize(deserializer)?.unwrap_or_default())
}

/// Sub-addon path entry within an ESOUI file listing.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiAddonPath {
    pub path: String,
}

/// Lookup entry for a resolved addon from the API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiAddonLookup {
    pub esoui_id: u32,
    pub title: String,
    pub version: String,
    pub author: String,
    pub last_update: u64, // epoch millis
    pub file_info_uri: String,
}

/// Fetch the full ESOUI filelist and build a lookup map keyed by addon folder path.
///
/// Single HTTP request returns ~4000 addons with all their folder paths,
/// versions, and last-updated timestamps. Far more reliable and faster than
/// per-addon HTML scraping for bulk operations.
pub fn fetch_filelist_lookup() -> Result<HashMap<String, ApiAddonLookup>, String> {
    let client = http_client();
    let url = "https://api.mmoui.com/v4/game/ESO/filelist.json";
    let response = client.get(url).send().map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Could not reach ESOUI API. Check your internet connection.".to_string()
        } else {
            format!("ESOUI API request failed: {}", e)
        }
    })?;

    if !response.status().is_success() {
        return Err(format!("ESOUI API returned HTTP {}", response.status()));
    }

    let entries: Vec<ApiFileEntry> = response
        .json()
        .map_err(|e| format!("Failed to parse ESOUI API response: {}", e))?;

    let mut map = HashMap::new();
    for entry in &entries {
        let lookup = ApiAddonLookup {
            esoui_id: entry.id,
            title: entry.title.clone(),
            version: entry.version.clone(),
            author: entry.author.clone(),
            last_update: entry.last_update,
            file_info_uri: entry.file_info_uri.clone(),
        };
        // Map each addon folder path to its parent file entry
        for addon in &entry.addons {
            // Only use the top-level folder name (before any '/')
            let folder = addon.path.split('/').next().unwrap_or(&addon.path);
            // Don't overwrite if already mapped (first match wins — the primary entry)
            map.entry(folder.to_string())
                .or_insert_with(|| lookup.clone());
        }
    }

    Ok(map)
}
