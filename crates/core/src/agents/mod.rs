//! Coding-agent catalog (M11.2).

mod byok;
mod catalog;

pub use byok::{
    ByokEnvHandle, build_byok_env_map, cleanup_local_byok_path, prepare_byok_for_project,
    prepare_project_byok,
};
pub use catalog::{
    AgentInstallHints, AgentPreset, AgentPresetStatus, agent_preset_by_command, agent_preset_by_id,
    bundled_agent_presets, resolve_agent_for_launch,
};
