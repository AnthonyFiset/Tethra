//! Bundled Assist provider presets (M11.1). Data, not compiled special cases.

use serde::{Deserialize, Serialize};

use crate::model::AssistProviderKind;
use crate::{Error, Result};

const BUNDLED_JSON: &str = include_str!("../../data/assist_providers.json");

/// How the HTTP client authenticates (`Authorization: Bearer` vs raw header).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AuthHeaderKind {
    #[default]
    Bearer,
    #[serde(rename = "api-key")]
    ApiKey,
}

/// Catalog entry describing how to talk to a model endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderPreset {
    pub id: String,
    pub display_name: String,
    pub transport: AssistProviderKind,
    pub base_url: String,
    /// Placeholder shown when `base_url` is empty (e.g. Azure resource URL).
    #[serde(default)]
    pub base_url_hint: Option<String>,
    pub models_endpoint: Option<String>,
    pub api_key_url: Option<String>,
    pub key_prefix_hint: Option<String>,
    pub requires_key: bool,
    pub default_model: Option<String>,
    /// OpenAI-compat auth scheme. Azure uses `api-key`; everyone else Bearer.
    #[serde(default)]
    pub auth_header: AuthHeaderKind,
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
    matching_preset(base_url)
        .map(|p| p.headers)
        .unwrap_or_default()
}

/// Auth scheme for a base URL — Azure hosts use `api-key`, others Bearer.
pub fn auth_for_base_url(base_url: &str) -> AuthHeaderKind {
    if let Some(preset) = matching_preset(base_url) {
        return preset.auth_header;
    }
    // Saved Azure keys have per-resource URLs that never match a fixed preset.
    if base_url.to_ascii_lowercase().contains("openai.azure.com") {
        AuthHeaderKind::ApiKey
    } else {
        AuthHeaderKind::Bearer
    }
}

fn matching_preset(base_url: &str) -> Option<ProviderPreset> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return None;
    }
    bundled_presets().ok()?.into_iter().find(|p| {
        let preset = p.base_url.trim().trim_end_matches('/');
        !preset.is_empty() && preset.eq_ignore_ascii_case(normalized)
    })
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

    #[test]
    fn azure_openai_uses_api_key_auth() {
        let azure = preset_by_id("azure-openai")
            .unwrap()
            .expect("azure-openai preset");
        assert_eq!(azure.auth_header, AuthHeaderKind::ApiKey);
        assert_eq!(azure.transport, AssistProviderKind::OpenAiCompat);
        assert!(azure.base_url.is_empty());
        assert!(
            azure
                .base_url_hint
                .as_deref()
                .unwrap_or("")
                .contains("openai.azure.com")
        );
        assert_eq!(
            auth_for_base_url("https://myres.openai.azure.com/openai/v1"),
            AuthHeaderKind::ApiKey
        );
    }
}
