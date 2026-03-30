use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ── Constants ────────────────────────────────────────────────────────────

/// The website URL that handles the OAuth flow and passes tokens back.
const APP_AUTH_URL: &str = "https://eso-toolkit.github.io/dev-previews/pr-925/app-auth";

const USER_API: &str = "https://www.esologs.com/api/v2/user";

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

/// Token data received from the website's OAuth proxy.
#[derive(Debug, Deserialize)]
pub(crate) struct CallbackTokens {
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

// ── URL encoding (minimal, no external crate) ───────────────────────────

mod urlencoding {
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

// ── Localhost Callback Server ────────────────────────────────────────────

/// Opens browser to the website's /app-auth page which handles the full
/// OAuth flow, then redirects tokens back to our localhost server.
///
/// Flow:
/// 1. Bind localhost server on random port
/// 2. Open browser to website's /app-auth?port={port}
/// 3. Website does PKCE OAuth with ESO Logs (using its registered redirect URI)
/// 4. Website sends tokens to http://localhost:{port}/callback?tokens={base64}
/// 5. We receive and decode the tokens
pub fn run_oauth_flow() -> Result<CallbackTokens, String> {
    // Bind to random port
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind port: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?
        .port();

    // Open browser to the website's app-auth page
    let auth_url = format!("{}?port={}", APP_AUTH_URL, port);

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
    let timeout = Duration::from_secs(120);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err("OAuth login timed out. Please try again.".to_string());
        }

        listener
            .set_nonblocking(true)
            .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 8192];
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);

                if let Some(tokens) = extract_tokens_from_request(&request) {
                    // Send success page
                    let html = r#"<!DOCTYPE html><html><head><style>body{font-family:system-ui;background:#0b1220;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}h1{color:#c4a44a;font-size:1.5rem}p{opacity:0.6}</style></head><body><div><h1>Signed in!</h1><p>You can close this tab and return to Kalpa.</p></div></body></html>"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return Ok(tokens);
                } else if request.contains("OPTIONS") {
                    // Handle CORS preflight
                    let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                } else {
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

fn extract_tokens_from_request(request: &str) -> Option<CallbackTokens> {
    let first_line = request.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    if !path.starts_with("/callback") {
        return None;
    }
    let query = path.split('?').nth(1)?;
    for param in query.split('&') {
        if let Some(value) = param.strip_prefix("tokens=") {
            let decoded_param = urlencoding::decode(value).ok()?;
            let json_bytes = STANDARD.decode(decoded_param.as_bytes()).ok()?;
            let tokens: CallbackTokens = serde_json::from_slice(&json_bytes).ok()?;
            return Some(tokens);
        }
    }
    None
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

    let user_id = match &user.id {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    Ok((user_id, user.name))
}

// ── Full Login Flow ──────────────────────────────────────────────────────

pub fn login() -> Result<AuthTokens, String> {
    let token_resp = run_oauth_flow()?;
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

    // Try refresh via the website's token endpoint
    if tokens.refresh_token.is_empty() {
        return Err("Session expired. Please sign in again.".to_string());
    }

    let token_resp = refresh_token_request(&tokens.refresh_token)?;
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

/// Token refresh — this calls ESO Logs directly since refresh doesn't
/// require a registered redirect_uri.
fn refresh_token_request(refresh_token: &str) -> Result<CallbackTokens, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", "9fd28ffc-300a-44ce-8a0e-6167db47a7e1"),
    ];

    let response = client
        .post("https://www.esologs.com/oauth/token")
        .form(&params)
        .send()
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !response.status().is_success() {
        return Err("Session expired. Please sign in again.".to_string());
    }

    response
        .json::<CallbackTokens>()
        .map_err(|e| format!("Failed to parse refresh response: {}", e))
}
