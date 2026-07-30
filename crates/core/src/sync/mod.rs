//! Sync adapters. M1 ships [`LocalOnly`]; FileBackend / HttpBackend come later.

use async_trait::async_trait;

use crate::Result;

/// Opaque sync cursor.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncCursor(pub String);

/// Row the sync server is allowed to see — ciphertext only.
#[derive(Debug, Clone)]
pub struct SyncItem {
    pub id: uuid::Uuid,
    pub kind: String,
    pub version: u64,
    pub updated_at: String,
    pub deleted: bool,
    pub nonce: String,
    pub ciphertext: String,
}

#[async_trait]
pub trait SyncBackend: Send + Sync {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)>;
    async fn push(&self, items: &[SyncItem]) -> Result<SyncCursor>;
}

/// No sync at all. Ship v1 with this.
#[derive(Debug, Default)]
pub struct LocalOnly;

#[async_trait]
impl SyncBackend for LocalOnly {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)> {
        Ok((Vec::new(), since.clone()))
    }

    async fn push(&self, _items: &[SyncItem]) -> Result<SyncCursor> {
        Ok(SyncCursor::default())
    }
}
