//! Self-hosted sync server for a Tailscale / LAN host.
//!
//! Example on an Ubuntu ThinkPad:
//! ```bash
//! tethra-sync-server --data-dir ~/tethra-sync --listen 0.0.0.0:8787 --token 'pick-a-secret'
//! ```
//! Then point Mac/Windows clients at `http://<tailscale-name>:8787`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use clap::Parser;
use serde::{Deserialize, Serialize};
use ssh_client_core::sync::{FileBackend, SyncBackend, SyncCursor, SyncItem, SyncedVaultHeader};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Parser, Debug)]
#[command(
    name = "tethra-sync-server",
    about = "Host Tethra vault sync over HTTP"
)]
struct Args {
    /// Directory that stores opaque sync rows (same layout as FileBackend).
    #[arg(long, env = "TETHRA_SYNC_DATA", default_value = "./tethra-sync")]
    data_dir: PathBuf,

    /// Bind address. Prefer Tailscale IP or 0.0.0.0 behind Tailscale ACLs.
    #[arg(long, env = "TETHRA_SYNC_LISTEN", default_value = "0.0.0.0:8787")]
    listen: SocketAddr,

    /// Optional shared bearer token. When set, clients must send
    /// `Authorization: Bearer <base64(token)>`.
    #[arg(long, env = "TETHRA_SYNC_TOKEN")]
    token: Option<String>,
}

#[derive(Clone)]
struct AppState {
    backend: Arc<FileBackend>,
    token: Option<String>,
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tethra_sync_server=info,tower_http=info".into()),
        )
        .init();

    let args = Args::parse();
    std::fs::create_dir_all(&args.data_dir)?;
    let backend = Arc::new(FileBackend::new(&args.data_dir));
    // Touch layout so the directory is ready before the first client.
    let _ = backend.pull(&SyncCursor::default()).await?;

    let state = AppState {
        backend,
        token: args.token,
    };

    let app = Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
        .route("/v1/items", get(pull_items).post(push_items))
        .route("/v1/header", get(get_header).put(put_header))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!(listen = %args.listen, data = %args.data_dir.display(), "tethra sync server listening");
    let listener = tokio::net::TcpListener::bind(args.listen).await?;
    axum::serve(listener, app).await?;
    Ok(())
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
    state
        .backend
        .put_header(&header)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
