//! HTTP sync server (axum) with request metrics.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use ssh_client_core::sync::{FileBackend, SyncBackend, SyncCursor, SyncItem, SyncedVaultHeader};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::device_auth;
use crate::updates;

#[derive(Debug, Default)]
pub struct Metrics {
    pub pull: AtomicU64,
    pub push: AtomicU64,
    pub header_get: AtomicU64,
    pub header_put: AtomicU64,
    /// Unix millis of last authenticated request; 0 if never.
    pub last_activity_ms: AtomicU64,
    pub last_kind: AtomicU64,
}

pub const KIND_PULL: u64 = 1;
pub const KIND_PUSH: u64 = 2;
pub const KIND_HEADER_GET: u64 = 3;
pub const KIND_HEADER_PUT: u64 = 4;

impl Metrics {
    fn touch(&self, kind: u64) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.last_activity_ms.store(now, Ordering::Relaxed);
        self.last_kind.store(kind, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            pull: self.pull.load(Ordering::Relaxed),
            push: self.push.load(Ordering::Relaxed),
            header_get: self.header_get.load(Ordering::Relaxed),
            header_put: self.header_put.load(Ordering::Relaxed),
            last_activity_ms: self.last_activity_ms.load(Ordering::Relaxed),
            last_kind: self.last_kind.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MetricsSnapshot {
    pub pull: u64,
    pub push: u64,
    pub header_get: u64,
    pub header_put: u64,
    pub last_activity_ms: u64,
    pub last_kind: u64,
}

impl MetricsSnapshot {
    pub fn last_kind_label(self) -> &'static str {
        match self.last_kind {
            KIND_PULL => "pull",
            KIND_PUSH => "push",
            KIND_HEADER_GET => "header get",
            KIND_HEADER_PUT => "header put",
            _ => "none",
        }
    }
}

#[derive(Clone)]
struct AppState {
    backend: Arc<FileBackend>,
    token: Option<String>,
    metrics: Arc<Metrics>,
    data_dir: PathBuf,
    /// Base URL clients use to reach this server, for rewriting asset links.
    client_url: Option<String>,
    allow_enroll: bool,
    sessions: Arc<device_auth::SessionStore>,
    rate_limit: Arc<device_auth::AuthRateLimiter>,
}

#[derive(Deserialize)]
struct PullQuery {
    since: Option<String>,
}

#[derive(Serialize)]
struct PullResponse {
    items: Vec<SyncItem>,
    cursor: SyncCursor,
}

#[derive(Deserialize)]
struct PushRequest {
    items: Vec<SyncItem>,
}

#[derive(Serialize)]
struct PushResponse {
    cursor: SyncCursor,
}

#[derive(Serialize)]
struct HealthzResponse {
    ok: bool,
    version: &'static str,
}

#[derive(Serialize)]
struct VaultHeaderPublic {
    salt: Vec<u8>,
    argon2: ssh_client_core::vault::Argon2Params,
}

#[derive(Deserialize)]
struct AuthKeyBody {
    /// Base64 of the 32-byte HKDF auth_key.
    auth_key: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    expires_in: u64,
}

pub fn build_router(config: &Config, metrics: Arc<Metrics>) -> Result<Router, String> {
    let backend = Arc::new(FileBackend::new(&config.data_dir));
    let token = if config.token.is_empty() {
        None
    } else {
        Some(config.token.clone())
    };
    let state = AppState {
        backend,
        token,
        metrics,
        data_dir: config.data_dir.clone(),
        client_url: config.client_url.clone(),
        allow_enroll: config.allow_enroll,
        sessions: Arc::new(device_auth::SessionStore::default()),
        rate_limit: Arc::new(device_auth::AuthRateLimiter::default()),
    };
    Ok(Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/vault-header", get(vault_header_public))
        .route("/v1/enroll", axum::routing::post(enroll))
        .route("/v1/auth", axum::routing::post(device_auth_login))
        .route("/v1/items", get(pull_items).post(push_items))
        .route("/v1/header", get(get_header).put(put_header))
        // Unauthenticated: payloads are minisign-verified by the client, and
        // requiring the sync token here would block updates whenever a device
        // is misconfigured — exactly when it most needs to update.
        .route(
            "/updates/{target}/{arch}/{current_version}",
            get(check_update),
        )
        .route("/updates/download/{file}", get(download_update))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state))
}

