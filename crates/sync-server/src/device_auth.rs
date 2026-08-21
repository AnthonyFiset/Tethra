//! Vault-derived device auth for the sync server (PROJECT.md §6.1 / NEXT).
//!
//! The server stores `argon2id(auth_key)` only. Clients prove knowledge of
//! `auth_key` via `/v1/auth` and receive a short-lived session bearer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, Params};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

const VERIFIER_FILE: &str = "device-auth.json";
const SESSION_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const AUTH_RATE_LIMIT: usize = 5;
const AUTH_RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAuthRecord {
    /// PHC-encoded argon2id hash of the 32-byte auth_key.
    pub verifier: String,
    pub created_at_unix: u64,
}

#[derive(Debug, Default)]
pub struct SessionStore {
    /// session_token (raw string) → expiry
    sessions: Mutex<HashMap<String, Instant>>,
}

impl SessionStore {
    pub fn issue(&self) -> (String, u64) {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = B64.encode(bytes);
        let expires = Instant::now() + SESSION_TTL;
        self.sessions
            .lock()
            .expect("session lock")
            .insert(token.clone(), expires);
        (token, SESSION_TTL.as_secs())
    }

    pub fn valid(&self, token: &str) -> bool {
        let mut map = self.sessions.lock().expect("session lock");
        let now = Instant::now();
        map.retain(|_, exp| *exp > now);
        map.get(token).is_some_and(|exp| *exp > now)
    }
}

#[derive(Debug, Default)]
pub struct AuthRateLimiter {
    /// IP → recent attempt timestamps
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl AuthRateLimiter {
    pub fn check_and_record(&self, ip: &str) -> bool {
        let mut map = self.hits.lock().expect("rate lock");
        let now = Instant::now();
        let entry = map.entry(ip.to_string()).or_default();
        entry.retain(|t| now.duration_since(*t) < AUTH_RATE_WINDOW);
        if entry.len() >= AUTH_RATE_LIMIT {
            return false;
        }
        entry.push(now);
        true
    }
}

pub fn verifier_path(data_dir: &Path) -> PathBuf {
    data_dir.join(VERIFIER_FILE)
}

pub fn load_record(data_dir: &Path) -> Result<Option<DeviceAuthRecord>, String> {
    let path = verifier_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read device-auth: {e}"))?;
    let record = serde_json::from_slice(&bytes).map_err(|e| format!("parse device-auth: {e}"))?;
    Ok(Some(record))
}

pub fn save_record(data_dir: &Path, record: &DeviceAuthRecord) -> Result<(), String> {
    let path = verifier_path(data_dir);
    let bytes = serde_json::to_vec_pretty(record).map_err(|e| format!("serialize: {e}"))?;
    write_private(&path, &bytes).map_err(|e| format!("write device-auth: {e}"))
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(bytes)?;
    file.sync_all()
}

pub fn hash_auth_key(auth_key: &[u8]) -> Result<String, String> {
    if auth_key.len() != 32 {
        return Err("auth_key must be 32 bytes".into());
    }
    let salt = SaltString::generate(&mut rand::thread_rng());
    // Modest params for a high-entropy 32-byte key (not a password).
    let params = Params::new(19_456, 2, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let hash = argon2
        .hash_password(auth_key, &salt)
        .map_err(|e| format!("argon2 hash: {e}"))?;
    Ok(hash.to_string())
}

pub fn verify_auth_key(auth_key: &[u8], verifier: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(verifier) else {
        return false;
    };
    Argon2::default().verify_password(auth_key, &parsed).is_ok()
}

pub fn decode_auth_key_b64(value: &str) -> Result<Vec<u8>, String> {
    let bytes = B64
        .decode(value.trim().as_bytes())
        .map_err(|_| "invalid auth_key encoding".to_string())?;
    if bytes.len() != 32 {
        return Err("auth_key must be 32 bytes".into());
    }
    Ok(bytes)
}

/// Constant-time equality for legacy bearer tokens (decoded bytes).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    bool::from(a.ct_eq(b))
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn hash_and_verify_roundtrip() {
        let key = [42u8; 32];
        let verifier = hash_auth_key(&key).unwrap();
        assert!(verify_auth_key(&key, &verifier));
        assert!(!verify_auth_key(&[0u8; 32], &verifier));
    }

    #[test]
    fn record_persists() {
        let dir = tempdir().unwrap();
        let record = DeviceAuthRecord {
            verifier: hash_auth_key(&[7u8; 32]).unwrap(),
            created_at_unix: 1,
        };
        save_record(dir.path(), &record).unwrap();
        let loaded = load_record(dir.path()).unwrap().unwrap();
        assert_eq!(loaded.verifier, record.verifier);
    }

    #[test]
    fn rate_limit_trips() {
        let limiter = AuthRateLimiter::default();
        for _ in 0..AUTH_RATE_LIMIT {
            assert!(limiter.check_and_record("1.2.3.4"));
        }
        assert!(!limiter.check_and_record("1.2.3.4"));
        assert!(limiter.check_and_record("9.9.9.9"));
    }
}
