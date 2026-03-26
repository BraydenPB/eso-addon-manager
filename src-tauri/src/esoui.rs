use regex::Regex;
use scraper::{Html, Selector};
use serde::Serialize;
use std::io;
use std::sync::OnceLock;
use tempfile::NamedTempFile;

/// Decode common HTML entities for cleaner display text.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

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
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ESOAddonManager/0.1.0")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client")
    })
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

fn fetch_page_with_query(
    client: &reqwest::blocking::Client,
    url: &str,
    query: &[(&str, &str)],
) -> Result<String, String> {
    let response = client.get(url).query(query).send().map_err(|e| {
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

/// Fetch basic addon info (title, version, download URL) from ESOUI.
///
/// Scraper assumptions (check if ESOUI changes their HTML):
/// - Title: `<meta property="og:title" content="...">` on the info page
/// - Version: `<div id="version">Version: X.Y.Z</div>` on the info page
/// - Download URL: landing.php page has an `<a href="https://cdn.esoui.com/.../.zip...">` link
pub fn fetch_addon_info(id: u32) -> Result<EsouiAddonInfo, String> {
    let client = http_client();

    // Step 1: Fetch the addon info page to get the title
    let info_url = format!("https://www.esoui.com/downloads/info{}", id);
    let body = fetch_page(client, &info_url)?;
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
    let landing_url = format!("https://www.esoui.com/downloads/landing.php?fileid={}", id);
    let landing_body = fetch_page(client, &landing_url)?;
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
            format!(
                "Could not find a CDN download link (cdn.esoui.com/*.zip) on the landing page for addon {}. \
                 The addon may have been removed, or ESOUI may have changed their page layout.",
                id
            )
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

/// Fetch full addon page details from ESOUI.
///
/// Scraper assumptions (check if ESOUI changes their HTML):
/// - Title: `<meta property="og:title" content="...">`
/// - Version: `<div id="version">Version: X.Y.Z</div>`
/// - Author: `<div id="author">by: AuthorName</div>`
/// - Description: `<div class="postmessage">...</div>`
/// - File size: `<div id="size">...</div>`
/// - Table metadata (Compatibility, Total downloads, etc.): `<tr><td>Label:</td><td>Value</td></tr>`
/// - Screenshots: `<a class="lightbox" rel="filepics" href="...preview...">`
/// - Download URL: landing.php page `<a href="https://cdn.esoui.com/.../.zip...">`
pub fn fetch_addon_detail(id: u32) -> Result<EsouiAddonDetail, String> {
    let client = http_client();

    let info_url = format!("https://www.esoui.com/downloads/info{}", id);
    let body = fetch_page(client, &info_url)?;
    let document = Html::parse_document(&body);

    // Title from og:title meta
    let meta_sel = Selector::parse(r#"meta[property="og:title"]"#).unwrap();
    let title = document
        .select(&meta_sel)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Addon #{}", id));

    // Version from #version div
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

    // Author from #author div
    let author_sel = Selector::parse("#author").unwrap();
    let author = document
        .select(&author_sel)
        .next()
        .map(|el| {
            let text = el.text().collect::<String>();
            text.trim()
                .strip_prefix("by:")
                .unwrap_or(text.trim())
                .trim()
                .to_string()
        })
        .unwrap_or_default();

    // Description from div.postmessage
    let desc_sel = Selector::parse("div.postmessage").unwrap();
    let description = document
        .select(&desc_sel)
        .next()
        .map(|el| {
            // Get text content, replacing <br> with newlines
            let html = el.inner_html();
            let stripped = html
                .replace("<br>", "\n")
                .replace("<br/>", "\n")
                .replace("<br />", "\n")
                .replace("&nbsp;", " ")
                // Strip remaining HTML tags
                .split('<')
                .enumerate()
                .map(|(i, part)| {
                    if i == 0 {
                        part.to_string()
                    } else {
                        part.split_once('>')
                            .map_or("", |(_, rest)| rest)
                            .to_string()
                    }
                })
                .collect::<String>();
            decode_html_entities(stripped.trim())
        })
        .unwrap_or_default();

    // File size from #size
    let size_sel = Selector::parse("#size").unwrap();
    let file_size = document
        .select(&size_sel)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default();

    // Extract table metadata by parsing rows with two td cells
    let tr_sel = Selector::parse("tr").unwrap();
    let td_plain_sel = Selector::parse("td").unwrap();
    let mut compatibility = String::new();
    let mut total_downloads = String::new();
    let mut monthly_downloads = String::new();
    let mut favorites = String::new();
    let mut updated = String::new();
    let mut created = String::new();

    for tr in document.select(&tr_sel) {
        let tds: Vec<_> = tr.select(&td_plain_sel).collect();
        if tds.len() >= 2 {
            let label = tds[0].text().collect::<String>();
            let label = label.trim().trim_end_matches(':');
            let value = tds[1].text().collect::<String>().trim().to_string();
            match label {
                "Compatibility" => compatibility = value,
                "Total downloads" => total_downloads = value,
                "Monthly downloads" => monthly_downloads = value,
                "Favorites" => favorites = value,
                "Updated" => updated = value,
                "Created" => created = value,
                _ => {}
            }
        }
    }

    // Screenshots from lightbox links
    let lightbox_sel = Selector::parse(r#"a.lightbox[rel="filepics"]"#).unwrap();
    let screenshots: Vec<String> = document
        .select(&lightbox_sel)
        .filter_map(|el| el.value().attr("href"))
        .filter(|href| href.contains("preview") && !href.contains("thumb"))
        .map(|href| {
            if href.starts_with("//") {
                format!("https:{}", href)
            } else {
                href.to_string()
            }
        })
        .collect();

    // Download URL from landing page
    let landing_url = format!("https://www.esoui.com/downloads/landing.php?fileid={}", id);
    let landing_body = fetch_page(client, &landing_url)?;
    let landing_doc = Html::parse_document(&landing_body);

    let a_sel = Selector::parse("a[href]").unwrap();
    let download_url = landing_doc
        .select(&a_sel)
        .filter_map(|el| el.value().attr("href"))
        .find(|href| href.contains("cdn.esoui.com") && href.contains(".zip"))
        .map(|s| s.to_string())
        .unwrap_or_default();

    // Validate that we got the critical fields; empty title or download_url likely means
    // ESOUI changed their page structure.
    if title.is_empty() || title == format!("Addon #{}", id) {
        return Err(format!(
            "Could not extract addon title for addon {}. ESOUI may have changed their page layout \
             (expected <meta property=\"og:title\"> tag).",
            id
        ));
    }
    if download_url.is_empty() {
        return Err(format!(
            "Could not find a CDN download link for addon {}. ESOUI may have changed their \
             landing page layout (expected <a href=\"https://cdn.esoui.com/.../*.zip\">).",
            id
        ));
    }

    Ok(EsouiAddonDetail {
        id,
        title,
        version,
        author,
        description,
        compatibility,
        file_size,
        total_downloads,
        monthly_downloads,
        favorites,
        updated,
        created,
        screenshots,
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
    let body = fetch_page_with_query(
        client,
        "https://www.esoui.com/downloads/search.php",
        &[("search", query), ("se_search", "files")],
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
    let body = fetch_page_with_query(
        client,
        "https://www.esoui.com/downloads/search.php",
        &[("search", name), ("se_search", "files")],
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

use crate::commands::EsouiCategory;

/// Fetch the full category list from ESOUI search page.
pub fn fetch_categories() -> Result<Vec<EsouiCategory>, String> {
    let client = http_client();
    let body = fetch_page(client, "https://www.esoui.com/downloads/search.php")?;
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

    let body = fetch_page(client, &url)?;
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
                Err(_) => continue,
            },
            None => continue,
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

    let mut tmp = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Stream the response directly to disk instead of buffering the entire ZIP in memory.
    // reqwest::blocking::Response implements std::io::Read, so io::copy streams in chunks.
    let mut response = response;
    io::copy(&mut response, &mut tmp)
        .map_err(|e| format!("Failed to write download to temp file: {}", e))?;

    Ok(tmp)
}
