//! Host key fingerprint helpers.

use base64::Engine;
use sha2::{Digest, Sha256};

use crate::model::KnownHostKey;

/// Public key as presented by the server during handshake.
#[derive(Debug, Clone)]
pub struct PresentedHostKey {
    pub algorithm: String,
    pub fingerprint_sha256: String,
    pub openssh: String,
}

impl PresentedHostKey {
    pub fn to_known(&self) -> KnownHostKey {
        KnownHostKey {
            algorithm: self.algorithm.clone(),
            fingerprint_sha256: self.fingerprint_sha256.clone(),
            openssh: self.openssh.clone(),
        }
    }
}

/// SHA-256 fingerprint of raw public key bytes, base64 unpadded (OpenSSH style).
pub fn fingerprint_sha256(key_bytes: &[u8]) -> String {
    let digest = Sha256::digest(key_bytes);
    base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest)
}

pub fn presented_from_public_key(key: &russh::keys::PublicKey) -> PresentedHostKey {
    let algorithm = key.algorithm().to_string();
    let wire = key
        .to_bytes()
        .unwrap_or_else(|_| key.to_openssh().unwrap_or_default().into_bytes());
    let openssh = key.to_openssh().unwrap_or_else(|_| {
        format!(
            "{algorithm} {}",
            base64::engine::general_purpose::STANDARD.encode(&wire)
        )
    });
    let fingerprint_sha256 = fingerprint_sha256(&wire);
    PresentedHostKey {
        algorithm,
        fingerprint_sha256,
        openssh,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable() {
        let a = fingerprint_sha256(b"hello");
        let b = fingerprint_sha256(b"hello");
        assert_eq!(a, b);
        assert_ne!(fingerprint_sha256(b"hello"), fingerprint_sha256(b"world"));
    }
}
