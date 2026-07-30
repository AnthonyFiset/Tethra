//! Key derivation for the vault master password.
//!
//! ```text
//! master_key = Argon2id(password, salt, m, t, p, len=32)
//! enc_key    = HKDF-SHA256(master_key, info="vault-enc-v1",  len=32)
//! auth_key   = HKDF-SHA256(master_key, info="vault-auth-v1", len=32)
//! ```

use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{Error, Result};

/// Default Argon2id memory cost in KiB (64 MiB).
pub const DEFAULT_MEMORY_KIB: u32 = 65_536;
/// Default Argon2id time cost.
pub const DEFAULT_TIME_COST: u32 = 3;
/// Default Argon2id parallelism.
pub const DEFAULT_PARALLELISM: u32 = 4;
/// Derived key length.
pub const KEY_LEN: usize = 32;
/// Salt length.
pub const SALT_LEN: usize = 16;

const INFO_ENC: &[u8] = b"vault-enc-v1";
const INFO_AUTH: &[u8] = b"vault-auth-v1";

/// Argon2 parameters persisted alongside the salt so they can be raised later.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Argon2Params {
    pub memory_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

impl Default for Argon2Params {
    fn default() -> Self {
        Self {
            memory_kib: DEFAULT_MEMORY_KIB,
            time_cost: DEFAULT_TIME_COST,
            parallelism: DEFAULT_PARALLELISM,
        }
    }
}

/// Key material derived from the master password. Never log or serialize.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DerivedKeys {
    pub master_key: [u8; KEY_LEN],
    pub enc_key: [u8; KEY_LEN],
    pub auth_key: [u8; KEY_LEN],
}

impl std::fmt::Debug for DerivedKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DerivedKeys([REDACTED])")
    }
}

pub fn random_salt() -> Result<[u8; SALT_LEN]> {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng()
        .try_fill_bytes(&mut salt)
        .map_err(|e| Error::Crypto(format!("failed to generate salt: {e}")))?;
    Ok(salt)
}

pub fn random_key() -> Result<[u8; KEY_LEN]> {
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng()
        .try_fill_bytes(&mut key)
        .map_err(|e| Error::Crypto(format!("failed to generate key: {e}")))?;
    Ok(key)
}

/// Derive enc/auth keys from a password using the stored Argon2 parameters.
pub fn derive_keys(password: &[u8], salt: &[u8], params: &Argon2Params) -> Result<DerivedKeys> {
    if salt.len() != SALT_LEN {
        return Err(Error::Crypto(format!(
            "salt must be {SALT_LEN} bytes, got {}",
            salt.len()
        )));
    }

    let argon_params = Params::new(
        params.memory_kib,
        params.time_cost,
        params.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|e| Error::Crypto(format!("invalid argon2 params: {e}")))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut master = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password, salt, master.as_mut())
        .map_err(|e| Error::Crypto(format!("argon2 failed: {e}")))?;

    let enc_key = hkdf_expand(master.as_ref(), INFO_ENC)?;
    let auth_key = hkdf_expand(master.as_ref(), INFO_AUTH)?;

    Ok(DerivedKeys {
        master_key: *master,
        enc_key,
        auth_key,
    })
}

fn hkdf_expand(ikm: &[u8], info: &[u8]) -> Result<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, ikm);
    let mut out = [0u8; KEY_LEN];
    hk.expand(info, &mut out)
        .map_err(|e| Error::Crypto(format!("hkdf expand failed: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_is_deterministic_and_separated() {
        let salt = [7u8; SALT_LEN];
        let params = Argon2Params {
            memory_kib: 8,
            time_cost: 1,
            parallelism: 1,
        };
        let a = derive_keys(b"hunter2", &salt, &params).expect("a");
        let b = derive_keys(b"hunter2", &salt, &params).expect("b");
        assert_eq!(a.enc_key, b.enc_key);
        assert_eq!(a.auth_key, b.auth_key);
        assert_ne!(a.enc_key, a.auth_key);
        assert_ne!(a.master_key, a.enc_key);
    }

    #[test]
    fn different_passwords_differ() {
        let salt = [9u8; SALT_LEN];
        let params = Argon2Params {
            memory_kib: 8,
            time_cost: 1,
            parallelism: 1,
        };
        let a = derive_keys(b"one", &salt, &params).expect("a");
        let b = derive_keys(b"two", &salt, &params).expect("b");
        assert_ne!(a.enc_key, b.enc_key);
    }
}
