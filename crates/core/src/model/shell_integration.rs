//! Shell integration preference for hosts.
//!
//! Kept in `model` (not `terminal`) so vault records can round-trip without
//! depending on the stream parser.

use serde::{Deserialize, Serialize};

/// Per-host preference for semantic prompt / cwd reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellIntegration {
    /// Inject via wrapper on connect (default).
    #[default]
    Auto,
    /// Plain stream; never ask again for this host.
    Disabled,
}
