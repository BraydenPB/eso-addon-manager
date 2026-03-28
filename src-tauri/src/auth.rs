use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ── Constants ────────────────────────────────────────────────────────────

const CLIENT_ID: &str = "9fd28ffc-300a-44ce-8a0e-6167db47a7e1";
const AUTH_URL: &str = "https://www.esologs.com/oauth/authorize";
const TOKEN_URL: &str = "https://www.esologs.com/oauth/token";
const USER_API: &str = "https://www.esologs.com/api/v2/user";
const SCOPE: &str = "view-user-profile";

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub user_id: String,
    pub user_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub user_id: String,
    pub user_name: String,
}

pub struct AuthState(pub Mutex<Option<AuthTokens>>);

#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct GraphQLResponse {
    data: Option<GraphQLData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphQLData {
    user_data: Option<UserData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserData {
    current_user: Option<CurrentUser>,
}

#[derive(Debug, Deserialize)]
struct CurrentUser {
    id: serde_json::Value,
    name: String,
}

// ── PKCE ─────────────────────────────────────────────────────────────────

fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    hex::encode(&bytes)
}

fn generate_code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

// hex encoding without external crate
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

// ── Localhost Callback Server ────────────────────────────────────────────

/// Spawns a temporary localhost server, opens the browser for OAuth,
/// waits for the callback with the authorization code, and returns it.
pub fn run_oauth_flow() -> Result<(String, String, String), String> {
    // Bind to random port
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?
        .port();

    let redirect_uri = format!("http://localhost:{}/callback", port);

    // Generate PKCE
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);

    // Build auth URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256",
        AUTH_URL,
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPE),
        code_challenge,
    );

    // Open browser
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &auth_url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&auth_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    // Wait for callback (120s timeout)
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking: {}", e))?;
    let timeout = Duration::from_secs(120);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err("OAuth login timed out. Please try again.".to_string());
        }

        // Set a short accept timeout so we can check the overall timeout
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

        match listener.accept() {
            Ok((mut stream, _)) => {
                // Read the HTTP request
                let mut buf = [0u8; 4096];
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);

                // Parse the code from the query string
                if let Some(code) = extract_code_from_request(&request) {
                    // Send success response
                    let html = r#"<!DOCTYPE html><html><head><style>body{font-family:system-ui;background:#0b1220;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}h1{color:#c4a44a;font-size:1.5rem}p{opacity:0.6}</style></head><body><div><h1>Signed in!</h1><p>You can close this tab and return to ESO Addon Manager.</p></div></body></html>"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();

                    return Ok((code, code_verifier, redirect_uri));
                } else {
                    // Not the callback we're looking for, send a redirect
                    let response =
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => {
                return Err(format!("Server error: {}", e));
            }
        }
    }
}

fn extract_code_from_request(request: &str) -> Option<String> {
    // Parse "GET /callback?code=XXXX HTTP/1.1"
    let first_line = request.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    if !path.starts_with("/callback") {
        return None;
    }
    let query = path.split('?').nth(1)?;
    for param in query.split('&') {
        if let Some(value) = param.strip_prefix("code=") {
            return Some(urlencoding::decode(value).ok()?.to_string());
        }
    }
    None
}

// urlencoding without external crate
mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut result = String::with_capacity(s.len() * 3);
        for byte in s.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                _ => {
                    result.push('%');
                    result.push_str(&format!("{:02X}", byte));
                }
            }
        }
        result
    }

    pub fn decode(s: &str) -> Result<String, ()> {
        let mut bytes = Vec::new();
        let mut chars = s.bytes();
        while let Some(b) = chars.next() {
            if b == b'%' {
                let hi = chars.next().ok_or(())?;
                let lo = chars.next().ok_or(())?;
                let hex = [hi, lo];
                let s = std::str::from_utf8(&hex).map_err(|_| ())?;
                let byte = u8::from_str_radix(s, 16).map_err(|_| ())?;
                bytes.push(byte);
            } else if b == b'+' {
                bytes.push(b' ');
            } else {
                bytes.push(b);
            }
        }
        String::from_utf8(bytes).map_err(|_| ())
    }
}

// ── Token Exchange ───────────────────────────────────────────────────────

pub fn exchange_code(
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let body = format!(
        "grant_type=authorization_code&code={}&client_id={}&code_verifier={}&redirect_uri={}",
        urlencoding::encode(code),
        urlencoding::encode(CLIENT_ID),
        urlencoding::encode(code_verifier),
        urlencoding::encode(redirect_uri),
    );

    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!(
            "Token exchange returned HTTP {} — {}",
            status, body
        ));
    }

    response
        .json::<TokenResponse>()
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

pub fn refresh_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencoding::encode(refresh_token),
        urlencoding::encode(CLIENT_ID),
    );

    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !response.status().is_success() {
        return Err("Session expired. Please sign in again.".to_string());
    }

    response
        .json::<TokenResponse>()
        .map_err(|e| format!("Failed to parse refresh response: {}", e))
}

// ── User Validation ──────────────────────────────────────────────────────

pub fn validate_token(access_token: &str) -> Result<(String, String), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let query = r#"{ "query": "{ userData { currentUser { id name } } }" }"#;

    let response = client
        .post(USER_API)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .body(query)
        .send()
        .map_err(|e| format!("User validation failed: {}", e))?;

    if !response.status().is_success() {
        return Err("Token validation failed".to_string());
    }

    let body: GraphQLResponse = response
        .json()
        .map_err(|e| format!("Failed to parse user response: {}", e))?;

    let user = body
        .data
        .and_then(|d| d.user_data)
        .and_then(|u| u.current_user)
        .ok_or_else(|| "Could not retrieve user info".to_string())?;

    // id can be a number or string
    let user_id = match &user.id {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    Ok((user_id, user.name))
}

// ── Full Login Flow ──────────────────────────────────────────────────────

pub fn login() -> Result<AuthTokens, String> {
    let (code, verifier, redirect_uri) = run_oauth_flow()?;
    let token_resp = exchange_code(&code, &verifier, &redirect_uri)?;
    let (user_id, user_name) = validate_token(&token_resp.access_token)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let expires_at = now + token_resp.expires_in.unwrap_or(3600);

    Ok(AuthTokens {
        access_token: token_resp.access_token,
        refresh_token: token_resp.refresh_token.unwrap_or_default(),
        expires_at,
        user_id,
        user_name,
    })
}

/// Refresh tokens if expired, returns updated tokens or error.
pub fn ensure_valid_token(tokens: &AuthTokens) -> Result<Option<AuthTokens>, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Still valid (with 60s buffer)
    if tokens.expires_at > now + 60 {
        return Ok(None);
    }

    // Try refresh
    if tokens.refresh_token.is_empty() {
        return Err("Session expired. Please sign in again.".to_string());
    }

    let token_resp = refresh_token(&tokens.refresh_token)?;
    let (user_id, user_name) = validate_token(&token_resp.access_token)?;

    let expires_at = now + token_resp.expires_in.unwrap_or(3600);

    Ok(Some(AuthTokens {
        access_token: token_resp.access_token,
        refresh_token: token_resp
            .refresh_token
            .unwrap_or_else(|| tokens.refresh_token.clone()),
        expires_at,
        user_id,
        user_name,
    }))
}
