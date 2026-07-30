//! Portable `ssh_config` parsing for host import.
//!
//! File discovery and reading stay in platform adapters. Core accepts text,
//! resolves concrete `Host` aliases through `russh-config`, and returns
//! non-secret metadata suitable for previewing over IPC.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// A concrete host entry resolved from OpenSSH-style configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshConfigHost {
    pub alias: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub proxy_jump: Option<String>,
    pub has_identity_file: bool,
}

/// Import preview plus compatibility warnings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshConfigPreview {
    pub hosts: Vec<SshConfigHost>,
    pub warnings: Vec<String>,
}

/// Parse concrete aliases from an OpenSSH-style configuration.
///
/// Wildcard and negated patterns are defaults, not importable hosts. `Match`
/// blocks are excluded because `russh-config` does not evaluate their
/// conditions and applying them would silently corrupt host metadata.
pub fn parse_ssh_config(contents: &str) -> Result<SshConfigPreview> {
    let aliases = concrete_aliases(contents);
    let (sanitized, mut warnings) = sanitize(contents);
    let parser_input = format!("Host *\n{sanitized}");
    let mut hosts = Vec::with_capacity(aliases.len());

    for alias in aliases {
        let config = russh_config::parse(&parser_input, &alias)
            .map_err(|error| Error::SshConfig(error.to_string()))?;
        if config.host_config.proxy_command.is_some()
            && !warnings
                .iter()
                .any(|warning| warning.contains("ProxyCommand"))
        {
            warnings
                .push("ProxyCommand is not imported; configure a native jump host instead.".into());
        }
        let proxy_jump = config
            .host_config
            .proxy_jump
            .as_deref()
            .filter(|value| !value.eq_ignore_ascii_case("none"))
            .map(str::to_owned);
        if proxy_jump
            .as_deref()
            .is_some_and(|value| value.contains(','))
            && !warnings.iter().any(|warning| warning.contains("multi-hop"))
        {
            warnings.push(
                "A multi-hop ProxyJump chain was found; only the first imported hop can be linked."
                    .into(),
            );
        }

        hosts.push(SshConfigHost {
            alias,
            hostname: config.host().to_owned(),
            port: config.port(),
            username: config.user(),
            proxy_jump,
            has_identity_file: config
                .host_config
                .identity_file
                .as_ref()
                .is_some_and(|files| !files.is_empty()),
        });
    }

    Ok(SshConfigPreview { hosts, warnings })
}

/// Return the first host token from a ProxyJump expression.
pub(crate) fn proxy_jump_alias(value: &str) -> Option<&str> {
    let first = value.split(',').next()?.trim();
    if first.is_empty() || first.eq_ignore_ascii_case("none") {
        return None;
    }
    let without_user = first.rsplit_once('@').map_or(first, |(_, host)| host);
    if without_user.starts_with('[') {
        return without_user
            .strip_prefix('[')
            .and_then(|host| host.split(']').next());
    }
    Some(without_user.split(':').next().unwrap_or(without_user))
}

fn concrete_aliases(contents: &str) -> Vec<String> {
    let mut aliases = Vec::new();
    let mut seen = HashSet::new();
    for line in contents.lines() {
        let line = line.trim();
        let Some((keyword, value)) = split_directive(line) else {
            continue;
        };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for alias in value.split_ascii_whitespace() {
            if alias.is_empty()
                || alias.starts_with('!')
                || alias
                    .chars()
                    .any(|character| matches!(character, '*' | '?' | '['))
            {
                continue;
            }
            if seen.insert(alias.to_owned()) {
                aliases.push(alias.to_owned());
            }
        }
    }
    aliases
}

fn sanitize(contents: &str) -> (String, Vec<String>) {
    let mut output = String::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut in_match = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        let directive = split_directive(trimmed);
        if let Some((keyword, _)) = directive {
            if keyword.eq_ignore_ascii_case("match") {
                in_match = true;
                if !warnings.iter().any(|warning| warning.contains("Match")) {
                    warnings.push(
                        "Match blocks are skipped because conditional rules cannot be imported safely."
                            .into(),
                    );
                }
                continue;
            }
            if keyword.eq_ignore_ascii_case("host") {
                in_match = false;
            }
            if keyword.eq_ignore_ascii_case("include")
                && !warnings.iter().any(|warning| warning.contains("Include"))
            {
                warnings.push(
                    "Include directives are not expanded; only hosts in the selected file are shown."
                        .into(),
                );
            }
        }
        if !in_match {
            if let Some((keyword, value)) = directive {
                output.push_str(keyword);
                output.push(' ');
                output.push_str(value);
            } else {
                output.push_str(line);
            }
            output.push('\n');
        }
    }
    (output, warnings)
}

fn split_directive(line: &str) -> Option<(&str, &str)> {
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let without_comment = line.split('#').next()?.trim();
    let split_at = without_comment
        .find(char::is_whitespace)
        .or_else(|| without_comment.find('='))?;
    let (keyword, value) = without_comment.split_at(split_at);
    let value = value
        .trim_start_matches(|character: char| character.is_whitespace() || character == '=')
        .trim();
    (!keyword.is_empty() && !value.is_empty()).then_some((keyword, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_concrete_hosts_defaults_and_proxy_jump() {
        let preview = parse_ssh_config(
            r#"
            Host=target
              HostName	10.0.0.2
              User deploy
              Port 2222
              ProxyJump ops@bastion:2200
              IdentityFile ~/.ssh/id_ed25519

            Host bastion
              HostName jump.example.com
              User ops

            Host *
              Port 22
            "#,
        )
        .unwrap();

        assert_eq!(preview.hosts.len(), 2);
        assert_eq!(preview.hosts[0].alias, "target");
        assert_eq!(preview.hosts[0].hostname, "10.0.0.2");
        assert_eq!(preview.hosts[0].username, "deploy");
        assert_eq!(preview.hosts[0].port, 2222);
        assert_eq!(
            preview.hosts[0].proxy_jump.as_deref(),
            Some("ops@bastion:2200")
        );
        assert!(preview.hosts[0].has_identity_file);
        assert_eq!(proxy_jump_alias("ops@bastion:2200"), Some("bastion"));
    }

    #[test]
    fn excludes_patterns_and_match_blocks() {
        let preview = parse_ssh_config(
            r#"
            Host *.example.com !blocked.example.com
              User default
            Host real
              HostName real.example.com
            Match host real
              User corrupted
            "#,
        )
        .unwrap();

        assert_eq!(preview.hosts.len(), 1);
        assert_eq!(preview.hosts[0].alias, "real");
        assert_ne!(preview.hosts[0].username, "corrupted");
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("Match"))
        );
    }

    #[test]
    fn parses_proxy_jump_variants() {
        assert_eq!(proxy_jump_alias("jump"), Some("jump"));
        assert_eq!(proxy_jump_alias("user@jump:2222"), Some("jump"));
        assert_eq!(proxy_jump_alias("[::1]:2222"), Some("::1"));
        assert_eq!(proxy_jump_alias("one,two"), Some("one"));
        assert_eq!(proxy_jump_alias("none"), None);
    }
}
