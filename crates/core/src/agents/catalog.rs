//! Bundled coding-agent presets (M11.2). Data, not compiled special cases.

use serde::{Deserialize, Serialize};

use crate::model::AgentSpec;
use crate::{Error, Result};

const BUNDLED_JSON: &str = include_str!("../../data/agents.json");

/// Platform-specific install command strings.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentInstallHints {
    pub macos: Option<String>,
    pub linux: Option<String>,
    pub windows: Option<String>,
    pub default: Option<String>,
}

impl AgentInstallHints {
    /// Prefer an OS-specific command, then `default`.
    pub fn for_platform(&self, platform: &str) -> Option<&str> {
        let specific = match platform {
            "macos" => self.macos.as_deref(),
            "linux" => self.linux.as_deref(),
            "windows" => self.windows.as_deref(),
            _ => None,
        };
        specific.or(self.default.as_deref())
    }
}

/// Active vs deprecated (with migration successor).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentPresetStatus {
    Active,
    Deprecated { successor: String },
}

impl AgentPresetStatus {
    pub fn successor(&self) -> Option<&str> {
        match self {
            Self::Active => None,
            Self::Deprecated { successor } => Some(successor.as_str()),
        }
    }

    pub fn is_deprecated(&self) -> bool {
        matches!(self, Self::Deprecated { .. })
    }
}

/// Catalog entry describing how to detect / install / launch an agent CLI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPreset {
    pub id: String,
    pub display_name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub install: AgentInstallHints,
    #[serde(default)]
    pub detect_args: Vec<String>,
    pub persistent_default: bool,
    #[serde(default)]
    pub byok_env: Vec<String>,
    #[serde(default)]
    pub supports_openai_compat: bool,
    pub docs_url: Option<String>,
    pub status: AgentPresetStatus,
}

impl AgentPreset {
    pub fn to_agent_spec(&self) -> AgentSpec {
        AgentSpec {
            id: self.id.clone(),
            name: self.display_name.clone(),
            command: self.command.clone(),
            args: self.args.clone(),
            env: Vec::new(),
            persistent: self.persistent_default,
        }
    }
}

/// Parse the bundled snapshot.
pub fn bundled_agent_presets() -> Result<Vec<AgentPreset>> {
    serde_json::from_str(BUNDLED_JSON).map_err(|err| Error::Other(format!("agent catalog: {err}")))
}

/// Look up a preset by id.
pub fn agent_preset_by_id(id: &str) -> Result<Option<AgentPreset>> {
    Ok(bundled_agent_presets()?.into_iter().find(|p| p.id == id))
}

/// Find a preset whose launch `command` matches (for probe/install).
pub fn agent_preset_by_command(command: &str) -> Result<Option<AgentPreset>> {
    if command.trim().is_empty() {
        return Ok(None);
    }
    Ok(bundled_agent_presets()?
        .into_iter()
        .find(|p| p.command == command))
}

/// Resolve an agent id for launch. Follows deprecated successors.
///
/// Returns `(spec, migration_from)` where `migration_from` is set when the
/// requested id was deprecated and a successor was used instead.
pub fn resolve_agent_for_launch(id: &str) -> Result<Option<(AgentSpec, Option<String>)>> {
    let Some(preset) = agent_preset_by_id(id)? else {
        return Ok(None);
    };
    match &preset.status {
        AgentPresetStatus::Active => Ok(Some((preset.to_agent_spec(), None))),
        AgentPresetStatus::Deprecated { successor } => {
            let Some(next) = agent_preset_by_id(successor)? else {
                // Successor missing — fall back to the deprecated entry itself.
                return Ok(Some((preset.to_agent_spec(), None)));
            };
            Ok(Some((
                next.to_agent_spec(),
                Some(preset.display_name.clone()),
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_parses_and_marks_gemini_deprecated() {
        let presets = bundled_agent_presets().expect("catalog parses");
        assert!(presets.iter().any(|p| p.id == "claude-code"));
        assert!(presets.iter().any(|p| p.id == "shell"));
        assert!(presets.iter().any(|p| p.id == "antigravity"));
        let gemini = presets.iter().find(|p| p.id == "gemini").unwrap();
        assert_eq!(gemini.status.successor(), Some("antigravity"));
    }

    #[test]
    fn resolve_follows_gemini_successor() {
        let (spec, from) = resolve_agent_for_launch("gemini")
            .unwrap()
            .expect("gemini resolves");
        assert_eq!(spec.id, "antigravity");
        assert_eq!(spec.command, "agy");
        assert_eq!(from.as_deref(), Some("Gemini CLI"));
    }

    #[test]
    fn install_hints_prefer_platform() {
        let aider = agent_preset_by_id("aider").unwrap().unwrap();
        assert_eq!(
            aider.install.for_platform("macos"),
            Some("brew install aider")
        );
        assert_eq!(
            aider.install.for_platform("linux"),
            Some("pipx install aider-chat")
        );
    }

    #[test]
    fn claude_and_codex_use_native_installers() {
        let claude = agent_preset_by_id("claude-code").unwrap().unwrap();
        assert!(
            claude
                .install
                .for_platform("linux")
                .unwrap()
                .contains("claude.ai/install.sh")
        );
        assert!(
            claude
                .install
                .for_platform("windows")
                .unwrap()
                .contains("claude.ai/install.ps1")
        );
        let codex = agent_preset_by_id("codex").unwrap().unwrap();
        assert!(
            codex
                .install
                .for_platform("macos")
                .unwrap()
                .contains("chatgpt.com/codex/install.sh")
        );
    }

    #[test]
    fn antigravity_install_uses_official_script() {
        let agy = agent_preset_by_id("antigravity").unwrap().unwrap();
        assert!(
            agy.install
                .for_platform("macos")
                .unwrap()
                .contains("antigravity.google/cli/install.sh")
        );
        assert!(
            agy.install
                .for_platform("windows")
                .unwrap()
                .contains("antigravity.google/cli/install.ps1")
        );
    }
}
