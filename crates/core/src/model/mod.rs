//! Domain models for hosts, identities, and secrets.

mod auth;
mod host;
mod identity;
mod shell_integration;

pub use auth::{AuthMaterial, SecretBytes, SecretString};
pub use host::{Host, KnownHostKey, PtySize};
pub use identity::{Identity, SecretRef};
pub use shell_integration::ShellIntegration;
