//! SFTP session wrapper over `russh-sftp`.

use std::path::{Path, PathBuf};

use russh::client::Handle;
use russh::{Channel, Disconnect};
use russh_sftp::client::SftpSession as RawSftp;
use russh_sftp::protocol::{FileType as RawFileType, OpenFlags};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::handler::ClientHandler;
use crate::{Error, Result};

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
            out.push(RemoteDirEntry {
                name: entry.file_name(),
                file_type: RemoteFileType::from(meta.file_type()),
                size: meta.size,
            });
        }
        Ok(out)
    }

    pub async fn get(&self, remote: impl AsRef<Path>, local: impl AsRef<Path>) -> Result<()> {
        let remote = path_to_str(remote.as_ref())?;
        let mut remote_file = self
            .sftp
            .open(remote)
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;

        let mut local_file = tokio::fs::File::create(local.as_ref()).await?;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).await?;
        }
        local_file.flush().await?;
        Ok(())
    }

    pub async fn put(&self, local: impl AsRef<Path>, remote: impl AsRef<Path>) -> Result<()> {
        let remote = path_to_str(remote.as_ref())?;
        let mut local_file = tokio::fs::File::open(local.as_ref()).await?;
        let mut remote_file = self
            .sftp
            .open_with_flags(
                remote,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;

        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = local_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| Error::Sftp(e.to_string()))?;
        }
        remote_file
            .flush()
            .await
            .map_err(|e| Error::Sftp(e.to_string()))?;
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

fn path_to_str(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| Error::InvalidArgument("path is not valid UTF-8".into()))
}
