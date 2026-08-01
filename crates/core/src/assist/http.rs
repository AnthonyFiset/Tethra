//! HTTP Assist providers (Anthropic, OpenAI, OpenAI-compatible).

use async_trait::async_trait;
use serde_json::{Value, json};

use super::catalog::{self, ProviderPreset};
use super::{AssistProvider, default_model};
use crate::model::{ApiKey, AssistProviderKind};
use crate::{Error, Result};

pub fn provider_from_api_key(key: &ApiKey) -> Result<Box<dyn AssistProvider>> {
    let api_key = key.api_key.expose().to_string();
    let model = key
        .model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| default_model(key.provider).to_string());
    Ok(match key.provider {
        AssistProviderKind::Anthropic => {
            if api_key.trim().is_empty() {
                return Err(Error::InvalidArgument("api key is empty".into()));
            }
            Box::new(AnthropicProvider {
                api_key,
                model,
                base_url: key
                    .base_url
                    .clone()
                    .unwrap_or_else(|| "https://api.anthropic.com".into()),
            })
        }
        AssistProviderKind::OpenAi => {
            if api_key.trim().is_empty() {
                return Err(Error::InvalidArgument("api key is empty".into()));
            }
            let base_url = key
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".into());
            let headers = catalog::headers_for_base_url(&base_url);
            Box::new(OpenAiCompatProvider {
                api_key,
                model,
                base_url,
                headers,
            })
        }
        AssistProviderKind::OpenAiCompat => {
            let base_url = key
                .base_url
                .clone()
                .filter(|u| !u.trim().is_empty())
                .ok_or_else(|| {
                    Error::InvalidArgument("base URL is required for OpenAI-compatible".into())
                })?;
            let base_url = base_url.trim_end_matches('/').to_string();
            let headers = catalog::headers_for_base_url(&base_url);
            Box::new(OpenAiCompatProvider {
                api_key,
                model,
                base_url,
                headers,
            })
        }
    })
}

