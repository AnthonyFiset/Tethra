//! Platform-neutral local terminal capability.

use std::path::PathBuf;

use bytes::Bytes;
use tokio::sync::mpsc;

use crate::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
    pub pixel_width: u16,
    pub pixel_height: u16,
}

impl PtySize {
    pub fn new(cols: u32, rows: u32) -> Self {
        Self {
            cols: cols.clamp(1, u16::MAX as u32) as u16,
            rows: rows.clamp(1, u16::MAX as u32) as u16,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

pub trait LocalPty: Send + Sync {
    fn is_available(&self) -> bool;
    fn default_shell(&self) -> Option<ShellSpec>;
    fn spawn(
        &self,
        spec: ShellSpec,
        size: PtySize,
    ) -> Result<(Box<dyn LocalPtySession>, mpsc::Receiver<Bytes>)>;
}

pub trait LocalPtySession: Send {
    fn write(&mut self, data: &[u8]) -> Result<()>;
    fn resize(&mut self, size: PtySize) -> Result<()>;
    fn close(self: Box<Self>) -> Result<()>;
}
