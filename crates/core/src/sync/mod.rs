//! Sync adapters and reconciliation.
//!
//! [`LocalOnly`] ships as the default. [`FileBackend`] stores opaque ciphertext
//! rows in a user-chosen directory (Dropbox, OneDrive, Syncthing, or a folder
//! on a Tailscale host). [`HttpBackend`] talks to the same row protocol over
//! HTTP so an always-on Linux box can host sync for Mac and Windows clients.
//!
//! Password and SSH-key identities default to `local_only`; an opt-in
//! `sync_secret` flag lets them sync under the same item encryption. The shared
//! vault header (salt + password-wrapped vault key) is published so another
//! device can unlock with the same master password. Coordinated re-key
//! publishes a `rekey_from` attestation so peers adopt a new password wrap
//! without reset.

mod conflict;
mod encode;
mod engine;
mod file;
mod http;
mod types;

pub use conflict::wins_over;
pub use encode::{item_row_from_sync, sync_item_from_row};
pub use engine::{SyncEngine, SyncReport, SyncStatus};
pub use file::FileBackend;
pub use http::{HttpBackend, VaultHeaderPublic};
pub use types::{RekeyFrom, SyncCursor, SyncItem, SyncedVaultHeader, TOMBSTONE_RETENTION_DAYS};

use async_trait::async_trait;

use crate::Result;

/// Opaque storage the sync server / folder is allowed to see.
#[async_trait]
pub trait SyncBackend: Send + Sync {
    async fn pull(&self, since: &SyncCursor) -> Result<(Vec<SyncItem>, SyncCursor)>;
    async fn push(&self, items: &[SyncItem]) -> Result<SyncCursor>;
    async fn get_header(&self) -> Result<Option<SyncedVaultHeader>>;
    async fn put_header(&self, header: &SyncedVaultHeader) -> Result<()>;
}

/// No sync at all.
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

    async fn get_header(&self) -> Result<Option<SyncedVaultHeader>> {
        Ok(None)
    }

    async fn put_header(&self, _header: &SyncedVaultHeader) -> Result<()> {
        Ok(())
    }
}
