//! SFTP session wrapper over `russh-sftp`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use russh::client::Handle;
use russh::{Channel, Disconnect};
use russh_sftp::client::SftpSession as RawSftp;
use russh_sftp::protocol::{FileType as RawFileType, OpenFlags};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::handler::ClientHandler;
use crate::{Error, Result};

const CHUNK: usize = 64 * 1024;

/// Portable file type for directory listings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteFileType {
    File,
    Dir,
    Symlink,
    Other,
}

impl From<RawFileType> for RemoteFileType {
    fn from(value: RawFileType) -> Self {
        match value {
            RawFileType::File => Self::File,
            RawFileType::Dir => Self::Dir,
            RawFileType::Symlink => Self::Symlink,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RemoteDirEntry {
    pub name: String,
    pub file_type: RemoteFileType,
    pub size: Option<u64>,
    pub modified_unix: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct RemoteFileStat {
    pub file_type: RemoteFileType,
    pub size: Option<u64>,
    pub modified_unix: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TransferProgress {
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
}

/// Aggregate progress for a recursive folder transfer.
#[derive(Debug, Clone, Default)]
pub struct TreeTransferProgress {
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
    pub files_done: u64,
    pub files_total: u64,
    pub current_file: Option<String>,
}

/// Result of a recursive transfer (partial trees allowed).
#[derive(Debug, Clone, Default)]
pub struct TreeTransferResult {
    pub bytes_transferred: u64,
    pub files_done: u64,
    pub files_total: u64,
    pub failures: Vec<String>,
    pub notes: Vec<String>,
    pub cancelled: bool,
}

/// Cooperative cancellation handle for long-running transfers.
#[derive(Clone, Debug)]
pub struct TransferControl {
    cancelled: Arc<AtomicBool>,
}

impl TransferControl {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

impl Default for TransferControl {
    fn default() -> Self {
        Self::new()
    }
}

/// High-level SFTP session. Owns the underlying SSH connection.
pub struct SftpSession {
    sftp: RawSftp,
    session: Handle<ClientHandler>,
}

impl SftpSession {
    pub(crate) async fn new(
        session: Handle<ClientHandler>,
        channel: Channel<russh::client::Msg>,
    ) -> Result<Self> {
        let sftp = RawSftp::new(channel.into_stream())
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;
        Ok(Self { sftp, session })
    }

    pub async fn list(&self, path: impl AsRef<Path>) -> Result<Vec<RemoteDirEntry>> {
        let path = path_to_str(path.as_ref())?;
        let entries = self
            .sftp
            .read_dir(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;

        let mut out = Vec::new();
        for entry in entries {
            let meta = entry.metadata();
            out.push(entry_from_metadata(entry.file_name(), meta));
        }
        Ok(out)
    }

    pub async fn stat(&self, path: impl AsRef<Path>) -> Result<RemoteFileStat> {
        let path = path_to_str(path.as_ref())?;
        let meta = self
            .sftp
            .metadata(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;
        Ok(stat_from_metadata(meta))
    }

    pub async fn mkdir(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = path_to_str(path.as_ref())?;
        self.sftp
            .create_dir(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))
    }

    pub async fn remove_file(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = path_to_str(path.as_ref())?;
        self.sftp
            .remove_file(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))
    }

    pub async fn remove_dir(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = path_to_str(path.as_ref())?;
        self.sftp
            .remove_dir(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))
    }

    pub async fn rename(&self, from: impl AsRef<Path>, to: impl AsRef<Path>) -> Result<()> {
        let from = path_to_str(from.as_ref())?;
        let to = path_to_str(to.as_ref())?;
        self.sftp
            .rename(from, to)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))
    }

    pub async fn get(&self, remote: impl AsRef<Path>, local: impl AsRef<Path>) -> Result<()> {
        self.get_with(remote, local, 0, &TransferControl::new(), |_| Ok(()))
            .await
            .map(|_| ())
    }

    pub async fn put(&self, local: impl AsRef<Path>, remote: impl AsRef<Path>) -> Result<()> {
        self.put_with(local, remote, 0, &TransferControl::new(), |_| Ok(()))
            .await
            .map(|_| ())
    }

    pub async fn get_with<F>(
        &self,
        remote: impl AsRef<Path>,
        local: impl AsRef<Path>,
        offset: u64,
        control: &TransferControl,
        mut on_progress: F,
    ) -> Result<u64>
    where
        F: FnMut(TransferProgress) -> Result<()>,
    {
        let remote = path_to_str(remote.as_ref())?;
        let local = local.as_ref();

        let mut remote_file = self
            .sftp
            .open(remote)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;

        let total_bytes = remote_file.metadata().await.ok().and_then(|meta| meta.size);

        if offset > 0 {
            remote_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
        }

        let mut local_file = if offset == 0 {
            tokio::fs::File::create(local).await?
        } else {
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .read(true)
                .truncate(false)
                .open(local)
                .await?;
            file.seek(std::io::SeekFrom::Start(offset)).await?;
            file
        };

        let mut transferred = offset;
        let mut buf = vec![0u8; CHUNK];
        loop {
            if control.is_cancelled() {
                return Err(Error::TransferCancelled);
            }

            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            on_progress(TransferProgress {
                bytes_transferred: transferred,
                total_bytes,
            })?;
        }
        local_file.flush().await?;
        Ok(transferred)
    }

    pub async fn put_with<F>(
        &self,
        local: impl AsRef<Path>,
        remote: impl AsRef<Path>,
        offset: u64,
        control: &TransferControl,
        mut on_progress: F,
    ) -> Result<u64>
    where
        F: FnMut(TransferProgress) -> Result<()>,
    {
        let remote = path_to_str(remote.as_ref())?;
        let local = local.as_ref();

        let local_len = tokio::fs::metadata(local).await?.len();
        let total_bytes = Some(local_len);

        let mut local_file = tokio::fs::File::open(local).await?;
        if offset > 0 {
            local_file.seek(std::io::SeekFrom::Start(offset)).await?;
        }

        let flags = if offset == 0 {
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
        } else {
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::READ
        };

        let mut remote_file = self
            .sftp
            .open_with_flags(remote, flags)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;

        if offset > 0 {
            remote_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
        }

        let mut transferred = offset;
        let mut buf = vec![0u8; CHUNK];
        loop {
            if control.is_cancelled() {
                return Err(Error::TransferCancelled);
            }

            let n = local_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
            transferred += n as u64;
            on_progress(TransferProgress {
                bytes_transferred: transferred,
                total_bytes,
            })?;
        }
        remote_file
            .flush()
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;
        Ok(transferred)
    }

    /// Upload a local directory tree to `remote_root` (created if missing).
    /// Skips symlinks; continues after per-file failures.
    pub async fn put_tree<F>(
        &self,
        local_root: impl AsRef<Path>,
        remote_root: impl AsRef<Path>,
        control: &TransferControl,
        mut on_progress: F,
    ) -> Result<TreeTransferResult>
    where
        F: FnMut(TreeTransferProgress) -> Result<()>,
    {
        let local_root = local_root.as_ref().to_path_buf();
        let remote_root = remote_root.as_ref().to_path_buf();

        let mut plan: Vec<(PathBuf, PathBuf, bool)> = Vec::new(); // local, remote, is_dir
        let mut notes = Vec::new();
        walk_local_tree(&local_root, &remote_root, &mut plan, &mut notes)?;

        let files_total = plan.iter().filter(|(_, _, is_dir)| !*is_dir).count() as u64;
        let total_bytes = plan
            .iter()
            .filter(|(_, _, is_dir)| !*is_dir)
            .map(|(local, _, _)| std::fs::metadata(local).map(|m| m.len()).unwrap_or(0))
            .sum::<u64>();

        let mut result = TreeTransferResult {
            files_total,
            notes,
            ..Default::default()
        };
        let mut bytes_done = 0u64;

        // Ensure root exists.
        let _ = self.mkdir(&remote_root).await;

        for (local, remote, is_dir) in plan {
            if control.is_cancelled() {
                result.cancelled = true;
                break;
            }
            let current = remote
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            on_progress(TreeTransferProgress {
                bytes_transferred: bytes_done,
                total_bytes: Some(total_bytes),
                files_done: result.files_done,
                files_total,
                current_file: Some(current.clone()),
            })?;

            if is_dir {
                if let Err(err) = self.mkdir(&remote).await {
                    // Exists is fine — russh may not distinguish; record other errors.
                    let msg = err.to_string();
                    if !msg.to_lowercase().contains("exist") {
                        result.failures.push(format!("{}: {msg}", remote.display()));
                    }
                }
                continue;
            }

            let file_bytes = match self
                .put_with(&local, &remote, 0, control, |p| {
                    on_progress(TreeTransferProgress {
                        bytes_transferred: bytes_done + p.bytes_transferred,
                        total_bytes: Some(total_bytes),
                        files_done: result.files_done,
                        files_total,
                        current_file: Some(current.clone()),
                    })
                })
                .await
            {
                Ok(n) => n,
                Err(Error::TransferCancelled) => {
                    result.cancelled = true;
                    break;
                }
                Err(err) => {
                    result.failures.push(format!("{}: {err}", remote.display()));
                    continue;
                }
            };
            bytes_done += file_bytes;
            result.files_done += 1;
            result.bytes_transferred = bytes_done;
            on_progress(TreeTransferProgress {
                bytes_transferred: bytes_done,
                total_bytes: Some(total_bytes),
                files_done: result.files_done,
                files_total,
                current_file: Some(current),
            })?;
        }

        Ok(result)
    }

    /// Download a remote directory tree to `local_root` (created if missing).
    pub async fn get_tree<F>(
        &self,
        remote_root: impl AsRef<Path>,
        local_root: impl AsRef<Path>,
        control: &TransferControl,
        mut on_progress: F,
    ) -> Result<TreeTransferResult>
    where
        F: FnMut(TreeTransferProgress) -> Result<()>,
    {
        let remote_root = remote_root.as_ref().to_path_buf();
        let local_root = local_root.as_ref().to_path_buf();

        // Safety: refuse downloading into a path that is the remote path string
        // mirrored onto local in a self-overwrite way when they share a prefix
        // after join — classic "copy into itself" for same-path mistakes.
        if paths_would_nest(&remote_root, &local_root) {
            return Err(Error::InvalidArgument(
                "refusing to download a folder into a path that would overwrite itself".into(),
            ));
        }

        let mut plan: Vec<(PathBuf, PathBuf, bool)> = Vec::new();
        let mut notes = Vec::new();
        self.walk_remote_tree(&remote_root, &local_root, &mut plan, &mut notes)
            .await?;

        let files_total = plan.iter().filter(|(_, _, is_dir)| !*is_dir).count() as u64;
        let mut total_bytes = 0u64;
        for (remote, _, is_dir) in &plan {
            if *is_dir {
                continue;
            }
            if let Ok(stat) = self.stat(remote).await {
                total_bytes += stat.size.unwrap_or(0);
            }
        }

        let mut result = TreeTransferResult {
            files_total,
            notes,
            ..Default::default()
        };
        let mut bytes_done = 0u64;

        tokio::fs::create_dir_all(&local_root).await?;

        for (remote, local, is_dir) in plan {
            if control.is_cancelled() {
                result.cancelled = true;
                break;
            }
            let current = remote
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            on_progress(TreeTransferProgress {
                bytes_transferred: bytes_done,
                total_bytes: Some(total_bytes),
                files_done: result.files_done,
                files_total,
                current_file: Some(current.clone()),
            })?;

            if is_dir {
                if let Err(err) = tokio::fs::create_dir_all(&local).await {
                    result.failures.push(format!("{}: {err}", local.display()));
                }
                continue;
            }

            if let Some(parent) = local.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }

            let file_bytes = match self
                .get_with(&remote, &local, 0, control, |p| {
                    on_progress(TreeTransferProgress {
                        bytes_transferred: bytes_done + p.bytes_transferred,
                        total_bytes: Some(total_bytes),
                        files_done: result.files_done,
                        files_total,
                        current_file: Some(current.clone()),
                    })
                })
                .await
            {
                Ok(n) => n,
                Err(Error::TransferCancelled) => {
                    result.cancelled = true;
                    break;
                }
                Err(err) => {
                    result.failures.push(format!("{}: {err}", remote.display()));
                    continue;
                }
            };
            bytes_done += file_bytes;
            result.files_done += 1;
            result.bytes_transferred = bytes_done;
            on_progress(TreeTransferProgress {
                bytes_transferred: bytes_done,
                total_bytes: Some(total_bytes),
                files_done: result.files_done,
                files_total,
                current_file: Some(current),
            })?;
        }

        Ok(result)
    }

    async fn walk_remote_tree(
        &self,
        remote_dir: &Path,
        local_dir: &Path,
        plan: &mut Vec<(PathBuf, PathBuf, bool)>,
        notes: &mut Vec<String>,
    ) -> Result<()> {
        plan.push((remote_dir.to_path_buf(), local_dir.to_path_buf(), true));
        let entries = self.list(remote_dir).await?;
        for entry in entries {
            if entry.name == "." || entry.name == ".." {
                continue;
            }
            let remote_child = remote_dir.join(&entry.name);
            let local_child = local_dir.join(&entry.name);
            match entry.file_type {
                RemoteFileType::Dir => {
                    Box::pin(self.walk_remote_tree(&remote_child, &local_child, plan, notes))
                        .await?;
                }
                RemoteFileType::Symlink => {
                    notes.push(format!("skipped symlink {}", remote_child.display()));
                }
                RemoteFileType::File | RemoteFileType::Other => {
                    plan.push((remote_child, local_child, false));
                }
            }
        }
        Ok(())
    }

    pub async fn canonicalize(&self, path: impl AsRef<Path>) -> Result<PathBuf> {
        let path = path_to_str(path.as_ref())?;
        let resolved = self
            .sftp
            .canonicalize(path)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;
        Ok(PathBuf::from(resolved))
    }

    pub async fn close(self) -> Result<()> {
        let _ = self.sftp.close().await;
        let _ = self
            .session
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
        Ok(())
    }
}

fn entry_from_metadata(name: String, meta: russh_sftp::client::fs::Metadata) -> RemoteDirEntry {
    RemoteDirEntry {
        name,
        file_type: RemoteFileType::from(meta.file_type()),
        size: meta.size,
        modified_unix: meta.mtime,
    }
}

fn stat_from_metadata(meta: russh_sftp::client::fs::Metadata) -> RemoteFileStat {
    RemoteFileStat {
        file_type: RemoteFileType::from(meta.file_type()),
        size: meta.size,
        modified_unix: meta.mtime,
    }
}

fn path_to_str(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| Error::InvalidArgument("path is not valid UTF-8".into()))
}

fn walk_local_tree(
    local_dir: &Path,
    remote_dir: &Path,
    plan: &mut Vec<(PathBuf, PathBuf, bool)>,
    notes: &mut Vec<String>,
) -> Result<()> {
    plan.push((local_dir.to_path_buf(), remote_dir.to_path_buf(), true));
    let entries = std::fs::read_dir(local_dir)?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "." || name_str == ".." {
            continue;
        }
        let local_child = entry.path();
        let remote_child = remote_dir.join(&name);
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(err) => {
                notes.push(format!("skipped {}: {err}", local_child.display()));
                continue;
            }
        };
        if meta.file_type().is_symlink() {
            notes.push(format!("skipped symlink {}", local_child.display()));
            continue;
        }
        if meta.is_dir() {
            walk_local_tree(&local_child, &remote_child, plan, notes)?;
        } else if meta.is_file() {
            plan.push((local_child, remote_child, false));
        } else {
            notes.push(format!("skipped special file {}", local_child.display()));
        }
    }
    Ok(())
}

/// Same path string on both sides — refuse (would overwrite the mirrored source).
fn paths_would_nest(remote: &Path, local: &Path) -> bool {
    remote == local
}
