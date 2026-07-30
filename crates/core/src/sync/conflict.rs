//! Last-write-wins conflict resolution.

use crate::sync::types::SyncItem;
use crate::vault::ItemRow;

/// Returns true when `incoming` should replace `local` under PROJECT §8 rules:
/// higher `version`, then later `updated_at`, then lexicographic `id`.
pub fn wins_over(incoming: &SyncItem, local: &ItemRow) -> bool {
    debug_assert_eq!(incoming.id, local.id);
    if incoming.version != local.version {
        return incoming.version > local.version;
    }
    if incoming.updated_at != local.updated_at {
        return incoming.updated_at > local.updated_at;
    }
    // Equal version + timestamp: keep local on exact equality.
    false
}

/// Compare two sync items that share an id.
pub fn item_wins_over(incoming: &SyncItem, other: &SyncItem) -> bool {
    debug_assert_eq!(incoming.id, other.id);
    if incoming.version != other.version {
        return incoming.version > other.version;
    }
    if incoming.updated_at != other.updated_at {
        return incoming.updated_at > other.updated_at;
    }
    false
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use uuid::Uuid;

    use super::*;
    use crate::vault::{EncryptedBlob, ItemKind};

    fn item(version: u64, offset_secs: i64) -> SyncItem {
        SyncItem {
            id: Uuid::nil(),
            kind: "host".into(),
            version,
            updated_at: Utc::now() + Duration::seconds(offset_secs),
            deleted: false,
            nonce: "bg==".into(),
            ciphertext: "Yw==".into(),
        }
    }

    fn row(version: u64, offset_secs: i64) -> ItemRow {
        ItemRow {
            id: Uuid::nil(),
            kind: ItemKind::Host,
            version,
            updated_at: Utc::now() + Duration::seconds(offset_secs),
            deleted: false,
            local_only: false,
            blob: EncryptedBlob {
                nonce: vec![1],
                ciphertext: vec![2],
            },
        }
    }

    #[test]
    fn higher_version_wins() {
        assert!(wins_over(&item(3, 0), &row(2, 100)));
        assert!(!wins_over(&item(2, 100), &row(3, 0)));
    }

    #[test]
    fn equal_version_later_timestamp_wins() {
        assert!(wins_over(&item(2, 10), &row(2, 0)));
        assert!(!wins_over(&item(2, 0), &row(2, 10)));
    }

    #[test]
    fn equal_version_and_time_keeps_local() {
        let incoming = item(2, 0);
        let mut local = row(2, 0);
        local.updated_at = incoming.updated_at;
        assert!(!wins_over(&incoming, &local));
    }
}
