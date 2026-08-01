//! Portable SSH/SFTP client core.
//!
//! Hard rules (see PROJECT.md):
//! - Never depend on Tauri
//! - No platform APIs — use `platform` traits
//! - `#![forbid(unsafe_code)]`
//! - Every public function returns [`Result`]

#![forbid(unsafe_code)]

pub mod error;
pub mod model;
pub mod ssh;
pub mod ssh_config;
pub mod sync;
pub mod terminal;
pub mod vault;

pub use error::{Error, Result};
