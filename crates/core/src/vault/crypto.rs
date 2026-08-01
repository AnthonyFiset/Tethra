//! XChaCha20-Poly1305 helpers for vault-key wrapping and per-item encryption.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop};

use super::kdf::KEY_LEN;
use crate::{Error, Result};

pub const NONCE_LEN: usize = 24;

/// Encrypted blob persisted to SQLite / sync.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EncryptedBlob {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// 32-byte vault key that zeroizes on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct VaultKey([u8; KEY_LEN]);

impl VaultKey {
    pub fn new(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    pub fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    pub fn random() -> Result<Self> {
        Ok(Self(super::kdf::random_key()?))
    }
}

impl std::fmt::Debug for VaultKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultKey([REDACTED])")
    }
}

fn random_nonce() -> Result<[u8; NONCE_LEN]> {
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng()
        .try_fill_bytes(&mut nonce)
        .map_err(|e| Error::Crypto(format!("failed to generate nonce: {e}")))?;
    Ok(nonce)
}

fn cipher_from_key(key: &[u8; KEY_LEN]) -> Result<XChaCha20Poly1305> {
    XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| Error::Crypto(format!("invalid aead key: {e}")))
}

/// Wrap (encrypt) a 32-byte vault key under `wrapping_key`.
pub fn wrap_key(wrapping_key: &[u8; KEY_LEN], vault_key: &VaultKey) -> Result<EncryptedBlob> {
    encrypt_raw(wrapping_key, vault_key.expose(), b"vault-key-wrap-v1")
}

/// Unwrap a vault key. Wrong wrapping key yields [`Error::IncorrectPassword`] or crypto error.
pub fn unwrap_key(wrapping_key: &[u8; KEY_LEN], blob: &EncryptedBlob) -> Result<VaultKey> {
    let plaintext =
        decrypt_raw(wrapping_key, blob, b"vault-key-wrap-v1").map_err(|err| match err {
            Error::Crypto(_) => Error::IncorrectPassword,
            other => other,
        })?;
    if plaintext.len() != KEY_LEN {
        return Err(Error::IncorrectPassword);
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&plaintext);
    Ok(VaultKey::new(key))
}

/// Seal plaintext under the vault key (used for sync re-key attestations).
pub fn seal_with_vault_key(
    vault_key: &VaultKey,
    aad: &[u8],
    plaintext: &[u8],
) -> Result<EncryptedBlob> {
    encrypt_raw(vault_key.expose(), plaintext, aad)
}

/// Open a vault-key sealed blob.
pub fn open_with_vault_key(
    vault_key: &VaultKey,
    aad: &[u8],
    blob: &EncryptedBlob,
) -> Result<Vec<u8>> {
    decrypt_raw(vault_key.expose(), blob, aad)
}

/// Encrypt an item with AAD = `item_id || version` (little-endian version).
pub fn encrypt_item(
    vault_key: &VaultKey,
    item_id: Uuid,
    version: u64,
    plaintext: &[u8],
) -> Result<EncryptedBlob> {
    let aad = item_aad(item_id, version);
    encrypt_raw(vault_key.expose(), plaintext, &aad)
}

/// Decrypt an item; AAD mismatch fails authentication.
pub fn decrypt_item(
    vault_key: &VaultKey,
    item_id: Uuid,
    version: u64,
    blob: &EncryptedBlob,
) -> Result<Vec<u8>> {
    let aad = item_aad(item_id, version);
    decrypt_raw(vault_key.expose(), blob, &aad)
}

pub fn item_aad(item_id: Uuid, version: u64) -> Vec<u8> {
    let mut aad = Vec::with_capacity(16 + 8);
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&version.to_le_bytes());
    aad
}

fn encrypt_raw(key: &[u8; KEY_LEN], plaintext: &[u8], aad: &[u8]) -> Result<EncryptedBlob> {
    let cipher = cipher_from_key(key)?;
    let nonce_bytes = random_nonce()?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| Error::Crypto(format!("encrypt failed: {e}")))?;
    Ok(EncryptedBlob {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

fn decrypt_raw(key: &[u8; KEY_LEN], blob: &EncryptedBlob, aad: &[u8]) -> Result<Vec<u8>> {
    if blob.nonce.len() != NONCE_LEN {
        return Err(Error::Crypto(format!(
            "nonce must be {NONCE_LEN} bytes, got {}",
            blob.nonce.len()
        )));
    }
    let cipher = cipher_from_key(key)?;
    let nonce = XNonce::from_slice(&blob.nonce);
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &blob.ciphertext,
                aad,
            },
        )
        .map_err(|e| Error::Crypto(format!("decrypt failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::kdf;

    #[test]
    fn wrap_roundtrip() {
        let wrapping = kdf::random_key().unwrap();
        let vault = VaultKey::random().unwrap();
        let blob = wrap_key(&wrapping, &vault).unwrap();
        let opened = unwrap_key(&wrapping, &blob).unwrap();
        assert_eq!(vault.expose(), opened.expose());
    }

    #[test]
    fn wrong_wrapping_key_fails() {
        let wrapping = kdf::random_key().unwrap();
        let other = kdf::random_key().unwrap();
        let vault = VaultKey::random().unwrap();
        let blob = wrap_key(&wrapping, &vault).unwrap();
        assert!(matches!(
            unwrap_key(&other, &blob),
            Err(Error::IncorrectPassword)
        ));
    }

    #[test]
    fn item_aad_binding() {
        let key = VaultKey::random().unwrap();
        let id = Uuid::now_v7();
        let blob = encrypt_item(&key, id, 1, b"secret-host").unwrap();
        assert_eq!(decrypt_item(&key, id, 1, &blob).unwrap(), b"secret-host");
        assert!(decrypt_item(&key, id, 2, &blob).is_err());
        assert!(decrypt_item(&key, Uuid::now_v7(), 1, &blob).is_err());
    }
}
