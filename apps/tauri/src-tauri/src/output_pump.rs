//! Shared terminal output batching and backpressure for SSH and local PTYs.

use std::time::Duration;

use bytes::Bytes;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::TerminalEvent;

const FLUSH_INTERVAL: Duration = Duration::from_millis(10);
const MAX_CHUNK: usize = 64 * 1024;
const MAX_PENDING: usize = 256 * 1024;
const DROPPED_MARKER: &[u8] = b"\r\n\x1b[33m[output dropped: terminal fell behind]\x1b[0m\r\n";

pub async fn forward_output(mut receiver: mpsc::Receiver<Bytes>, output: Channel<TerminalEvent>) {
    let mut ticker = tokio::time::interval(FLUSH_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut pending = Vec::with_capacity(MAX_CHUNK);
    let mut dropped = false;

    loop {
        tokio::select! {
            message = receiver.recv() => {
                match message {
                    Some(data) => {
                        pending.extend_from_slice(&data);
                        if pending.len() > MAX_PENDING {
                            drop_middle(&mut pending);
                            dropped = true;
                        }
                        if pending.len() >= MAX_CHUNK {
                            flush_one(&mut pending, &output, &mut dropped);
                        }
                    }
                    None => {
                        while !pending.is_empty() {
                            flush_one(&mut pending, &output, &mut dropped);
                        }
                        let _ = output.send(TerminalEvent::Closed);
                        break;
                    }
                }
            }
            _ = ticker.tick(), if !pending.is_empty() => {
                flush_one(&mut pending, &output, &mut dropped);
            }
        }
    }
}

fn flush_one(pending: &mut Vec<u8>, output: &Channel<TerminalEvent>, dropped: &mut bool) {
    let split = pending.len().min(MAX_CHUNK);
    let remainder = pending.split_off(split);
    let data = std::mem::replace(pending, remainder);
    let event = TerminalEvent::Data {
        data,
        dropped: std::mem::take(dropped),
    };
    let _ = output.send(event);
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
