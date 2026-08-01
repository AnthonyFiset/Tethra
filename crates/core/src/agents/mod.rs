//! Coding-agent catalog (M11.2).

mod catalog;

pub use catalog::{
    AgentInstallHints, AgentPreset, AgentPresetStatus, agent_preset_by_command, agent_preset_by_id,
    bundled_agent_presets, resolve_agent_for_launch,
};
