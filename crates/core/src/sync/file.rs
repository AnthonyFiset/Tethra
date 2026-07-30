//! Directory-backed sync storage.
//!
//! Layout:
//! ```text
//! <root>/
//!   manifest.json
//!   vault-header.json
//!   items/<uuid>.json
//! ```
//!
//! Writes use temp-file + rename so cloud sync tools and concurrent readers
//! see complete files.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::fs;
use uuid::Uuid;

use crate::sync::SyncBackend;
use crate::sync::conflict::item_wins_over;
use crate::sync::types::{SyncCursor, SyncItem, SyncedVaultHeader};
use crate::{Error, Result};

const MANIFEST_NAME: &str = "manifest.json";
const HEADER_NAME: &str = "vault-header.json";
const ITEMS_DIR: &str = "items";
const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    format_version: u32,
    revision: u64,
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            format_version: FORMAT_VERSION,
            revision: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileBackend {
    root: PathBuf,
}

impl FileBackend {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    async fn ensure_layout(&self) -> Result<()> {
        fs::create_dir_all(self.root.join(ITEMS_DIR)).await?;
        if !self.root.join(MANIFEST_NAME).exists() {
            self.write_manifest(&Manifest::default()).await?;
        }
        Ok(())
    }

    async fn read_manifest(&self) -> Result<Manifest> {
        let path = self.root.join(MANIFEST_NAME);
        if !path.exists() {
            return Ok(Manifest::default());
        }
        let bytes = fs::read(&path).await?;
        serde_json::from_slice(&bytes).map_err(|e| Error::Other(format!("sync manifest: {e}")))
    }

    async fn write_manifest(&self, manifest: &Manifest) -> Result<()> {
        atomic_write_json(&self.root.join(MANIFEST_NAME), manifest).await
    }

    fn item_path(&self, id: Uuid) -> PathBuf {
        self.root.join(ITEMS_DIR).join(format!("{id}.json"))
    }

    async fn read_all_items(&self) -> Result<Vec<SyncItem>> {
        let dir = self.root.join(ITEMS_DIR);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let bytes = fs::read(&path).await?;
            match serde_json::from_slice::<SyncItem>(&bytes) {
                Ok(item) => out.push(item),
                Err(err) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %err,
                        "skipping unreadable sync item"
                    );
                }
            }
        }
        Ok(out)
    }
}

#[async_trait]
impl SyncBackend for FileBackend {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)> {
        self.ensure_layout().await?;
        let manifest = self.read_manifest().await?;
        let since_rev = since.parse_revision();
        let items = if since_rev >= manifest.revision {
            Vec::new()
        } else {
            // FileBackend has no per-item revision index; clients that lag
            // receive the full opaque set and apply LWW locally.
            self.read_all_items().await?
        };
        Ok((items, SyncCursor::from_revision(manifest.revision)))
    }

    async fn push(&self, items: &[SyncItem]) -> Result<SyncCursor> {
        self.ensure_layout().await?;
        if items.is_empty() {
            let manifest = self.read_manifest().await?;
            return Ok(SyncCursor::from_revision(manifest.revision));
        }

        let mut changed = false;
        for incoming in items {
            let path = self.item_path(incoming.id);
            let winner = if path.exists() {
                let bytes = fs::read(&path).await?;
                let existing: SyncItem = serde_json::from_slice(&bytes)
                    .map_err(|e| Error::Other(format!("sync item {}: {e}", incoming.id)))?;
                if item_wins_over(incoming, &existing) {
                    Some(incoming)
                } else {
                    None
                }
            } else {
                Some(incoming)
            };

            if let Some(item) = winner {
                atomic_write_json(&path, item).await?;
                changed = true;
            }
        }

        let mut manifest = self.read_manifest().await?;
        if changed {
            manifest.revision = manifest.revision.saturating_add(1);
            self.write_manifest(&manifest).await?;
        }
        Ok(SyncCursor::from_revision(manifest.revision))
    }

    async fn get_header(&self) -> Result<Option<SyncedVaultHeader>> {
        self.ensure_layout().await?;
        let path = self.root.join(HEADER_NAME);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(&path).await?;
        let header = serde_json::from_slice(&bytes)
            .map_err(|e| Error::Other(format!("sync vault header: {e}")))?;
        Ok(Some(header))
    }

    async fn put_header(&self, header: &SyncedVaultHeader) -> Result<()> {
        self.ensure_layout().await?;
        atomic_write_json(&self.root.join(HEADER_NAME), header).await?;
        let mut manifest = self.read_manifest().await?;
        manifest.revision = manifest.revision.saturating_add(1);
        self.write_manifest(&manifest).await
    }
}

async fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &bytes).await?;
    fs::rename(&tmp, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::*;

    fn sample_item(version: u64) -> SyncItem {
        SyncItem {
            id: Uuid::nil(),
            kind: "host".into(),
            version,
            updated_at: Utc::now(),
            deleted: false,
            nonce: "AQID".into(),
            ciphertext: "BAUG".into(),
        }
    }

    #[tokio::test]
    async fn push_pull_roundtrip() {
        let dir = tempdir().unwrap();
        let backend = FileBackend::new(dir.path());
        let cursor = backend.push(&[sample_item(1)]).await.unwrap();
        assert_eq!(cursor.parse_revision(), 1);
        let (items, next) = backend.pull(&SyncCursor::default()).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(next.parse_revision(), 1);
        let (empty, _) = backend.pull(&next).await.unwrap();
        assert!(empty.is_empty());
    }

    #[tokio::test]
    async fn push_keeps_newer_existing_item() {
        let dir = tempdir().unwrap();
        let backend = FileBackend::new(dir.path());
        backend.push(&[sample_item(3)]).await.unwrap();
        backend.push(&[sample_item(2)]).await.unwrap();
        let (items, _) = backend.pull(&SyncCursor::default()).await.unwrap();
        assert_eq!(items[0].version, 3);
    }
}
