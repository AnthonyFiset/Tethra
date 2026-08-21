//! HTTP client for the self-hosted sync server.
//!
//! Authenticates with either a legacy shared bearer token or a vault-derived
//! `auth_key` session (`POST /v1/auth`). On 401 with an auth_key available,
//! refreshes the session once and retries.

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use tokio::sync::Mutex;

use crate::sync::SyncBackend;
use crate::sync::types::{SyncCursor, SyncItem, SyncedVaultHeader};
use crate::vault::Argon2Params;
use crate::{Error, Result};

#[derive(Debug, Default)]
struct AuthState {
    /// Legacy shared secret (optional).
    legacy_token: Option<String>,
    /// Vault HKDF auth_key (32 bytes); never logged.
    auth_key: Option<[u8; 32]>,
    /// Short-lived session from `/v1/auth` (sent as Bearer raw, not re-encoded).
    session: Option<String>,
    /// Last device-auth status for Settings UI.
    status: String,
}

#[derive(Debug, Clone)]
pub struct HttpBackend {
    base_url: String,
    auth: Arc<Mutex<AuthState>>,
}

impl HttpBackend {
    pub fn new(base_url: impl Into<String>, legacy_token: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self {
            base_url,
            auth: Arc::new(Mutex::new(AuthState {
                legacy_token,
                status: "configured".into(),
                ..Default::default()
            })),
        }
    }

    pub async fn set_auth_key(&self, auth_key: [u8; 32]) {
        let mut guard = self.auth.lock().await;
        guard.auth_key = Some(auth_key);
        guard.session = None;
        guard.status = "auth_key_ready".into();
    }

    pub async fn auth_status(&self) -> String {
        self.auth.lock().await.status.clone()
    }

    /// Obtain a session token via `/v1/auth` when an auth_key is set.
    pub async fn ensure_session(&self) -> Result<()> {
        self.refresh_session().await
    }

    /// Register this vault's auth_key with the server (first device).
    pub async fn enroll(&self) -> Result<()> {
        let auth_key = {
            let guard = self.auth.lock().await;
            guard
                .auth_key
                .ok_or_else(|| Error::Sync("enroll requires vault unlock".into()))?
        };
        let url = format!("{}/v1/enroll", self.base_url);
        let body = serde_json::to_vec(&AuthKeyRequest {
            auth_key: B64.encode(auth_key),
        })?;
        let legacy = self.legacy_auth_header().await;
        match request("POST", &url, Some(&body), legacy.as_deref()).await {
            Ok(_) => {
                self.auth.lock().await.status = "enrolled".into();
                Ok(())
            }
            Err(Error::Sync(msg)) if msg.contains("409") => {
                self.auth.lock().await.status = "enrolled".into();
                Ok(())
            }
            Err(other) => Err(other),
        }
    }

    /// Fetch public KDF metadata (no auth).
    pub async fn fetch_vault_header_public(&self) -> Result<VaultHeaderPublic> {
        let url = format!("{}/v1/vault-header", self.base_url);
        let body = request("GET", &url, None, None).await?;
        serde_json::from_slice(&body).map_err(|e| Error::Sync(format!("vault-header decode: {e}")))
    }

    async fn legacy_auth_header(&self) -> Option<String> {
        self.auth
            .lock()
            .await
            .legacy_token
            .as_ref()
            .map(|token| format!("Bearer {}", B64.encode(token.as_bytes())))
    }

    async fn active_auth_header(&self) -> Option<String> {
        let guard = self.auth.lock().await;
        if let Some(session) = guard.session.as_ref() {
            return Some(format!("Bearer {session}"));
        }
        drop(guard);
        self.legacy_auth_header().await
    }

    async fn refresh_session(&self) -> Result<()> {
        let auth_key = {
            let guard = self.auth.lock().await;
            guard
                .auth_key
                .ok_or_else(|| Error::Sync("no auth_key for /v1/auth".into()))?
        };
        let url = format!("{}/v1/auth", self.base_url);
        let body = serde_json::to_vec(&AuthKeyRequest {
            auth_key: B64.encode(auth_key),
        })?;
        let response = request("POST", &url, Some(&body), None).await?;
        let parsed: AuthResponse = serde_json::from_slice(&response)
            .map_err(|e| Error::Sync(format!("auth decode: {e}")))?;
        let mut guard = self.auth.lock().await;
        guard.session = Some(parsed.token);
        guard.status = "authenticated".into();
        Ok(())
    }

    async fn request_authed(
        &self,
        method: &str,
        url: &str,
        body: Option<&[u8]>,
    ) -> Result<Vec<u8>> {
        let auth = self.active_auth_header().await;
        match request(method, url, body, auth.as_deref()).await {
            Ok(bytes) => Ok(bytes),
            Err(Error::Sync(msg)) if msg.contains("401") => {
                // Prefer vault session refresh when possible.
                if self.auth.lock().await.auth_key.is_some() {
                    self.refresh_session().await?;
                    let auth = self.active_auth_header().await;
                    request(method, url, body, auth.as_deref()).await
                } else {
                    Err(Error::Sync(msg))
                }
            }
            Err(other) => Err(other),
        }
    }
}

#[derive(serde::Serialize)]
struct AuthKeyRequest {
    auth_key: String,
}

#[derive(serde::Deserialize)]
struct AuthResponse {
    token: String,
    #[allow(dead_code)]
    expires_in: u64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct VaultHeaderPublic {
    pub salt: Vec<u8>,
    pub argon2: Argon2Params,
}

#[async_trait]
impl SyncBackend for HttpBackend {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)> {
        let url = format!(
            "{}/v1/items?since={}",
            self.base_url,
            urlencoding_lite(&since.0)
        );
        let body = self.request_authed("GET", &url, None).await?;
        let parsed: PullResponse =
            serde_json::from_slice(&body).map_err(|e| Error::Sync(format!("pull decode: {e}")))?;
        Ok((parsed.items, parsed.cursor))
    }

    async fn push(&self, items: &[SyncItem]) -> Result<SyncCursor> {
        let url = format!("{}/v1/items", self.base_url);
        let body = serde_json::to_vec(&PushRequest {
            items: items.to_vec(),
        })?;
        let response = self.request_authed("POST", &url, Some(&body)).await?;
        let parsed: PushResponse = serde_json::from_slice(&response)
            .map_err(|e| Error::Sync(format!("push decode: {e}")))?;
        Ok(parsed.cursor)
    }

    async fn get_header(&self) -> Result<Option<SyncedVaultHeader>> {
        let url = format!("{}/v1/header", self.base_url);
        match self.request_authed("GET", &url, None).await {
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
        let _ = self.request_authed("PUT", &url, Some(&body)).await?;
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

async fn request(
    method: &str,
    url: &str,
    body: Option<&[u8]>,
    auth: Option<&str>,
) -> Result<Vec<u8>> {
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
