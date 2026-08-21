//! Resolve agent BYOK env from a project's bound Assist key (v0.3.0).
//!
//! Secrets stay in Rust. Callers write a `0600` env file and source it before
//! launching the agent — never put the key on a tmux command line.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use base64::Engine;
use uuid::Uuid;

use crate::agents;
use crate::model::{ApiKey, Project, ProjectLocation};
use crate::ssh::SessionManager;
use crate::vault::VaultRepository;
use crate::{Error, Result};

/// Non-secret handle returned to the UI after preparing an env file.
#[derive(Debug, Clone)]
pub struct ByokEnvHandle {
    /// Absolute path on the machine where the agent will run (local or remote).
    pub env_path: String,
    /// Variable names that were written (for UI display).
    pub var_names: Vec<String>,
    /// Label of the Assist key (never the secret).
    pub key_label: String,
}

/// Build `NAME=value` lines for the agent's `byok_env` list.
pub fn build_byok_env_map(byok_vars: &[String], key: &ApiKey) -> Result<Vec<(String, String)>> {
    if byok_vars.is_empty() {
        return Ok(Vec::new());
    }
    let secret = key.api_key.expose().to_string();
    if secret.trim().is_empty() {
        return Err(Error::InvalidArgument(
            "bound Assist key has no secret material".into(),
        ));
    }
    let base = key
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(|u| u.trim_end_matches('/').to_string());

    let mut out = Vec::new();
    for name in byok_vars {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let value = if name.eq_ignore_ascii_case("OPENAI_API_KEY")
            || name.eq_ignore_ascii_case("ANTHROPIC_API_KEY")
            || name.ends_with("_API_KEY")
            || name.ends_with("_KEY")
        {
            secret.clone()
        } else if name.eq_ignore_ascii_case("OPENAI_BASE_URL")
            || name.eq_ignore_ascii_case("OPENAI_API_BASE")
            || name.ends_with("_BASE_URL")
            || name.ends_with("_API_BASE")
        {
            base.clone().ok_or_else(|| {
                Error::InvalidArgument(format!(
                    "agent needs {name} but the Assist key has no base URL"
                ))
            })?
        } else {
            // Unknown var — treat as key material so OpenRouter-style names work.
            secret.clone()
        };
        out.push((name.to_string(), value));
    }
    Ok(out)
}

fn format_env_file(pairs: &[(String, String)]) -> String {
    let mut body = String::new();
    for (name, value) in pairs {
        let escaped = value.replace('\'', "'\\''");
        body.push_str(&format!("export {name}='{escaped}'\n"));
    }
    body
}

fn write_local_env_file(body: &str) -> Result<PathBuf> {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("tethra-byok-{}.env", Uuid::now_v7()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(&path)
        .map_err(|err| Error::Other(format!("byok env file: {err}")))?;
    file.write_all(body.as_bytes())
        .map_err(|err| Error::Other(format!("byok env write: {err}")))?;
    file.sync_all()
        .map_err(|err| Error::Other(format!("byok env sync: {err}")))?;
    Ok(path)
}

/// Prepare a BYOK env file for a project launch.
///
/// Returns `Ok(None)` when the project has no bound key or the agent declares
/// no `byok_env` vars.
pub async fn prepare_project_byok(
    repo: &VaultRepository,
    sessions: &SessionManager,
    project_id: Uuid,
) -> Result<Option<ByokEnvHandle>> {
    let project = repo.get_project(project_id).await?;
    prepare_byok_for_project(repo, sessions, &project).await
}

pub async fn prepare_byok_for_project(
    repo: &VaultRepository,
    sessions: &SessionManager,
    project: &Project,
) -> Result<Option<ByokEnvHandle>> {
    let Some(key_id) = project.assist_key_id else {
        return Ok(None);
    };
    let agent_id = project.default_agent.as_deref().unwrap_or("shell");
    let preset = agents::agent_preset_by_id(agent_id)?
        .or_else(|| agents::agent_preset_by_id("shell").ok().flatten());
    let Some(preset) = preset else {
        return Ok(None);
    };
    if preset.byok_env.is_empty() {
        return Ok(None);
    }

    let key = repo.get_api_key(key_id).await?;
    let pairs = build_byok_env_map(&preset.byok_env, &key)?;
    if pairs.is_empty() {
        return Ok(None);
    }
    let var_names: Vec<String> = pairs.iter().map(|(n, _)| n.clone()).collect();
    let body = format_env_file(&pairs);
    let key_label = key.label.clone();

    let env_path = match &project.location {
        ProjectLocation::Local { .. } => {
            write_local_env_file(&body)?.to_string_lossy().into_owned()
        }
        ProjectLocation::Remote { host_id, .. } => {
            write_remote_env_file(sessions, *host_id, &body).await?
        }
    };

    Ok(Some(ByokEnvHandle {
        env_path,
        var_names,
        key_label,
    }))
}

async fn write_remote_env_file(
    sessions: &SessionManager,
    host_id: Uuid,
    body: &str,
) -> Result<String> {
    // Write via exec so the secret never appears on the interactive PTY or
    // tmux argv. File is created with umask 077 (0600).
    let b64 = base64::engine::general_purpose::STANDARD.encode(body.as_bytes());
    let cmd = format!(
        "umask 077; f=$(mktemp \"${{TMPDIR:-/tmp}}/tethra-byok.XXXXXX\") || exit 1; \
         printf '%s' '{b64}' | base64 -d > \"$f\" || {{ rm -f \"$f\"; exit 1; }}; \
         chmod 600 \"$f\"; printf '%s' \"$f\""
    );
    let result = sessions.exec(host_id, &cmd).await?;
    if result.exit_code != 0 {
        let err = String::from_utf8_lossy(&result.stderr);
        return Err(Error::Other(format!(
            "remote byok env write failed (exit {}): {err}",
            result.exit_code
        )));
    }
    let path = String::from_utf8_lossy(&result.stdout).trim().to_string();
    if path.is_empty() || !path.starts_with('/') {
        return Err(Error::Other(
            "remote byok env write returned an empty path".into(),
        ));
    }
    Ok(path)
}

/// Best-effort local cleanup (remote files are unlinked by the launch script).
pub fn cleanup_local_byok_path(path: &str) {
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AssistProviderKind, SecretString};

    #[test]
    fn maps_openai_key_and_base() {
        let key = ApiKey {
            id: Uuid::nil(),
            label: "or".into(),
            provider: AssistProviderKind::OpenAiCompat,
            base_url: Some("https://openrouter.ai/api/v1".into()),
            model: None,
            api_key: SecretString::new("sk-test"),
            sync_secret: false,
        };
        let pairs =
            build_byok_env_map(&["OPENAI_API_KEY".into(), "OPENAI_BASE_URL".into()], &key).unwrap();
        assert_eq!(
            pairs,
            vec![
                ("OPENAI_API_KEY".into(), "sk-test".into()),
                (
                    "OPENAI_BASE_URL".into(),
                    "https://openrouter.ai/api/v1".into()
                ),
            ]
        );
    }

    #[test]
    fn env_file_escapes_quotes() {
        let body = format_env_file(&[("K".into(), "a'b".into())]);
        assert_eq!(body, "export K='a'\\''b'\n");
    }
}
