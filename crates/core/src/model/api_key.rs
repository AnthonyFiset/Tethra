//! Vault-stored Assist API keys (M9).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::SecretString;

/// Which HTTP Assist backend to call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssistProviderKind {
    Anthropic,
    OpenAi,
    OpenAiCompat,
}

impl AssistProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::OpenAiCompat => "openaiCompat",
        }
    }
}

/// Encrypted Assist credential. The raw key never leaves Rust except via provider HTTP.
#[derive(Debug, Clone)]
pub struct ApiKey {
    pub id: Uuid,
    pub label: String,
    pub provider: AssistProviderKind,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_key: SecretString,
    pub sync_secret: bool,
}

impl ApiKey {
    pub fn new(
        label: impl Into<String>,
        provider: AssistProviderKind,
        api_key: SecretString,
    ) -> Self {
        Self {
            id: Uuid::now_v7(),
            label: label.into(),
            provider,
            base_url: None,
            model: None,
            api_key,
            sync_secret: false,
        }
    }
}
