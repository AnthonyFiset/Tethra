//! SSH session management: PTY, exec, and SFTP paths.

mod agent_forward;
mod approval;
mod fingerprint;
mod handler;
mod session;
mod sftp;
mod tunnel;

pub use agent_forward::AgentForwardStatus;
pub use approval::{Action, AlwaysApprove, AlwaysDeny, ApprovalGate};
pub use fingerprint::{PresentedHostKey, fingerprint_sha256, presented_from_public_key};
pub use session::{
    AuthProvider, ExecResult, HostKeyDecision, HostKeyPolicy, HostStore, InMemoryHostStore,
    PtyHandle, PtyOpenResult, SessionManager, StaticAuthProvider, TofuHostKeyPolicy,
    parse_private_key_bytes, private_key_appears_encrypted,
};
pub use sftp::{
    RemoteDirEntry, RemoteFileStat, RemoteFileType, SftpSession, TransferControl, TransferProgress,
    TreeTransferProgress, TreeTransferResult,
};
pub use tunnel::{TunnelHandle, TunnelOpener, TunnelState};
