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
    };
    Ok(Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
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
    let Some(expected) = state.token.as_ref() else {
        return Ok(());
    };
    let Some(header) = headers.get(axum::http::header::AUTHORIZATION) else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Ok(value) = header.to_str() else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Ok(decoded) = B64.decode(token.as_bytes()) else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    if decoded.as_slice() != expected.as_bytes() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
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
        };
        let addr = cfg.listen_addr().unwrap();
        assert_eq!(addr.port(), 8787);
    }
}
