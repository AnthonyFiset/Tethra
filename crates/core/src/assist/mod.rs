//! Assist: NL → shell command (or explain), never auto-execute (M9).

#[cfg(feature = "sync-http")]
mod http;
mod prompt;

use async_trait::async_trait;

use crate::model::{ApiKey, AssistProviderKind};
use crate::ssh::{Action, ApprovalGate};
use crate::{Error, Result};

pub use prompt::{strip_command_fences, system_explain, system_propose};

/// Session context sent with an Assist request.
#[derive(Debug, Clone, Default)]
pub struct AssistContext {
    pub cwd: Option<String>,
    pub host_label: String,
    pub is_local: bool,
    pub transcript_tail: String,
    pub last_exit_code: Option<i32>,
}

/// Pluggable model backend.
#[async_trait]
pub trait AssistProvider: Send + Sync {
    async fn complete(&self, system: &str, user: &str) -> Result<String>;
}

/// Run propose through the approval gate, then return a single command string.
pub async fn propose_command(
    provider: &dyn AssistProvider,
    gate: &dyn ApprovalGate,
    ctx: &AssistContext,
    user_prompt: &str,
) -> Result<String> {
    let user = build_user_message(ctx, user_prompt, false);
    let raw = provider.complete(system_propose(), &user).await?;
    let command = strip_command_fences(&raw);
    if command.is_empty() {
        return Err(Error::InvalidArgument(
            "model returned an empty command".into(),
        ));
    }
    gate.approve(&Action::AssistInsert {
        command: command.clone(),
    })
    .await?;
    Ok(command)
}

/// Explain failure / output using the same context; no ApprovalGate (not executed).
pub async fn explain(
    provider: &dyn AssistProvider,
    ctx: &AssistContext,
    user_prompt: &str,
) -> Result<String> {
    let user = build_user_message(ctx, user_prompt, true);
    let text = provider.complete(system_explain(), &user).await?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(Error::InvalidArgument(
            "model returned an empty explanation".into(),
        ));
    }
    Ok(trimmed)
}

fn build_user_message(ctx: &AssistContext, prompt: &str, explain_mode: bool) -> String {
    let location = if ctx.is_local { "local" } else { "remote" };
    let mut parts = vec![
        format!("Host: {} ({location})", ctx.host_label),
        format!("CWD: {}", ctx.cwd.as_deref().unwrap_or("(unknown)")),
    ];
    if let Some(code) = ctx.last_exit_code {
        parts.push(format!("Last exit code: {code}"));
    }
    if !ctx.transcript_tail.trim().is_empty() {
        parts.push(format!(
            "Recent terminal output:\n```\n{}\n```",
            ctx.transcript_tail.trim()
        ));
    }
    let task = if explain_mode {
        format!("Explain / help with:\n{prompt}")
    } else {
        format!("User request:\n{prompt}")
    };
    parts.push(task);
    parts.join("\n\n")
}

/// Build an HTTP provider from a vault API key.
#[cfg(feature = "sync-http")]
pub fn provider_from_api_key(key: &ApiKey) -> Result<Box<dyn AssistProvider>> {
    http::provider_from_api_key(key)
}

#[cfg(not(feature = "sync-http"))]
pub fn provider_from_api_key(_key: &ApiKey) -> Result<Box<dyn AssistProvider>> {
    Err(Error::InvalidArgument(
        "Assist HTTP requires the sync-http feature".into(),
    ))
}

pub fn default_model(provider: AssistProviderKind) -> &'static str {
    match provider {
        AssistProviderKind::Anthropic => "claude-sonnet-4-5",
        AssistProviderKind::OpenAi | AssistProviderKind::OpenAiCompat => "gpt-4.1-mini",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::AlwaysApprove;

    #[tokio::test]
    async fn propose_strips_and_approves() {
        struct FenceProvider;
        #[async_trait]
        impl AssistProvider for FenceProvider {
            async fn complete(&self, _system: &str, _user: &str) -> Result<String> {
                Ok("```bash\nls -la\n```".into())
            }
        }
        let cmd = propose_command(
            &FenceProvider,
            &AlwaysApprove,
            &AssistContext {
                host_label: "local".into(),
                is_local: true,
                ..Default::default()
            },
            "list files",
        )
        .await
        .unwrap();
        assert_eq!(cmd, "ls -la");
    }
}
