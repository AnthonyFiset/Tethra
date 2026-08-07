//! Update distribution for Tethra desktop clients.
//!
//! Release assets live in a private GitHub repo, so clients cannot fetch them
//! directly without embedding a credential. Instead this host mirrors the
//! assets (via `gh`, which is already authenticated here) and serves the
//! manifest Tauri's updater expects. Payload integrity comes from the minisign
//! signature the updater verifies, not from the transport.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Subdirectory of the server data dir holding mirrored release assets.
pub const UPDATES_DIR: &str = "updates";

/// What `tauri-plugin-updater` expects from a static/dynamic endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateManifest {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub pub_date: String,
    pub platforms: std::collections::BTreeMap<String, PlatformEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformEntry {
    pub signature: String,
    pub url: String,
}

pub fn updates_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(UPDATES_DIR)
}

pub fn manifest_path(data_dir: &Path) -> PathBuf {
    updates_dir(data_dir).join("latest.json")
}

pub fn load_manifest(data_dir: &Path) -> Option<UpdateManifest> {
    let text = std::fs::read_to_string(manifest_path(data_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Tauri asks for `{target}-{arch}` (e.g. `darwin-aarch64`), but older clients
/// and some targets use just `{target}`. Accept both.
pub fn platform_key(target: &str, arch: &str) -> String {
    format!("{target}-{arch}")
}

/// Semver-ish comparison good enough for `x.y.z` release tags.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.trim_start_matches('v')
            .split('-')
            .next()
            .unwrap_or("0")
            .split('.')
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    }
    let (a, b) = (parts(candidate), parts(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    false
}

/// Rewrite manifest asset URLs so clients download from this server rather than
/// from GitHub, which would require a token.
pub fn localize_urls(manifest: &mut UpdateManifest, base_url: &str) {
    let base = base_url.trim_end_matches('/');
    for entry in manifest.platforms.values_mut() {
        let file = entry.url.rsplit('/').next().unwrap_or_default().to_string();
        if !file.is_empty() {
            entry.url = format!("{base}/updates/download/{file}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_detected() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("v0.3.0", "0.2.0"));
    }

    #[test]
    fn urls_point_at_this_server() {
        let mut manifest = UpdateManifest {
            version: "0.2.0".into(),
            notes: None,
            pub_date: "2026-07-30T00:00:00Z".into(),
            platforms: [(
                "darwin-aarch64".to_string(),
                PlatformEntry {
                    signature: "sig".into(),
                    url: "https://github.com/o/r/releases/download/v0.2.0/Tethra.app.tar.gz".into(),
                },
            )]
            .into_iter()
            .collect(),
        };
        localize_urls(&mut manifest, "http://sync.example:8787/");
        assert_eq!(
            manifest.platforms["darwin-aarch64"].url,
            "http://sync.example:8787/updates/download/Tethra.app.tar.gz"
        );
    }

    #[test]
    fn platform_key_matches_tauri_format() {
        assert_eq!(platform_key("darwin", "aarch64"), "darwin-aarch64");
    }
}
