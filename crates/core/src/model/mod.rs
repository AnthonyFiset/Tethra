//! Domain models for hosts, identities, projects, and secrets.

mod auth;
mod host;
mod identity;
mod project;
mod shell_integration;

pub use auth::{AuthMaterial, SecretBytes, SecretString};
pub use host::{Host, KnownHostKey, PtySize};
pub use identity::{Identity, SecretRef};
pub use project::{
    AgentSpec, Project, ProjectLocation, RunningSession, builtin_agents, find_builtin_agent,
    mux_session_name,
};
pub use shell_integration::ShellIntegration;
