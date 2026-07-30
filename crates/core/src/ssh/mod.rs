//! SSH session management: PTY, exec, and SFTP paths.

mod approval;
mod fingerprint;
mod handler;
mod session;
mod sftp;

pub use approval::{Action, AlwaysApprove, AlwaysDeny, ApprovalGate};
pub use fingerprint::{PresentedHostKey, fingerprint_sha256, presented_from_public_key};
pub use session::{
    AuthProvider, ExecResult, HostKeyDecision, HostKeyPolicy, HostStore, InMemoryHostStore,
    PtyHandle, SessionManager, StaticAuthProvider, TofuHostKeyPolicy,
};
pub use sftp::{RemoteDirEntry, RemoteFileType, SftpSession};
