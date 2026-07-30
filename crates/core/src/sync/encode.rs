//! Conversions between vault rows and opaque sync items.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;

use crate::sync::types::SyncItem;
use crate::vault::{EncryptedBlob, ItemKind, ItemRow};
use crate::{Error, Result};

pub fn sync_item_from_row(row: &ItemRow) -> SyncItem {
    SyncItem {
        id: row.id,
        kind: row.kind.as_str().to_string(),
        version: row.version,
        updated_at: row.updated_at,
        deleted: row.deleted,
        nonce: B64.encode(&row.blob.nonce),
        ciphertext: B64.encode(&row.blob.ciphertext),
    }
}

pub fn item_row_from_sync(item: &SyncItem) -> Result<ItemRow> {
    let kind = ItemKind::parse(&item.kind)?;
    let nonce = B64
        .decode(item.nonce.as_bytes())
        .map_err(|e| Error::InvalidArgument(format!("invalid sync nonce: {e}")))?;
    let ciphertext = B64
        .decode(item.ciphertext.as_bytes())
        .map_err(|e| Error::InvalidArgument(format!("invalid sync ciphertext: {e}")))?;
    Ok(ItemRow {
        id: item.id,
        kind,
        version: item.version,
        updated_at: item.updated_at,
        deleted: item.deleted,
        local_only: false,
        blob: EncryptedBlob { nonce, ciphertext },
    })
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn roundtrip_preserves_bytes() {
        let row = ItemRow {
            id: Uuid::now_v7(),
            kind: ItemKind::Host,
            version: 4,
            updated_at: Utc::now(),
            deleted: false,
            local_only: false,
            blob: EncryptedBlob {
                nonce: vec![9, 8, 7],
                ciphertext: vec![1, 2, 3, 4],
            },
        };
        let sync = sync_item_from_row(&row);
        let back = item_row_from_sync(&sync).unwrap();
        assert_eq!(back.id, row.id);
        assert_eq!(back.version, row.version);
        assert_eq!(back.blob, row.blob);
        assert!(!back.local_only);
    }
}
