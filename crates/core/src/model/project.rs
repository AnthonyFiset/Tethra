//! Projects and agent launch specs (M8).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Where a project lives — local disk or a vault host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProjectLocation {
    Local { path: String },
    Remote { host_id: Uuid, path: String },
}

/// First-class project. Syncs through the vault like [`super::Host`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub location: ProjectLocation,
    /// Built-in or custom agent id (`AgentSpec.id`).
    pub default_agent: Option<String>,
    pub last_opened: Option<DateTime<Utc>>,
}

impl Project {
    pub fn local(name: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            id: Uuid::now_v7(),
            name: name.into(),
            location: ProjectLocation::Local { path: path.into() },
            default_agent: None,
            last_opened: None,
        }
    }

    pub fn remote(name: impl Into<String>, host_id: Uuid, path: impl Into<String>) -> Self {
        Self {
            id: Uuid::now_v7(),
            name: name.into(),
            location: ProjectLocation::Remote {
                host_id,
                path: path.into(),
            },
            default_agent: None,
            last_opened: None,
        }
    }
}

/// How to launch an agent CLI. Presets are data — no special-casing in code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSpec {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Wrap in tmux/zellij on remote hosts when true.
    pub persistent: bool,
}

/// Built-in agent presets shipped with the app.
pub fn builtin_agents() -> Vec<AgentSpec> {
    vec![
        AgentSpec {
            id: "claude-code".into(),
            name: "Claude Code".into(),
            command: "claude".into(),
            args: Vec::new(),
            env: Vec::new(),
            persistent: true,
        },
        AgentSpec {
            id: "codex".into(),
            name: "Codex CLI".into(),
            command: "codex".into(),
            args: Vec::new(),
            env: Vec::new(),
            persistent: true,
        },
        AgentSpec {
            id: "gemini".into(),
            name: "Gemini CLI".into(),
            command: "gemini".into(),
            args: Vec::new(),
            env: Vec::new(),
            persistent: true,
        },
        AgentSpec {
            id: "aider".into(),
            name: "aider".into(),
            command: "aider".into(),
            args: Vec::new(),
            env: Vec::new(),
            persistent: true,
        },
        AgentSpec {
            id: "shell".into(),
            name: "Shell only".into(),
            command: "".into(),
            args: Vec::new(),
            env: Vec::new(),
            persistent: false,
        },
    ]
}

pub fn find_builtin_agent(id: &str) -> Option<AgentSpec> {
    builtin_agents().into_iter().find(|agent| agent.id == id)
}

/// Stable tmux/zellij session name for a project (must match the UI launcher).
pub fn mux_session_name(project_id: Uuid) -> String {
    let cleaned: String = project_id
        .to_string()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    format!("tethra-{}", &cleaned[..cleaned.len().min(24)])
}

/// A persistent agent session advertised through vault sync for cross-device reattach.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningSession {
    pub id: Uuid,
    pub project_id: Uuid,
    pub host_id: Uuid,
    pub agent_id: Option<String>,
    pub mux_session: String,
    pub started_at: DateTime<Utc>,
    pub last_attached_at: DateTime<Utc>,
    pub started_on_device: String,
}

impl RunningSession {
    pub fn start(
        project_id: Uuid,
        host_id: Uuid,
        agent_id: Option<String>,
        started_on_device: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::now_v7(),
            project_id,
            host_id,
            agent_id,
            mux_session: mux_session_name(project_id),
            started_at: now,
            last_attached_at: now,
            started_on_device: started_on_device.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_unique() {
        let agents = builtin_agents();
        let mut ids: Vec<_> = agents.iter().map(|a| a.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), agents.len());
    }

    #[test]
    fn project_location_roundtrips() {
        let p = Project::remote("lab", Uuid::nil(), "/srv/app");
        let json = serde_json::to_string(&p).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "lab");
        match back.location {
            ProjectLocation::Remote { path, .. } => assert_eq!(path, "/srv/app"),
            _ => panic!("expected remote"),
        }
    }

    #[test]
    fn mux_session_name_is_stable() {
        let id = Uuid::nil();
        assert_eq!(mux_session_name(id), mux_session_name(id));
        assert!(mux_session_name(id).starts_with("tethra-"));
    }
}
