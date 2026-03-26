use regex::Regex;
use scraper::{Html, Selector};
use serde::Serialize;
use std::io::Write;
use tempfile::NamedTempFile;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsouiAddonInfo {
    pub id: u32,
    pub title: String,
    pub version: String,
    pub download_url: String,
}

pub fn parse_esoui_input(input: &str) -> Result<u32, String> {
    let input = input.trim();

    // Bare numeric ID
    if let Ok(id) = input.parse::<u32>() {
        return Ok(id);
    }

    // URL with info{id} pattern: /downloads/info123 or /downloads/info123-Name.html
    let re_info = Regex::new(r"info(\d+)").unwrap();
    if let Some(caps) = re_info.captures(input) {
        if let Ok(id) = caps[1].parse::<u32>() {
            return Ok(id);
        }
    }

    // URL with id= query parameter: fileinfo.php?id=123
    let re_id = Regex::new(r"[?&]id=(\d+)").unwrap();
    if let Some(caps) = re_id.captures(input) {
        if let Ok(id) = caps[1].parse::<u32>() {
            return Ok(id);
        }
    }

    Err(format!(
        "Could not parse ESOUI addon ID from: {}",
        input
    ))
}

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ESOAddonManager/0.1.0")
        .build()
        .expect("failed to build HTTP client")
}

fn fetch_page(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().map_err(|e| {
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

pub fn fetch_addon_info(id: u32) -> Result<EsouiAddonInfo, String> {
    let client = http_client();

    // Step 1: Fetch the addon info page to get the title
    let info_url = format!("https://www.esoui.com/downloads/info{}", id);
    let body = fetch_page(&client, &info_url)?;
    let document = Html::parse_document(&body);

    // Extract title from <meta property="og:title" content="...">
    let meta_sel = Selector::parse(r#"meta[property="og:title"]"#).unwrap();
    let title = document
        .select(&meta_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Addon #{}", id));

    // Extract version from <div id="version">Version: X.Y.Z</div>
    let version_sel = Selector::parse("#version").unwrap();
    let version = document
        .select(&version_sel)
        .next()
        .map(|el| {
            let text = el.text().collect::<String>();
            text.trim()
                .strip_prefix("Version:")
                .or_else(|| text.trim().strip_prefix("Version"))
                .unwrap_or(text.trim())
                .trim()
                .to_string()
        })
        .unwrap_or_default();

    // Step 2: Fetch the landing page which contains the actual CDN download link
    let landing_url = format!(
        "https://www.esoui.com/downloads/landing.php?fileid={}",
        id
    );
    let landing_body = fetch_page(&client, &landing_url)?;
    let landing_doc = Html::parse_document(&landing_body);

    // The landing page has a direct CDN link like:
    // <a href="https://cdn.esoui.com/downloads/file4273/DailyTradeBars.zip?...">Click here</a>
    // and also an iframe with the same URL
    let a_sel = Selector::parse("a[href]").unwrap();
    let download_url = landing_doc
        .select(&a_sel)
        .filter_map(|el| el.value().attr("href"))
        .find(|href| href.contains("cdn.esoui.com") && href.contains(".zip"))
        .map(|s| s.to_string())
        .ok_or_else(|| {
            "Could not find download link on ESOUI. The addon may have been removed.".to_string()
        })?;

    Ok(EsouiAddonInfo {
        id,
        title,
        version,
        download_url,
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
    let url = format!(
        "https://www.esoui.com/downloads/search.php?search={}&se_search=files",
        query
    );
    let body = fetch_page(&client, &url)?;
    let document = Html::parse_document(&body);

    let re_id = Regex::new(r"[?&]id=(\d+)").unwrap();
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
                    .map_or(false, |h| h.contains("fileinfo.php"))
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
    let url = format!(
        "https://www.esoui.com/downloads/search.php?search={}&se_search=files",
        name
    );
    let body = fetch_page(&client, &url)?;
    let document = Html::parse_document(&body);

    // Search results have links like: <a href="fileinfo.php?s=...&id=7">LibAddonMenu-2.0</a>
    let a_sel = Selector::parse("a[href]").unwrap();
    let re_id = Regex::new(r"[?&]id=(\d+)").unwrap();

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
    let document2 = Html::parse_document(&body);
    for element in document2.select(&a_sel) {
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

pub fn download_addon(url: &str) -> Result<NamedTempFile, String> {
    let client = http_client();

    let response = client.get(url).send().map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "Download failed — check your internet connection.".to_string()
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

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read download: {}", e))?;

    let mut tmp = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;

    tmp.write_all(&bytes)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    Ok(tmp)
}