/// Probe a provider: `GET …/models` (or Anthropic equivalent).
#[derive(Debug, Clone)]
pub struct TestProviderRequest {
    pub provider: AssistProviderKind,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub preset_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TestProviderResult {
    pub ok: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

pub async fn test_provider(request: TestProviderRequest) -> TestProviderResult {
    match test_provider_inner(request).await {
        Ok(models) => TestProviderResult {
            ok: true,
            models,
            error: None,
        },
        Err(err) => TestProviderResult {
            ok: false,
            models: Vec::new(),
            error: Some(err.to_string()),
        },
    }
}

async fn test_provider_inner(request: TestProviderRequest) -> Result<Vec<String>> {
    let preset = match request.preset_id.as_deref() {
        Some(id) => catalog::preset_by_id(id)?,
        None => None,
    };
    let requires_key = preset.as_ref().map(|p| p.requires_key).unwrap_or(true);
    let api_key = request.api_key.as_deref().unwrap_or("").trim().to_string();
    if requires_key && api_key.is_empty() {
        return Err(Error::InvalidArgument("api key is required".into()));
    }

    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(|u| u.trim_end_matches('/').to_string())
        .or_else(|| {
            preset
                .as_ref()
                .map(|p| p.base_url.trim().trim_end_matches('/').to_string())
                .filter(|u| !u.is_empty())
        })
        .ok_or_else(|| Error::InvalidArgument("base URL is required".into()))?;

    let headers = preset
        .as_ref()
        .map(|p| p.headers.clone())
        .unwrap_or_else(|| catalog::headers_for_base_url(&base_url));

    let endpoint = preset
        .as_ref()
        .and_then(|p| p.models_endpoint.clone())
        .unwrap_or_else(|| match request.provider {
            AssistProviderKind::Anthropic => "/v1/models".into(),
            AssistProviderKind::OpenAi | AssistProviderKind::OpenAiCompat => "/models".into(),
        });

    let url = join_url(&base_url, &endpoint);
    let client = reqwest::Client::new();
    let mut builder = client.get(&url);
    match request.provider {
        AssistProviderKind::Anthropic => {
            builder = builder
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01");
        }
        AssistProviderKind::OpenAi | AssistProviderKind::OpenAiCompat => {
            if !api_key.is_empty() {
                builder = builder.bearer_auth(&api_key);
            }
            for (name, value) in &headers {
                builder = builder.header(name, value);
            }
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|err| Error::Other(format!("assist test failed: {err}")))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|err| Error::Other(format!("assist test decode failed: {err}")))?;
    if !status.is_success() {
        let message = value
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| value.pointer("/error").and_then(|v| v.as_str()))
            .unwrap_or("provider error");
        return Err(Error::Other(format!("assist HTTP {status}: {message}")));
    }

    let mut models = extract_model_ids(&value);
    models.sort();
    models.dedup();
    if models.is_empty()
        && let Some(ProviderPreset {
            default_model: Some(model),
            ..
        }) = preset
    {
        models.push(model);
    }
    Ok(models)
}

fn join_url(base: &str, endpoint: &str) -> String {
    let base = base.trim_end_matches('/');
    if endpoint.starts_with('/') {
        format!("{base}{endpoint}")
    } else {
        format!("{base}/{endpoint}")
    }
}

fn extract_model_ids(value: &Value) -> Vec<String> {
    // OpenAI / OpenRouter / Ollama OpenAI-compat: { "data": [ { "id": "…" } ] }
    if let Some(data) = value.get("data").and_then(|v| v.as_array()) {
        return data
            .iter()
            .filter_map(|entry| {
                entry
                    .get("id")
                    .or_else(|| entry.get("name"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect();
    }
    // Anthropic: { "data": [ { "id": "…" } ] } same shape when present.
    Vec::new()
}

struct AnthropicProvider {
    api_key: String,
    model: String,
    base_url: String,
}

struct OpenAiCompatProvider {
    api_key: String,
    model: String,
    base_url: String,
    headers: Vec<(String, String)>,
}

#[async_trait]
impl AssistProvider for AnthropicProvider {
    async fn complete(&self, system: &str, user: &str) -> Result<String> {
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.model,
            "max_tokens": 512,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });
        let client = reqwest::Client::new();
        let response = client
            .post(url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|err| Error::Other(format!("assist request failed: {err}")))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|err| Error::Other(format!("assist response decode failed: {err}")))?;
        if !status.is_success() {
            let message = value
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .unwrap_or("assist provider error");
            return Err(Error::Other(format!("assist HTTP {status}: {message}")));
        }
        extract_anthropic_text(&value)
            .ok_or_else(|| Error::Other("assist response missing text".into()))
    }
}

#[async_trait]
impl AssistProvider for OpenAiCompatProvider {
    async fn complete(&self, system: &str, user: &str) -> Result<String> {
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.model,
            "temperature": 0,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
        });
        let client = reqwest::Client::new();
        let mut builder = client
            .post(url)
            .header("content-type", "application/json")
            .json(&body);
        if !self.api_key.trim().is_empty() {
            builder = builder.bearer_auth(&self.api_key);
        }
        for (name, value) in &self.headers {
            builder = builder.header(name, value);
        }
        let response = builder
            .send()
            .await
            .map_err(|err| Error::Other(format!("assist request failed: {err}")))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|err| Error::Other(format!("assist response decode failed: {err}")))?;
        if !status.is_success() {
            let message = value
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .unwrap_or("assist provider error");
            return Err(Error::Other(format!("assist HTTP {status}: {message}")));
        }
        extract_openai_text(&value)
            .ok_or_else(|| Error::Other("assist response missing text".into()))
    }
}

fn extract_anthropic_text(value: &Value) -> Option<String> {
    let blocks = value.get("content")?.as_array()?;
    let mut out = String::new();
    for block in blocks {
        if block.get("type").and_then(|t| t.as_str()) == Some("text")
            && let Some(text) = block.get("text").and_then(|t| t.as_str())
        {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(text);
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

fn extract_openai_text(value: &Value) -> Option<String> {
    value
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
