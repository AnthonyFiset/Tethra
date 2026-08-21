//! Assist IPC: vault API keys + propose/explain (M9).

use serde::{Deserialize, Serialize};
use ssh_client_core::assist::{self, AssistContext};
use ssh_client_core::model::{AssistProviderKind, SecretString};
use ssh_client_core::vault::{ApiKeySummary as CoreApiKeySummary, CreateApiKeyRequest};
use tauri::{AppHandle, State};
use ts_rs::TS;

use crate::{AppState, parse_uuid, redacted_error, sync};

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct ApiKeySummaryDto {
    id: String,
    label: String,
    provider: String,
    base_url: Option<String>,
    model: Option<String>,
    sync_secret: bool,
    has_key: bool,
}

impl From<&CoreApiKeySummary> for ApiKeySummaryDto {
    fn from(key: &CoreApiKeySummary) -> Self {
        Self {
            id: key.id.to_string(),
            label: key.label.clone(),
            provider: match key.provider {
                AssistProviderKind::Anthropic => "anthropic".into(),
                AssistProviderKind::OpenAi => "openai".into(),
                AssistProviderKind::OpenAiCompat => "openaiCompat".into(),
            },
            base_url: key.base_url.clone(),
            model: key.model.clone(),
            sync_secret: key.sync_secret,
            has_key: key.has_key,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyMutation {
    label: String,
    provider: String,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    #[serde(default)]
    sync_secret: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistContextDto {
    cwd: Option<String>,
    host_label: String,
    is_local: bool,
    transcript_tail: String,
    last_exit_code: Option<i32>,
}

impl From<AssistContextDto> for AssistContext {
    fn from(value: AssistContextDto) -> Self {
        Self {
            cwd: value.cwd,
            host_label: value.host_label,
            is_local: value.is_local,
            transcript_tail: value.transcript_tail,
            last_exit_code: value.last_exit_code,
        }
    }
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct AssistProposeResultDto {
    command: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct AssistExplainResultDto {
    text: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct ProviderPresetDto {
    id: String,
    display_name: String,
    /// `anthropic` | `openai` | `openaiCompat`
    transport: String,
    base_url: String,
    base_url_hint: Option<String>,
    models_endpoint: Option<String>,
    api_key_url: Option<String>,
    key_prefix_hint: Option<String>,
    requires_key: bool,
    default_model: Option<String>,
    /// `bearer` | `api-key`
    auth_header: String,
}

impl From<&assist::ProviderPreset> for ProviderPresetDto {
    fn from(preset: &assist::ProviderPreset) -> Self {
        Self {
            id: preset.id.clone(),
            display_name: preset.display_name.clone(),
            transport: preset.transport.as_str().into(),
            base_url: preset.base_url.clone(),
            base_url_hint: preset.base_url_hint.clone(),
            models_endpoint: preset.models_endpoint.clone(),
            api_key_url: preset.api_key_url.clone(),
            key_prefix_hint: preset.key_prefix_hint.clone(),
            requires_key: preset.requires_key,
            default_model: preset.default_model.clone(),
            auth_header: match preset.auth_header {
                assist::AuthHeaderKind::Bearer => "bearer".into(),
                assist::AuthHeaderKind::ApiKey => "api-key".into(),
            },
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderMutation {
    provider: String,
    base_url: Option<String>,
    api_key: Option<String>,
    preset_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct TestProviderResultDto {
    ok: bool,
    models: Vec<String>,
    error: Option<String>,
}

fn parse_provider(value: &str) -> Result<AssistProviderKind, String> {
    match value {
        "anthropic" => Ok(AssistProviderKind::Anthropic),
        "openai" => Ok(AssistProviderKind::OpenAi),
        "openaiCompat" => Ok(AssistProviderKind::OpenAiCompat),
        other => Err(format!("unknown assist provider: {other}")),
    }
}

#[tauri::command]
pub async fn list_assist_presets() -> Result<Vec<ProviderPresetDto>, String> {
    let presets = assist::bundled_presets().map_err(redacted_error)?;
    Ok(presets.iter().map(ProviderPresetDto::from).collect())
}

#[tauri::command]
pub async fn assist_test_provider(
    request: TestProviderMutation,
) -> Result<TestProviderResultDto, String> {
    let result = assist::test_provider(assist::TestProviderRequest {
        provider: parse_provider(&request.provider)?,
        base_url: request.base_url,
        api_key: request.api_key,
        preset_id: request.preset_id,
    })
    .await;
    Ok(TestProviderResultDto {
        ok: result.ok,
        models: result.models,
        error: result.error,
    })
}

#[tauri::command]
pub async fn list_api_keys(state: State<'_, AppState>) -> Result<Vec<ApiKeySummaryDto>, String> {
    let keys = state.repo.list_api_keys().await.map_err(redacted_error)?;
    Ok(keys.iter().map(ApiKeySummaryDto::from).collect())
}

#[tauri::command]
pub async fn create_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    key: ApiKeyMutation,
) -> Result<ApiKeySummaryDto, String> {
    let created = state
        .repo
        .create_api_key(CreateApiKeyRequest {
            label: key.label,
            provider: parse_provider(&key.provider)?,
            base_url: key.base_url,
            model: key.model,
            api_key: key.api_key.map(SecretString::new),
            sync_secret: key.sync_secret.unwrap_or(false),
        })
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(ApiKeySummaryDto::from(&created))
}

#[tauri::command]
pub async fn update_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    key: ApiKeyMutation,
) -> Result<ApiKeySummaryDto, String> {
    let key_id = parse_uuid(&id, "api key")?;
    let updated = state
        .repo
        .update_api_key(
            key_id,
            CreateApiKeyRequest {
                label: key.label,
                provider: parse_provider(&key.provider)?,
                base_url: key.base_url,
                model: key.model,
                api_key: key.api_key.filter(|s| !s.is_empty()).map(SecretString::new),
                sync_secret: key.sync_secret.unwrap_or(false),
            },
        )
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(ApiKeySummaryDto::from(&updated))
}

#[tauri::command]
pub async fn delete_api_key(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let key_id = parse_uuid(&id, "api key")?;
    state
        .repo
        .delete_api_key(key_id)
        .await
        .map_err(redacted_error)?;
    sync::schedule_background_sync(app, &state);
    Ok(())
}

#[tauri::command]
pub async fn assist_propose(
    state: State<'_, AppState>,
    api_key_id: String,
    prompt: String,
    context: AssistContextDto,
) -> Result<AssistProposeResultDto, String> {
    if prompt.trim().is_empty() {
        return Err("prompt is required".into());
    }
    let key_id = parse_uuid(&api_key_id, "api key")?;
    let key = state
        .repo
        .get_api_key(key_id)
        .await
        .map_err(redacted_error)?;
    let provider = assist::provider_from_api_key(&key).map_err(redacted_error)?;
    let command = assist::propose_command(
        provider.as_ref(),
        state.approval_gate.as_ref(),
        &AssistContext::from(context),
        prompt.trim(),
    )
    .await
    .map_err(redacted_error)?;
    Ok(AssistProposeResultDto { command })
}

#[tauri::command]
pub async fn assist_explain(
    state: State<'_, AppState>,
    api_key_id: String,
    prompt: String,
    context: AssistContextDto,
) -> Result<AssistExplainResultDto, String> {
    if prompt.trim().is_empty() {
        return Err("prompt is required".into());
    }
    let key_id = parse_uuid(&api_key_id, "api key")?;
    let key = state
        .repo
        .get_api_key(key_id)
        .await
        .map_err(redacted_error)?;
    let provider = assist::provider_from_api_key(&key).map_err(redacted_error)?;
    let text = assist::explain(
        provider.as_ref(),
        &AssistContext::from(context),
        prompt.trim(),
    )
    .await
    .map_err(redacted_error)?;
    Ok(AssistExplainResultDto { text })
}

#[allow(dead_code)]
pub fn export_bindings(cfg: &ts_rs::Config) {
    ApiKeySummaryDto::export_all(cfg).unwrap();
    AssistProposeResultDto::export_all(cfg).unwrap();
    AssistExplainResultDto::export_all(cfg).unwrap();
    ProviderPresetDto::export_all(cfg).unwrap();
    TestProviderResultDto::export_all(cfg).unwrap();
}