pub async fn prepare_data_dir(data_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("create data dir {}: {e}", data_dir.display()))?;
    let backend = FileBackend::new(data_dir);
    let _ = backend
        .pull(&SyncCursor::default())
        .await
        .map_err(|e| format!("init backend: {e}"))?;
    Ok(())
}

/// Run the HTTP server until `shutdown` becomes true or the listener fails.
pub async fn serve(
    config: Config,
    metrics: Arc<Metrics>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<(), String> {
    prepare_data_dir(&config.data_dir).await?;
    let addr = config.listen_addr()?;
    let app = build_router(&config, metrics)?;

    tracing::info!(
        listen = %addr,
        data = %config.data_dir.display(),
        "tethra sync server listening"
    );

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            loop {
                if *shutdown.borrow() {
                    break;
                }
                if shutdown.changed().await.is_err() {
                    break;
                }
            }
        })
        .await
        .map_err(|e| format!("serve: {e}"))?;
    Ok(())
}

pub async fn serve_until_ctrl_c(config: Config, metrics: Arc<Metrics>) -> Result<(), String> {
    let (tx, rx) = watch::channel(false);
    let server = serve(config, metrics, rx);
    tokio::pin!(server);

    tokio::select! {
        result = &mut server => result,
        _ = tokio::signal::ctrl_c() => {
            let _ = tx.send(true);
            server.await
        }
    }
}

fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let Some(presented) = bearer_raw(headers) else {
        // Open server only when neither legacy token nor device auth is configured.
        let has_device = device_auth::load_record(&state.data_dir)
            .ok()
            .flatten()
            .is_some();
        if state.token.is_none() && !has_device {
            return Ok(());
        }
        return Err(StatusCode::UNAUTHORIZED);
    };

    // Session tokens from /v1/auth (opaque random string).
    if state.sessions.valid(&presented) {
        return Ok(());
    }

    // Legacy shared secret: Authorization value is base64(utf8(token)).
    if let Some(expected) = state.token.as_ref() {
        if let Ok(decoded) = B64.decode(presented.as_bytes())
            && device_auth::ct_eq(&decoded, expected.as_bytes())
        {
            return Ok(());
        }
        // Also accept raw token string for convenience (same as base64 of utf8).
        if device_auth::ct_eq(presented.as_bytes(), expected.as_bytes()) {
            return Ok(());
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

fn bearer_raw(headers: &HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::AUTHORIZATION)?;
    let value = header.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?;
    Some(token.to_string())
}

fn legacy_token_ok(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(expected) = state.token.as_ref() else {
        return false;
    };
    let Some(presented) = bearer_raw(headers) else {
        return false;
    };
    if let Ok(decoded) = B64.decode(presented.as_bytes())
        && device_auth::ct_eq(&decoded, expected.as_bytes())
    {
        return true;
    }
    device_auth::ct_eq(presented.as_bytes(), expected.as_bytes())
}

async fn healthz() -> Json<HealthzResponse> {
    Json(HealthzResponse {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn vault_header_public(
    State(state): State<AppState>,
) -> Result<Json<VaultHeaderPublic>, StatusCode> {
    let header = state
        .backend
        .get_header()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(header) = header else {
        return Err(StatusCode::NOT_FOUND);
    };
    Ok(Json(VaultHeaderPublic {
        salt: header.salt,
        argon2: header.argon2,
    }))
}

async fn enroll(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AuthKeyBody>,
) -> Result<StatusCode, StatusCode> {
    let existing =
        device_auth::load_record(&state.data_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if existing.is_some() {
        return Err(StatusCode::CONFLICT);
    }
    let empty_server = state.token.is_none();
    let allowed = legacy_token_ok(&state, &headers) || (empty_server && state.allow_enroll);
    if !allowed {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let auth_key =
        device_auth::decode_auth_key_b64(&body.auth_key).map_err(|_| StatusCode::BAD_REQUEST)?;
    let verifier =
        device_auth::hash_auth_key(&auth_key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let record = device_auth::DeviceAuthRecord {
        verifier,
        created_at_unix: device_auth::unix_now(),
    };
    device_auth::save_record(&state.data_dir, &record)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn device_auth_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AuthKeyBody>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    if !state.rate_limit.check_and_record(&ip) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let record = device_auth::load_record(&state.data_dir)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let auth_key =
        device_auth::decode_auth_key_b64(&body.auth_key).map_err(|_| StatusCode::BAD_REQUEST)?;
    if !device_auth::verify_auth_key(&auth_key, &record.verifier) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let (token, expires_in) = state.sessions.issue();
    Ok(Json(AuthResponse { token, expires_in }))
}

async fn pull_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, StatusCode> {
    authorize(&state, &headers)?;
    state.metrics.pull.fetch_add(1, Ordering::Relaxed);
    state.metrics.touch(KIND_PULL);
    let since = SyncCursor(query.since.unwrap_or_default());
    let (items, cursor) = state
        .backend
        .pull(&since)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(PullResponse { items, cursor }))
}

async fn push_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PushRequest>,
) -> Result<Json<PushResponse>, StatusCode> {
    authorize(&state, &headers)?;
    state.metrics.push.fetch_add(1, Ordering::Relaxed);
    state.metrics.touch(KIND_PUSH);
    let cursor = state
        .backend
        .push(&body.items)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(PushResponse { cursor }))
}

async fn get_header(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<SyncedVaultHeader>>, StatusCode> {
    authorize(&state, &headers)?;
    state.metrics.header_get.fetch_add(1, Ordering::Relaxed);
    state.metrics.touch(KIND_HEADER_GET);
    let header = state
        .backend
        .get_header()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(header))
}

async fn put_header(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(header): Json<SyncedVaultHeader>,
) -> Result<StatusCode, StatusCode> {
    authorize(&state, &headers)?;
    state.metrics.header_put.fetch_add(1, Ordering::Relaxed);
    state.metrics.touch(KIND_HEADER_PUT);
    state
        .backend
        .put_header(&header)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Tauri updater endpoint: 204 means "no update", 200 returns the manifest.
async fn check_update(
    State(state): State<AppState>,
    Path((target, arch, current_version)): Path<(String, String, String)>,
) -> Result<axum::response::Response, StatusCode> {
    use axum::response::IntoResponse;

    let Some(mut manifest) = updates::load_manifest(&state.data_dir) else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    if !updates::is_newer(&manifest.version, &current_version) {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    let key = updates::platform_key(&target, &arch);
    if !manifest.platforms.contains_key(&key) {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    manifest.platforms.retain(|k, _| k == &key);

    if let Some(base) = state.client_url.as_deref() {
        updates::localize_urls(&mut manifest, base);
    }
    Ok(Json(manifest).into_response())
}

async fn download_update(
    State(state): State<AppState>,
    Path(file): Path<String>,
) -> Result<axum::response::Response, StatusCode> {
    use axum::response::IntoResponse;

    // Path traversal guard: only a bare file name from the updates dir.
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let path = updates::updates_dir(&state.data_dir).join(&file);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
        bytes,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn metrics_snapshot_labels() {
        let m = Metrics::default();
        m.touch(KIND_PUSH);
        let snap = m.snapshot();
        assert_eq!(snap.last_kind_label(), "push");
        assert!(snap.last_activity_ms > 0);
    }

    #[test]
    fn listen_parse_via_config() {
        let cfg = Config {
            data_dir: PathBuf::from("/tmp"),
            listen: "127.0.0.1:8787".into(),
            token: "x".into(),
            client_url: None,
            allow_enroll: false,
        };
        let addr = cfg.listen_addr().unwrap();
        assert_eq!(addr.port(), 8787);
    }
}
