//! Domain models for hosts, identities, projects, and secrets.

mod api_key;
mod auth;
mod host;
mod identity;
mod project;
mod shell_integration;
mod tunnel;

pub use api_key::{ApiKey, AssistProviderKind};
pub use auth::{AuthMaterial, SecretBytes, SecretString};
pub use host::{Host, KnownHostKey, PtySize};
pub use identity::{Identity, SecretRef};
pub use project::{
    AgentSpec, Project, ProjectLocation, RunningSession, builtin_agents, find_builtin_agent,
    mux_session_name,
};
pub use shell_integration::ShellIntegration;
pub use tunnel::{TunnelDefinition, TunnelDirection};
