//! Desktop local PTY implementation backed by `portable-pty`.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc as std_mpsc;
use std::thread::JoinHandle;
use std::time::Duration;

use bytes::Bytes;
use platform::{LocalPty, LocalPtySession, PlatformError, PtySize, Result, ShellSpec};
use portable_pty::{CommandBuilder, MasterPty, PtySize as PortableSize, native_pty_system};
use tokio::sync::mpsc;

const OUTPUT_CAPACITY: usize = 128;
const READ_CHUNK: usize = 64 * 1024;

#[derive(Debug, Default)]
pub struct DesktopLocalPty;

enum Command {
    Write(Vec<u8>, std_mpsc::Sender<Result<()>>),
    Resize(PtySize, std_mpsc::Sender<Result<()>>),
    Close(std_mpsc::Sender<Result<()>>),
}

struct DesktopLocalPtySession {
    commands: std_mpsc::Sender<Command>,
    worker: Option<JoinHandle<()>>,
    reader: Option<JoinHandle<()>>,
}

impl LocalPty for DesktopLocalPty {
    fn is_available(&self) -> bool {
        true
    }

    fn default_shell(&self) -> Option<ShellSpec> {
        default_shell()
    }

    fn spawn(
        &self,
        spec: ShellSpec,
        size: PtySize,
    ) -> Result<(Box<dyn LocalPtySession>, mpsc::Receiver<Bytes>)> {
        let pair = native_pty_system()
            .openpty(to_portable_size(size))
            .map_err(local_error)?;

        let mut command = CommandBuilder::new(&spec.program);
        command.args(&spec.args);
        if let Some(cwd) = spec.cwd {
            command.cwd(cwd);
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TETHRA", "1");
        for (key, value) in spec.env {
            command.env(key, value);
        }

        let child = pair.slave.spawn_command(command).map_err(local_error)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(local_error)?;
        let writer = pair.master.take_writer().map_err(local_error)?;
        let master = pair.master;

        let (output_tx, output_rx) = mpsc::channel(OUTPUT_CAPACITY);
        let reader_thread = std::thread::Builder::new()
            .name("tethra-local-pty-reader".into())
            .spawn(move || {
                let mut buffer = vec![0u8; READ_CHUNK];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            if output_tx
                                .blocking_send(Bytes::copy_from_slice(&buffer[..count]))
                                .is_err()
                            {
                                break;
                            }
                        }
                    }
                }
            })
            .map_err(local_error)?;

        let (commands, command_rx) = std_mpsc::channel();
        let worker = spawn_worker(command_rx, master, writer, child)?;

        Ok((
            Box::new(DesktopLocalPtySession {
                commands,
                worker: Some(worker),
                reader: Some(reader_thread),
            }),
            output_rx,
        ))
    }
}

fn spawn_worker(
    commands: std_mpsc::Receiver<Command>,
    master: Box<dyn MasterPty + Send>,
    mut writer: Box<dyn Write + Send>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) -> Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("tethra-local-pty-control".into())
        .spawn(move || {
            loop {
                match commands.recv_timeout(Duration::from_millis(100)) {
                    Ok(Command::Write(data, reply)) => {
                        let result = writer
                            .write_all(&data)
                            .and_then(|_| writer.flush())
                            .map_err(local_error);
                        let _ = reply.send(result);
                    }
                    Ok(Command::Resize(size, reply)) => {
                        let result = master.resize(to_portable_size(size)).map_err(local_error);
                        let _ = reply.send(result);
                    }
                    Ok(Command::Close(reply)) => {
                        let kill_result = child.kill().map_err(local_error);
                        let wait_result = child.wait().map(|_| ()).map_err(local_error);
                        let _ = reply.send(kill_result.and(wait_result));
                        break;
                    }
                    Err(std_mpsc::RecvTimeoutError::Timeout) => match child.try_wait() {
                        Ok(Some(_)) | Err(_) => break,
                        Ok(None) => {}
                    },
                    Err(std_mpsc::RecvTimeoutError::Disconnected) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        })
        .map_err(local_error)
}

impl LocalPtySession for DesktopLocalPtySession {
    fn write(&mut self, data: &[u8]) -> Result<()> {
        request(&self.commands, |reply| Command::Write(data.to_vec(), reply))
    }

    fn resize(&mut self, size: PtySize) -> Result<()> {
        request(&self.commands, |reply| Command::Resize(size, reply))
    }

    fn close(mut self: Box<Self>) -> Result<()> {
        let result = request(&self.commands, Command::Close);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        result
    }
}

impl Drop for DesktopLocalPtySession {
    fn drop(&mut self) {
        if self.worker.is_some() {
            let (reply, _rx) = std_mpsc::channel();
            let _ = self.commands.send(Command::Close(reply));
        }
    }
}

fn request(
    commands: &std_mpsc::Sender<Command>,
    command: impl FnOnce(std_mpsc::Sender<Result<()>>) -> Command,
) -> Result<()> {
    let (reply, response) = std_mpsc::channel();
    commands
        .send(command(reply))
        .map_err(|_| PlatformError::LocalPty("local terminal closed".into()))?;
    response
        .recv()
        .map_err(|_| PlatformError::LocalPty("local terminal worker stopped".into()))?
}

fn default_shell() -> Option<ShellSpec> {
    let program = resolve_shell()?;
    let args = if cfg!(target_os = "macos") {
        vec!["-l".into()]
    } else {
        Vec::new()
    };
    Some(ShellSpec {
        program,
        args,
        cwd: crate::home_dir().ok(),
        env: Vec::new(),
    })
}

#[cfg(unix)]
fn resolve_shell() -> Option<PathBuf> {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            let fallback = if cfg!(target_os = "macos") {
                Path::new("/bin/zsh")
            } else {
                Path::new("/bin/bash")
            };
            fallback.is_file().then(|| fallback.to_path_buf())
        })
}

#[cfg(windows)]
fn resolve_shell() -> Option<PathBuf> {
    ["pwsh.exe", "powershell.exe", "cmd.exe"]
        .into_iter()
        .find_map(find_on_path)
}

#[cfg(windows)]
fn find_on_path(program: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join(program))
            .find(|candidate| candidate.is_file())
    })
}

fn to_portable_size(size: PtySize) -> PortableSize {
    PortableSize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: size.pixel_width,
        pixel_height: size.pixel_height,
    }
}

fn local_error(error: impl std::fmt::Display) -> PlatformError {
    PlatformError::LocalPty(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_is_available() {
        let local = DesktopLocalPty;
        assert!(local.is_available());
        assert!(local.default_shell().is_some());
    }

    #[cfg(unix)]
    #[test]
    fn local_shell_roundtrip() {
        let local = DesktopLocalPty;
        let spec = ShellSpec {
            program: PathBuf::from("/bin/sh"),
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
        };
        let (mut session, mut output) = local.spawn(spec, PtySize::new(80, 24)).expect("spawn");
        session
            .write(b"printf 'tethra-pty-ok\\n'; exit\n")
            .expect("write");

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut received = Vec::new();
        while std::time::Instant::now() < deadline {
            match output.try_recv() {
                Ok(chunk) => received.extend_from_slice(&chunk),
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
            }
            if received
                .windows(b"tethra-pty-ok".len())
                .any(|window| window == b"tethra-pty-ok")
            {
                break;
            }
        }
        assert!(
            received
                .windows(b"tethra-pty-ok".len())
                .any(|window| window == b"tethra-pty-ok")
        );
    }
}
