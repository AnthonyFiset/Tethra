//! Shared terminal output batching and backpressure for SSH and local PTYs.
//!
//! Raw bytes are forwarded unchanged. OSC 133 markers and attention signals
//! (BEL / OSC 9 / OSC 777) are parsed in parallel and emitted as structured
//! events beside the stream. Output silence emits a low-priority waiting hint.
//!
//! Events are broadcast on the app event bus so any OS window can attach to a
//! session (multi-window presentation layer).

use std::time::{Duration, Instant};

use bytes::Bytes;
use ssh_client_core::terminal::{AttentionKind, AttentionParser, BlockEvent, Osc133Parser};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{AgentAttentionState, TerminalBlockPhase, TerminalEvent, TerminalEventEnvelope};

const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
const MAX_CHUNK: usize = 64 * 1024;
const MAX_PENDING: usize = 256 * 1024;
const DROPPED_MARKER: &[u8] = b"\r\n\x1b[33m[output dropped: terminal fell behind]\x1b[0m\r\n";
/// Lowest-priority waiting signal; never overrides an explicit BEL/OSC/exit.
const SILENCE_SECS: u64 = 30;

fn encode_b64(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

pub async fn forward_output(session_id: Uuid, mut receiver: mpsc::Receiver<Bytes>, app: AppHandle) {
    let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut silence_tick = tokio::time::interval(Duration::from_secs(1));
    silence_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut pending = Vec::with_capacity(MAX_CHUNK);
    let mut dropped = false;
    let mut osc133 = Osc133Parser::new();
    let mut attention = AttentionParser::new();
    let mut last_output = Instant::now();
    let mut silence_emitted = false;
    let session_id = session_id.to_string();

    loop {
        tokio::select! {
            message = receiver.recv() => {
                match message {
                    Some(data) => {
                        last_output = Instant::now();
                        silence_emitted = false;

                        // Emit data segments before each OSC 133 marker so the
                        // UI can place gutter markers after the right lines
                        // instead of collapsing every phase onto one write.
                        let mut cursor = 0usize;
                        for (end, event) in osc133.push_indexed(&data) {
                            if end > cursor {
                                pending.extend_from_slice(&data[cursor..end]);
                                cursor = end;
                            }
                            if !pending.is_empty() {
                                flush_one(&mut pending, &app, &session_id, &mut dropped);
                            }
                            emit(&app, &session_id, block_event(event));
                        }
                        if cursor < data.len() {
                            pending.extend_from_slice(&data[cursor..]);
                        }
                        if pending.len() > MAX_PENDING {
                            drop_middle(&mut pending);
                            dropped = true;
                        }
                        if pending.len() >= MAX_CHUNK {
                            flush_one(&mut pending, &app, &session_id, &mut dropped);
                        }

                        for signal in attention.push(&data) {
                            emit(
                                &app,
                                &session_id,
                                attention_event(signal),
                            );
                        }
                    }
                    None => {
                        while !pending.is_empty() {
                            flush_one(&mut pending, &app, &session_id, &mut dropped);
                        }
                        emit(&app, &session_id, TerminalEvent::Closed);
                        break;
                    }
                }
            }
            _ = ticker.tick(), if !pending.is_empty() => {
                flush_one(&mut pending, &app, &session_id, &mut dropped);
            }
            _ = silence_tick.tick() => {
                if !silence_emitted
                    && last_output.elapsed() >= Duration::from_secs(SILENCE_SECS)
                {
                    silence_emitted = true;
                    emit(
                        &app,
                        &session_id,
                        TerminalEvent::Attention {
                            state: AgentAttentionState::Waiting,
                            message: None,
                            source: "silence".into(),
                        },
                    );
                }
            }
        }
    }
}

fn emit(app: &AppHandle, session_id: &str, event: TerminalEvent) {
    let _ = app.emit(
        "terminal-event",
        TerminalEventEnvelope {
            session_id: session_id.to_string(),
            event,
        },
    );
}

fn attention_event(signal: AttentionKind) -> TerminalEvent {
    match signal {
        AttentionKind::Bell => TerminalEvent::Attention {
            state: AgentAttentionState::Waiting,
            message: None,
            source: "bel".into(),
        },
        AttentionKind::Notify { message } => TerminalEvent::Attention {
            state: AgentAttentionState::Waiting,
            message,
            source: "osc".into(),
        },
    }
}

fn block_event(event: BlockEvent) -> TerminalEvent {
    match event {
        BlockEvent::PromptStart => TerminalEvent::Block {
            phase: TerminalBlockPhase::PromptStart,
            exit_code: None,
        },
        BlockEvent::CommandStart => TerminalEvent::Block {
            phase: TerminalBlockPhase::CommandStart,
            exit_code: None,
        },
        BlockEvent::OutputStart => TerminalEvent::Block {
            phase: TerminalBlockPhase::OutputStart,
            exit_code: None,
        },
        BlockEvent::CommandEnd { exit_code } => TerminalEvent::Block {
            phase: TerminalBlockPhase::CommandEnd,
            exit_code,
        },
    }
}

fn flush_one(pending: &mut Vec<u8>, app: &AppHandle, session_id: &str, dropped: &mut bool) {
    let split = pending.len().min(MAX_CHUNK);
    let remainder = pending.split_off(split);
    let data = std::mem::replace(pending, remainder);
    emit(
        app,
        session_id,
        TerminalEvent::Data {
            data: encode_b64(&data),
            dropped: std::mem::take(dropped),
        },
    );
}

fn drop_middle(pending: &mut Vec<u8>) {
    let edge = (MAX_PENDING.saturating_sub(DROPPED_MARKER.len())) / 2;
    let tail_start = pending.len().saturating_sub(edge);
    let tail = pending[tail_start..].to_vec();
    pending.truncate(edge);
    pending.extend_from_slice(DROPPED_MARKER);
    pending.extend_from_slice(&tail);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn middle_drop_is_bounded_and_marked() {
        let mut bytes = vec![b'a'; MAX_PENDING + 1024];
        drop_middle(&mut bytes);
        assert!(bytes.len() <= MAX_PENDING);
        assert!(
            bytes
                .windows(DROPPED_MARKER.len())
                .any(|window| window == DROPPED_MARKER)
        );
    }
}
