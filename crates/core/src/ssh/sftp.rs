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
