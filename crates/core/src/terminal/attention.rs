//! Agent attention signals from a raw PTY byte stream.
//!
//! Detects BEL, OSC 9, and OSC 777 while leaving OSC 133 to [`super::Osc133Parser`].
//! Does not rewrite the stream — observe only.

/// Why the session wants attention (or finished).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionKind {
    /// BEL (`\a`) — Claude Code and others when they need input.
    Bell,
    /// OSC 9 / OSC 777 desktop-notification request.
    Notify { message: Option<String> },
}

/// Incremental scanner for attention OSC / BEL.
#[derive(Debug, Default)]
pub struct AttentionParser {
    state: State,
    body: Vec<u8>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum State {
    #[default]
    Ground,
    Esc,
    Osc,
}

impl AttentionParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &[u8]) -> Vec<AttentionKind> {
        let mut out = Vec::new();
        for &byte in data {
            if let Some(signal) = self.feed(byte) {
                out.push(signal);
            }
        }
        out
    }

    fn feed(&mut self, byte: u8) -> Option<AttentionKind> {
        match self.state {
            State::Ground => {
                if byte == 0x07 {
                    return Some(AttentionKind::Bell);
                }
                if byte == 0x1b {
                    self.state = State::Esc;
                }
                None
            }
            State::Esc => {
                if byte == b']' {
                    self.state = State::Osc;
                    self.body.clear();
                    None
                } else {
                    self.state = State::Ground;
                    // Re-check BEL after a non-OSC ESC sequence.
                    if byte == 0x07 {
                        return Some(AttentionKind::Bell);
                    }
                    if byte == 0x1b {
                        self.state = State::Esc;
                    }
                    None
                }
            }
            State::Osc => {
                if byte == 0x07 {
                    let signal = Self::parse_body(&self.body);
                    self.body.clear();
                    self.state = State::Ground;
                    return signal;
                }
                if byte == 0x1b {
                    self.body.push(byte);
                    return None;
                }
                if self.body.last() == Some(&0x1b) {
                    self.body.pop();
                    if byte == b'\\' {
                        let signal = Self::parse_body(&self.body);
                        self.body.clear();
                        self.state = State::Ground;
                        return signal;
                    }
                    self.body.clear();
                    self.state = State::Ground;
                    return self.feed(byte);
                }
                if self.body.len() < 512 {
                    self.body.push(byte);
                } else {
                    self.body.clear();
                    self.state = State::Ground;
                }
                None
            }
        }
    }

    fn parse_body(body: &[u8]) -> Option<AttentionKind> {
        let text = std::str::from_utf8(body).ok()?;
        // OSC 9 ; <message>
        if let Some(rest) = text.strip_prefix("9;") {
            let message = rest.trim();
            return Some(AttentionKind::Notify {
                message: if message.is_empty() {
                    None
                } else {
                    Some(message.to_string())
                },
            });
        }
        if text == "9" {
            return Some(AttentionKind::Notify { message: None });
        }
        // OSC 777 ; notify ; <title> ; <body>  (or similar iTerm/URxvt forms)
        if let Some(rest) = text.strip_prefix("777;") {
            let parts: Vec<&str> = rest.splitn(3, ';').collect();
            if parts
                .first()
                .is_some_and(|p| p.eq_ignore_ascii_case("notify"))
            {
                let message = parts
                    .get(2)
                    .or(parts.get(1))
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty());
                return Some(AttentionKind::Notify {
                    message: message.map(str::to_string),
                });
            }
            // Generic 777 payload — treat as notify with raw text.
            let message = rest.trim();
            return Some(AttentionKind::Notify {
                message: if message.is_empty() {
                    None
                } else {
                    Some(message.to_string())
                },
            });
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_bel_is_waiting() {
        let mut p = AttentionParser::new();
        assert_eq!(p.push(b"hello\x07world"), vec![AttentionKind::Bell]);
    }

    #[test]
    fn osc9_message() {
        let mut p = AttentionParser::new();
        let seq = b"\x1b]9;Need input\x07";
        assert_eq!(
            p.push(seq),
            vec![AttentionKind::Notify {
                message: Some("Need input".into())
            }]
        );
    }

    #[test]
    fn osc777_notify() {
        let mut p = AttentionParser::new();
        let seq = b"\x1b]777;notify;Claude;Waiting for you\x07";
        assert_eq!(
            p.push(seq),
            vec![AttentionKind::Notify {
                message: Some("Waiting for you".into())
            }]
        );
    }

    #[test]
    fn osc133_bel_terminator_is_not_attention() {
        let mut p = AttentionParser::new();
        // Body is 133;A — parse_body returns None; BEL terminates OSC, not bare BEL.
        assert!(p.push(b"\x1b]133;A\x07").is_empty());
    }
}
