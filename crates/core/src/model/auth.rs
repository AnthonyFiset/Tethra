//! Zeroizing secret wrappers used at authentication boundaries.

use zeroize::{Zeroize, ZeroizeOnDrop};

/// UTF-8 secret that zeroizes on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretString {
    inner: String,
}

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            inner: value.into(),
        }
    }

    pub fn expose(&self) -> &str {
        &self.inner
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretString([REDACTED])")
    }
}

/// Binary secret that zeroizes on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretBytes {
    inner: Vec<u8>,
}

impl SecretBytes {
    pub fn new(value: impl Into<Vec<u8>>) -> Self {
        Self {
            inner: value.into(),
        }
    }

    pub fn expose(&self) -> &[u8] {
        &self.inner
    }
}

impl std::fmt::Debug for SecretBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBytes([REDACTED])")
    }
}

/// Material used to authenticate an SSH session.
///
/// Never log or serialize this type. Never cross the JS IPC boundary.
#[derive(Zeroize, ZeroizeOnDrop)]
pub enum AuthMaterial {
    Password {
        password: SecretString,
    },
    PrivateKey {
        /// PEM / OpenSSH private key bytes.
        key: SecretBytes,
        passphrase: Option<SecretString>,
    },
}

impl std::fmt::Debug for AuthMaterial {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password { .. } => f.write_str("AuthMaterial::Password([REDACTED])"),
            Self::PrivateKey {
                passphrase: Some(_),
                ..
            } => f.write_str(
                "AuthMaterial::PrivateKey { key: [REDACTED], passphrase: Some([REDACTED]) }",
            ),
            Self::PrivateKey {
                passphrase: None, ..
            } => f.write_str("AuthMaterial::PrivateKey { key: [REDACTED], passphrase: None }"),
        }
    }
}
