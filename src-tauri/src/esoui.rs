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
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to fetch {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {} for {}", response.status(), url));
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
        download_url,
    })
}

pub fn download_addon(url: &str) -> Result<NamedTempFile, String> {
    let client = http_client();

    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to download addon: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read download: {}", e))?;

    let mut tmp = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;

    tmp.write_all(&bytes)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    Ok(tmp)
}
