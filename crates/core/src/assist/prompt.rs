//! System prompts and response cleanup for Assist.

pub fn system_propose() -> &'static str {
    "You are a shell assistant inside Tethra, an SSH/SFTP client. \
     Reply with exactly one shell command and nothing else — no markdown fences, \
     no explanation, no leading prompt characters. Prefer POSIX-compatible commands \
     unless the context clearly indicates otherwise."
}

pub fn system_explain() -> &'static str {
    "You are a shell assistant inside Tethra. Explain the failure or output briefly \
     in plain text (2–6 sentences). Do not invent commands to run unless asked. \
     Do not wrap the answer in markdown fences."
}

/// Strip accidental markdown fences / quotes from a model command reply.
pub fn strip_command_fences(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if text.starts_with("```") {
        let mut lines: Vec<&str> = text.lines().collect();
        if lines.first().is_some_and(|line| line.starts_with("```")) {
            lines.remove(0);
        }
        if lines.last().is_some_and(|line| line.trim() == "```") {
            lines.pop();
        }
        text = lines.join("\n").trim().to_string();
    }
    text.trim_matches(|c| c == '`' || c == '"' || c == '\'')
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_bash_fence() {
        assert_eq!(strip_command_fences("```bash\npwd\n```"), "pwd");
    }
}
