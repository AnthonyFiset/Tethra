//! SQLite persistence for vault header and encrypted items.

use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use super::crypto::EncryptedBlob;
use super::kdf::Argon2Params;
use crate::{Error, Result};

pub const RECOVERY_SECRET_KEY: &str = "ssh-client.vault.recovery-key";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Host,
    Identity,
    Project,
    RunningSession,
    ApiKey,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Identity => "identity",
            Self::Project => "project",
            Self::RunningSession => "running_session",
            Self::ApiKey => "api_key",
        }
    }

    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "host" => Ok(Self::Host),
            "identity" => Ok(Self::Identity),
            "project" => Ok(Self::Project),
            "running_session" => Ok(Self::RunningSession),
            "api_key" => Ok(Self::ApiKey),
            other => Err(Error::InvalidArgument(format!(
                "unknown item kind: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct VaultHeader {
    pub salt: Vec<u8>,
    pub argon2: Argon2Params,
    pub wrapped_vault_key: EncryptedBlob,
    pub recovery_wrapped_vault_key: Option<EncryptedBlob>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ItemRow {
    pub id: Uuid,
    pub kind: ItemKind,
    pub version: u64,
    pub updated_at: DateTime<Utc>,
    pub deleted: bool,
    pub local_only: bool,
    pub blob: EncryptedBlob,
}

pub struct VaultDb {
    conn: Connection,
}

impl VaultDb {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS vault_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                salt BLOB NOT NULL,
                memory_kib INTEGER NOT NULL,
                time_cost INTEGER NOT NULL,
                parallelism INTEGER NOT NULL,
                wrap_nonce BLOB NOT NULL,
                wrap_ciphertext BLOB NOT NULL,
                recovery_nonce BLOB,
                recovery_ciphertext BLOB,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY NOT NULL,
                kind TEXT NOT NULL,
                version INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                local_only INTEGER NOT NULL DEFAULT 0,
                nonce BLOB NOT NULL,
                ciphertext BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
            ",
        )?;
        Ok(Self { conn })
    }

    /// Drop every row so the vault looks freshly initialized. Used when a
    /// device abandons its own vault to join a synced one.
    pub fn wipe(&mut self) -> Result<()> {
        self.conn
            .execute_batch("DELETE FROM items; DELETE FROM vault_meta;")?;
        Ok(())
    }

    pub fn has_header(&self) -> Result<bool> {
        let count: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM vault_meta WHERE id = 1", [], |row| {
                    row.get(0)
                })?;
        Ok(count > 0)
    }

    pub fn write_header(&mut self, header: &VaultHeader) -> Result<()> {
        let recovery_nonce = header
            .recovery_wrapped_vault_key
            .as_ref()
            .map(|b| b.nonce.as_slice());
        let recovery_ciphertext = header
            .recovery_wrapped_vault_key
            .as_ref()
            .map(|b| b.ciphertext.as_slice());

        self.conn.execute(
            "INSERT INTO vault_meta (
                id, salt, memory_kib, time_cost, parallelism,
                wrap_nonce, wrap_ciphertext, recovery_nonce, recovery_ciphertext, created_at
            ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                salt = excluded.salt,
                memory_kib = excluded.memory_kib,
                time_cost = excluded.time_cost,
                parallelism = excluded.parallelism,
                wrap_nonce = excluded.wrap_nonce,
                wrap_ciphertext = excluded.wrap_ciphertext,
                recovery_nonce = excluded.recovery_nonce,
                recovery_ciphertext = excluded.recovery_ciphertext,
                created_at = excluded.created_at
            ",
            params![
                header.salt,
                header.argon2.memory_kib,
                header.argon2.time_cost,
                header.argon2.parallelism,
                header.wrapped_vault_key.nonce,
                header.wrapped_vault_key.ciphertext,
                recovery_nonce,
                recovery_ciphertext,
                header.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn read_header(&self) -> Result<VaultHeader> {
        self.conn
            .query_row(
                "SELECT salt, memory_kib, time_cost, parallelism,
                        wrap_nonce, wrap_ciphertext, recovery_nonce, recovery_ciphertext, created_at
                 FROM vault_meta WHERE id = 1",
                [],
                |row| {
                    let recovery_nonce: Option<Vec<u8>> = row.get(6)?;
                    let recovery_ciphertext: Option<Vec<u8>> = row.get(7)?;
                    let recovery = match (recovery_nonce, recovery_ciphertext) {
                        (Some(nonce), Some(ciphertext)) => {
                            Some(EncryptedBlob { nonce, ciphertext })
                        }
                        _ => None,
                    };
                    let created_at = DateTime::parse_from_rfc3339(&row.get::<_, String>(8)?)
                        .map(|dt| dt.with_timezone(&Utc))
                        .map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                8,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })?;
                    Ok(VaultHeader {
                        salt: row.get(0)?,
                        argon2: Argon2Params {
                            memory_kib: row.get(1)?,
                            time_cost: row.get(2)?,
                            parallelism: row.get(3)?,
                        },
                        wrapped_vault_key: EncryptedBlob {
                            nonce: row.get(4)?,
                            ciphertext: row.get(5)?,
                        },
                        recovery_wrapped_vault_key: recovery,
                        created_at,
                    })
                },
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Error::VaultNotFound,
                other => Error::from(other),
            })
    }

    pub fn upsert_item(&mut self, row: &ItemRow) -> Result<()> {
        upsert_item_on(&self.conn, row)
    }

    /// Atomically persist a batch of independently encrypted items.
    pub fn upsert_items_transaction(&mut self, rows: &[ItemRow]) -> Result<()> {
        let transaction = self.conn.transaction()?;
        for row in rows {
            upsert_item_on(&transaction, row)?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn get_item(&self, id: Uuid) -> Result<Option<ItemRow>> {
        self.conn
            .query_row(
                "SELECT id, kind, version, updated_at, deleted, local_only, nonce, ciphertext
                 FROM items WHERE id = ?1",
                params![id.to_string()],
                map_item_row,
            )
            .optional()
            .map_err(Error::from)
    }

    pub fn list_items(&self, kind: ItemKind, include_deleted: bool) -> Result<Vec<ItemRow>> {
        let mut stmt = if include_deleted {
            self.conn.prepare(
                "SELECT id, kind, version, updated_at, deleted, local_only, nonce, ciphertext
                 FROM items WHERE kind = ?1 ORDER BY updated_at DESC",
            )?
        } else {
            self.conn.prepare(
                "SELECT id, kind, version, updated_at, deleted, local_only, nonce, ciphertext
                 FROM items WHERE kind = ?1 AND deleted = 0 ORDER BY updated_at DESC",
            )?
        };
        let rows = stmt
            .query_map(params![kind.as_str()], map_item_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn upsert_item_on(conn: &Connection, row: &ItemRow) -> Result<()> {
    conn.execute(
        "INSERT INTO items (id, kind, version, updated_at, deleted, local_only, nonce, ciphertext)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                version = excluded.version,
                updated_at = excluded.updated_at,
                deleted = excluded.deleted,
                local_only = excluded.local_only,
                nonce = excluded.nonce,
                ciphertext = excluded.ciphertext
            ",
        params![
            row.id.to_string(),
            row.kind.as_str(),
            row.version as i64,
            row.updated_at.to_rfc3339(),
            row.deleted as i64,
            row.local_only as i64,
            row.blob.nonce,
            row.blob.ciphertext,
        ],
    )?;
    Ok(())
}

fn map_item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ItemRow> {
    let id = Uuid::parse_str(&row.get::<_, String>(0)?).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let kind = ItemKind::parse(&row.get::<_, String>(1)?).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let updated_at = DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(ItemRow {
        id,
        kind,
        version: row.get::<_, i64>(2)? as u64,
        updated_at,
        deleted: row.get::<_, i64>(4)? != 0,
        local_only: row.get::<_, i64>(5)? != 0,
        blob: EncryptedBlob {
            nonce: row.get(6)?,
            ciphertext: row.get(7)?,
        },
    })
}
