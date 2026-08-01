//! Bundled Assist provider presets (M11.1). Data, not compiled special cases.

use serde::{Deserialize, Serialize};

use crate::model::AssistProviderKind;
use crate::{Error, Result};

const BUNDLED_JSON: &str = include_str!("../../data/assist_providers.json");

/// Catalog entry describing how to talk to a model endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderPreset {
    pub id: String,
    pub display_name: String,
    pub transport: AssistProviderKind,
    pub base_url: String,
    pub models_endpoint: Option<String>,
    pub api_key_url: Option<String>,
    pub key_prefix_hint: Option<String>,
    pub requires_key: bool,
    pub default_model: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

/// Parse the bundled snapshot. Used at process start and in tests.
pub fn bundled_presets() -> Result<Vec<ProviderPreset>> {
    serde_json::from_str(BUNDLED_JSON)
        .map_err(|err| Error::Other(format!("assist provider catalog: {err}")))
}

/// Look up a preset by id.
pub fn preset_by_id(id: &str) -> Result<Option<ProviderPreset>> {
    Ok(bundled_presets()?.into_iter().find(|p| p.id == id))
}

/// Headers to attach for a known base URL (OpenRouter, etc.).
pub fn headers_for_base_url(base_url: &str) -> Vec<(String, String)> {
    let normalized = base_url.trim().trim_end_matches('/');
    bundled_presets()
        .ok()
        .into_iter()
        .flatten()
        .find(|p| {
            let preset = p.base_url.trim().trim_end_matches('/');
            !preset.is_empty() && preset == normalized
        })
        .map(|p| p.headers)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_catalog_parses_and_includes_openrouter() {
        let presets = bundled_presets().expect("catalog parses");
        assert!(presets.len() >= 10);
        let openrouter = presets.iter().find(|p| p.id == "openrouter").unwrap();
        assert!(openrouter.requires_key);
        assert!(!openrouter.headers.is_empty());
        let ollama = presets.iter().find(|p| p.id == "ollama").unwrap();
        assert!(!ollama.requires_key);
    }
}
