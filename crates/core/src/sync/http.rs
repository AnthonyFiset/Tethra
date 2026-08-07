//! HTTP client for the self-hosted sync server.
//!
//! Intended for an always-on Linux host reachable over Tailscale (or LAN):
//! `http://sync.example:8787`. Optional bearer token authenticates writes when
//! the server is started with `--token`.

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::sync::SyncBackend;
use crate::sync::types::{SyncCursor, SyncItem, SyncedVaultHeader};
use crate::{Error, Result};

#[derive(Debug, Clone)]
pub struct HttpBackend {
    base_url: String,
    token: Option<String>,
}

impl HttpBackend {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self { base_url, token }
    }

    fn auth_header(&self) -> Option<String> {
        self.token
            .as_ref()
            .map(|token| format!("Bearer {}", B64.encode(token.as_bytes())))
    }
}

#[async_trait]
impl SyncBackend for HttpBackend {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)> {
        let url = format!(
            "{}/v1/items?since={}",
            self.base_url,
            urlencoding_lite(&since.0)
        );
        let body = http_get(&url, self.auth_header().as_deref()).await?;
        let parsed: PullResponse =
            serde_json::from_slice(&body).map_err(|e| Error::Sync(format!("pull decode: {e}")))?;
        Ok((parsed.items, parsed.cursor))
    }

    async fn push(&self, items: &[SyncItem]) -> Result<SyncCursor> {
        let url = format!("{}/v1/items", self.base_url);
        let body = serde_json::to_vec(&PushRequest {
            items: items.to_vec(),
        })?;
        let response = http_post(&url, &body, self.auth_header().as_deref()).await?;
        let parsed: PushResponse = serde_json::from_slice(&response)
            .map_err(|e| Error::Sync(format!("push decode: {e}")))?;
        Ok(parsed.cursor)
    }

    async fn get_header(&self) -> Result<Option<SyncedVaultHeader>> {
        let url = format!("{}/v1/header", self.base_url);
        match http_get(&url, self.auth_header().as_deref()).await {
            Ok(body) if body.is_empty() || body == b"null" => Ok(None),
            Ok(body) => {
                let header = serde_json::from_slice(&body)
                    .map_err(|e| Error::Sync(format!("header decode: {e}")))?;
                Ok(Some(header))
            }
            Err(Error::Sync(msg)) if msg.contains("404") => Ok(None),
            Err(other) => Err(other),
        }
    }

    async fn put_header(&self, header: &SyncedVaultHeader) -> Result<()> {
        let url = format!("{}/v1/header", self.base_url);
        let body = serde_json::to_vec(header)?;
        let _ = http_put(&url, &body, self.auth_header().as_deref()).await?;
        Ok(())
    }
}

#[derive(serde::Serialize)]
struct PushRequest {
    items: Vec<SyncItem>,
}

#[derive(serde::Deserialize)]
struct PushResponse {
    cursor: SyncCursor,
}

#[derive(serde::Deserialize)]
struct PullResponse {
    items: Vec<SyncItem>,
    cursor: SyncCursor,
}

fn urlencoding_lite(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

async fn http_get(url: &str, auth: Option<&str>) -> Result<Vec<u8>> {
    request("GET", url, None, auth).await
}

async fn http_post(url: &str, body: &[u8], auth: Option<&str>) -> Result<Vec<u8>> {
    request("POST", url, Some(body), auth).await
}

async fn http_put(url: &str, body: &[u8], auth: Option<&str>) -> Result<Vec<u8>> {
    request("PUT", url, Some(body), auth).await
}

async fn request(
    method: &str,
    url: &str,
    body: Option<&[u8]>,
    auth: Option<&str>,
) -> Result<Vec<u8>> {
    // Keep core free of a heavy HTTP stack: use a tiny reqwest-free client via
    // `ureq` would block; prefer tokio-friendly `reqwest` behind a feature, or
    // the sync-server's matching protocol tested through FileBackend locally.
    // Desktop ships with reqwest via the sync-server/http feature path below.
    #[cfg(feature = "sync-http")]
    {
        use reqwest::Client;
        let client = Client::new();
        let mut builder = match method {
            "GET" => client.get(url),
            "POST" => client.post(url),
            "PUT" => client.put(url),
            other => return Err(Error::Sync(format!("unsupported method {other}"))),
        };
        if let Some(token) = auth {
            builder = builder.header("Authorization", token);
        }
        if let Some(bytes) = body {
            builder = builder
                .header("Content-Type", "application/json")
                .body(bytes.to_vec());
        }
        let response = builder
            .send()
            .await
            .map_err(|e| Error::Sync(format!("http {method}: {e}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Sync(format!("http body: {e}")))?;
        if !status.is_success() {
            return Err(Error::Sync(format!(
                "http {method} {status}: {}",
                String::from_utf8_lossy(&bytes)
            )));
        }
        Ok(bytes.to_vec())
    }
    #[cfg(not(feature = "sync-http"))]
    {
        let _ = (method, url, body, auth);
        Err(Error::Unsupported(
            "HttpBackend requires the sync-http feature".into(),
        ))
    }
}
