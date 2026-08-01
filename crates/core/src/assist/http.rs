//! HTTP Assist providers (Anthropic, OpenAI, OpenAI-compatible).

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{AssistProvider, default_model};
use crate::model::{ApiKey, AssistProviderKind};
use crate::{Error, Result};

pub fn provider_from_api_key(key: &ApiKey) -> Result<Box<dyn AssistProvider>> {
    let api_key = key.api_key.expose().to_string();
    if api_key.trim().is_empty() {
        return Err(Error::InvalidArgument("api key is empty".into()));
    }
    let model = key
        .model
        .clone()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| default_model(key.provider).to_string());
    Ok(match key.provider {
        AssistProviderKind::Anthropic => Box::new(AnthropicProvider {
            api_key,
            model,
            base_url: key
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.anthropic.com".into()),
        }),
        AssistProviderKind::OpenAi => Box::new(OpenAiCompatProvider {
            api_key,
            model,
            base_url: key
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".into()),
        }),
        AssistProviderKind::OpenAiCompat => {
            let base_url = key
                .base_url
                .clone()
                .filter(|u| !u.trim().is_empty())
                .ok_or_else(|| {
                    Error::InvalidArgument("base URL is required for OpenAI-compatible".into())
                })?;
            Box::new(OpenAiCompatProvider {
                api_key,
                model,
                base_url: base_url.trim_end_matches('/').to_string(),
            })
        }
    })
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
}

#[async_trait]
impl AssistProvider for AnthropicProvider {
    async fn complete(&self, system: &str, user: &str) -> Result<String> {
        let url = format!(
            "{}/v1/messages",
            self.base_url.trim_end_matches('/')
        );
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
        let response = client
            .post(url)
            .bearer_auth(&self.api_key)
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
