//! Streaming OSC 133 (FinalTerm / semantic prompt) parser.
//!
//! Sequences (BEL or ST terminated):
//! - `OSC 133 ; A` — prompt start
//! - `OSC 133 ; B` — command start (user input region)
//! - `OSC 133 ; C` — output start (command executed)
//! - `OSC 133 ; D [; <exit>]` — command finished

/// Structured block markers emitted beside the raw PTY stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockEvent {
    PromptStart,
    CommandStart,
    OutputStart,
    CommandEnd { exit_code: Option<i32> },
}

/// Incremental scanner. Feed every outbound byte chunk; collect events.
#[derive(Debug, Default)]
pub struct Osc133Parser {
    state: State,
    /// Bytes accumulated for the OSC parameter body (after `OSC`).
    body: Vec<u8>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum State {
    #[default]
    Ground,
    Esc,
    Osc,
}

impl Osc133Parser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &[u8]) -> Vec<BlockEvent> {
        self.push_indexed(data)
            .into_iter()
            .map(|(_, event)| event)
            .collect()
    }

    /// Like [`push`], but each event is paired with the exclusive end offset
    /// in `data` where the OSC sequence finished (after BEL / ST).
    pub fn push_indexed(&mut self, data: &[u8]) -> Vec<(usize, BlockEvent)> {
        let mut events = Vec::new();
        for (i, &byte) in data.iter().enumerate() {
            if let Some(event) = self.feed(byte) {
                events.push((i + 1, event));
            }
        }
        events
    }

    fn feed(&mut self, byte: u8) -> Option<BlockEvent> {
        match self.state {
            State::Ground => {
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
                    None
                }
            }
            State::Osc => {
                // BEL terminates; ESC starts a potential ST (`ESC \`).
                if byte == 0x07 {
                    let event = Self::parse_body(&self.body);
                    self.body.clear();
                    self.state = State::Ground;
                    return event;
                }
                if byte == 0x1b {
                    // Peek handled by buffering ESC into body is wrong —
                    // wait for next byte via a mini sub-state: push ESC and
                    // decide on `\`.
                    self.body.push(byte);
                    return None;
                }
                if self.body.last() == Some(&0x1b) {
                    self.body.pop();
                    if byte == b'\\' {
                        let event = Self::parse_body(&self.body);
                        self.body.clear();
                        self.state = State::Ground;
                        return event;
                    }
                    // Not ST — treat prior ESC as data, then re-process.
                    // OSC bodies shouldn't contain ESC except as ST starter;
                    // reset to ground and re-feed.
                    self.body.clear();
                    self.state = State::Ground;
                    return self.feed(byte);
                }
                // Cap body to avoid unbounded growth on malformed streams.
                if self.body.len() < 256 {
                    self.body.push(byte);
                } else {
                    self.body.clear();
                    self.state = State::Ground;
                }
                None
            }
        }
    }

    fn parse_body(body: &[u8]) -> Option<BlockEvent> {
        // Expect `133;X` or `133;X;...`
        let text = std::str::from_utf8(body).ok()?;
        let mut parts = text.split(';');
        let code = parts.next()?;
        if code != "133" {
            return None;
        }
        let kind = parts.next()?.chars().next()?;
        match kind {
            'A' | 'a' => Some(BlockEvent::PromptStart),
            'B' | 'b' => Some(BlockEvent::CommandStart),
            'C' | 'c' => Some(BlockEvent::OutputStart),
            'D' | 'd' => {
                let exit_code = parts.next().and_then(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        trimmed.parse::<i32>().ok()
                    }
                });
                Some(BlockEvent::CommandEnd { exit_code })
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bel(payload: &str) -> Vec<u8> {
        let mut out = b"\x1b]".to_vec();
        out.extend_from_slice(payload.as_bytes());
        out.push(0x07);
        out
    }

    fn st(payload: &str) -> Vec<u8> {
        let mut out = b"\x1b]".to_vec();
        out.extend_from_slice(payload.as_bytes());
        out.extend_from_slice(b"\x1b\\");
        out
    }

    #[test]
    fn parses_abcd_with_bel() {
        let mut parser = Osc133Parser::new();
        let mut stream = Vec::new();
        stream.extend(bel("133;A"));
        stream.extend(b"prompt$ ");
        stream.extend(bel("133;B"));
        stream.extend(b"ls\n");
        stream.extend(bel("133;C"));
        stream.extend(b"file\n");
        stream.extend(bel("133;D;0"));

        assert_eq!(
            parser.push(&stream),
            vec![
                BlockEvent::PromptStart,
                BlockEvent::CommandStart,
                BlockEvent::OutputStart,
                BlockEvent::CommandEnd { exit_code: Some(0) },
            ]
        );
    }

    #[test]
    fn parses_st_terminator_and_split_chunks() {
        let mut parser = Osc133Parser::new();
        let seq = st("133;D;127");
        let (head, tail) = seq.split_at(4);
        assert!(parser.push(head).is_empty());
        assert_eq!(
            parser.push(tail),
            vec![BlockEvent::CommandEnd {
                exit_code: Some(127)
            }]
        );
    }

    #[test]
    fn ignores_other_osc() {
        let mut parser = Osc133Parser::new();
        assert!(parser.push(&bel("7;file://host/tmp")).is_empty());
        assert!(parser.push(&bel("52;c;YWJj")).is_empty());
    }

    #[test]
    fn push_indexed_reports_end_offsets() {
        let mut parser = Osc133Parser::new();
        let mut stream = Vec::new();
        stream.extend(bel("133;A"));
        stream.extend(b"hi");
        stream.extend(bel("133;B"));
        let events = parser.push_indexed(&stream);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, bel("133;A").len());
        assert_eq!(events[0].1, BlockEvent::PromptStart);
        assert_eq!(events[1].0, stream.len());
        assert_eq!(events[1].1, BlockEvent::CommandStart);
    }
}
