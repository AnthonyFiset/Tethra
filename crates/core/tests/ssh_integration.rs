//! Integration tests against `linuxserver/openssh-server`.
//!
//! Locally:
//! ```bash
//! docker compose -f crates/core/tests/docker-compose.yml up -d
//! cargo test -p core --test ssh_integration -- --ignored --test-threads=1 --nocapture
//! docker compose -f crates/core/tests/docker-compose.yml down -v
//! ```

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Once};
use std::time::Duration;

use ssh_client_core::model::{Host, KnownHostKey, PtySize};
use ssh_client_core::ssh::{
    AlwaysDeny, ApprovalGate, HostKeyDecision, HostKeyPolicy, HostStore, InMemoryHostStore,
    PresentedHostKey, SessionManager, StaticAuthProvider, TofuHostKeyPolicy,
};
use ssh_client_core::{Error, Result};
use tokio::time::sleep;
use uuid::Uuid;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 2222;
const USER: &str = "testuser";
const PASS: &str = "testpass";

static DOCKER_READY: Once = Once::new();

fn docker_available() -> bool {
    Command::new("docker")
        .arg("info")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn compose_file() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/docker-compose.yml")
}

fn compose(args: &[&str]) -> std::process::Output {
    Command::new("docker")
        .arg("compose")
        .arg("-f")
        .arg(compose_file())
        .args(args)
        .output()
        .expect("failed to run docker compose")
}

fn ensure_sshd() {
    DOCKER_READY.call_once(|| {
        assert!(docker_available(), "docker is required for ignored tests");
        let up = compose(&["up", "-d"]);
        assert!(
            up.status.success(),
            "compose up failed: {}",
            String::from_utf8_lossy(&up.stderr)
        );

        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(90);
        let mut ready = false;
        while start.elapsed() < timeout {
            if std::net::TcpStream::connect((HOST, PORT)).is_ok() {
                // linuxserver image needs time after the port opens.
                std::thread::sleep(Duration::from_secs(8));
                ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        assert!(ready, "sshd did not become ready on {HOST}:{PORT}");
    });
}

struct TestEnv {
    hosts: Arc<InMemoryHostStore>,
    host_id: Uuid,
}

impl TestEnv {
    async fn setup() -> Self {
        ensure_sshd();
        let hosts = Arc::new(InMemoryHostStore::new());
        let host = Host::new("integration", HOST, USER).with_port(PORT);
        let host_id = hosts.insert(host).await;
        Self { hosts, host_id }
    }

    fn manager_password(&self) -> SessionManager {
        SessionManager::with_defaults(
            Arc::clone(&self.hosts) as Arc<dyn HostStore>,
            Arc::new(StaticAuthProvider::password(PASS)),
        )
    }
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn password_exec_stdout_stderr_exit() {
    let env = TestEnv::setup().await;
    let mgr = env.manager_password();

    // Retry briefly — sshd can still be settling after the port opens.
    let mut last_err = None;
    let mut ok = None;
    for _ in 0..10 {
        match mgr.exec(env.host_id, "echo hello-stdout").await {
            Ok(r) => {
                ok = Some(r);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
    let ok = ok.unwrap_or_else(|| panic!("exec failed after retries: {last_err:?}"));
    assert_eq!(String::from_utf8_lossy(&ok.stdout).trim(), "hello-stdout");
    assert_eq!(ok.exit_code, 0);

    let fail = mgr
        .exec(env.host_id, "/bin/sh -c 'echo hello-stderr 1>&2; exit 42'")
        .await
        .expect("exec fail");
    assert!(
        String::from_utf8_lossy(&fail.stderr).contains("hello-stderr"),
        "stderr={}",
        String::from_utf8_lossy(&fail.stderr)
    );
    assert_eq!(
        fail.exit_code,
        42,
        "stdout={} stderr={}",
        String::from_utf8_lossy(&fail.stdout),
        String::from_utf8_lossy(&fail.stderr)
    );
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn pty_echo_and_resize() {
    let env = TestEnv::setup().await;
    let mgr = env.manager_password();

    let (mut pty, mut rx) = mgr
        .open_pty(env.host_id, PtySize::new(80, 24))
        .await
        .expect("pty");

    let _ = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await;
    pty.write(b"echo pty-ok\n").await.expect("write");

    let mut collected = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while tokio::time::Instant::now() < deadline {
        if let Ok(Some(chunk)) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            collected.extend_from_slice(&chunk);
            if String::from_utf8_lossy(&collected).contains("pty-ok") {
                break;
            }
        }
    }
    assert!(
        String::from_utf8_lossy(&collected).contains("pty-ok"),
        "missing pty output: {}",
        String::from_utf8_lossy(&collected)
    );

    pty.resize(PtySize::new(120, 40)).await.expect("resize");
    pty.close().await.expect("close");
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn sftp_list_get_put() {
    let env = TestEnv::setup().await;
    let mgr = env.manager_password();
    let sftp = mgr.sftp(env.host_id).await.expect("sftp");

    let entries = sftp.list(".").await.expect("list");
    assert!(!entries.is_empty(), "expected at least . or files");

    let dir = tempfile::tempdir().expect("tempdir");
    let local_upload = dir.path().join("upload.txt");
    let local_download = dir.path().join("download.txt");
    std::fs::write(&local_upload, b"sftp-payload").expect("write");

    let remote = "upload.txt";
    sftp.put(&local_upload, remote).await.expect("put");
    sftp.get(remote, &local_download).await.expect("get");
    let got = std::fs::read(&local_download).expect("read");
    assert_eq!(got, b"sftp-payload");

    sftp.close().await.expect("close");
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn sftp_mkdir_rename_remove() {
    use ssh_client_core::ssh::{RemoteFileType, TransferControl};

    let env = TestEnv::setup().await;
    let mgr = env.manager_password();
    let sftp = mgr.sftp(env.host_id).await.expect("sftp");

    sftp.mkdir("m5-dir").await.expect("mkdir");
    let entries = sftp.list(".").await.expect("list");
    assert!(
        entries
            .iter()
            .any(|e| e.name == "m5-dir" && e.file_type == RemoteFileType::Dir)
    );

    sftp.rename("m5-dir", "m5-renamed").await.expect("rename");
    let stat = sftp.stat("m5-renamed").await.expect("stat");
    assert_eq!(stat.file_type, RemoteFileType::Dir);

    let dir = tempfile::tempdir().expect("tempdir");
    let local = dir.path().join("note.txt");
    std::fs::write(&local, b"hello").expect("write");
    sftp.put(&local, "m5-renamed/note.txt").await.expect("put");

    sftp.remove_file("m5-renamed/note.txt")
        .await
        .expect("remove file");
    sftp.remove_dir("m5-renamed").await.expect("remove dir");
    assert!(
        !sftp
            .list(".")
            .await
            .expect("list")
            .iter()
            .any(|e| e.name == "m5-renamed")
    );

    sftp.close().await.expect("close");
    let _ = TransferControl::new();
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn sftp_transfer_progress_cancel_and_resume() {
    use ssh_client_core::ssh::{TransferControl, TransferProgress};

    let env = TestEnv::setup().await;
    let mgr = env.manager_password();
    let sftp = mgr.sftp(env.host_id).await.expect("sftp");

    let dir = tempfile::tempdir().expect("tempdir");
    let local_src = dir.path().join("big.bin");
    let local_dst = dir.path().join("big.out");
    let payload = vec![0xABu8; 1024 * 1024];
    std::fs::write(&local_src, &payload).expect("write");

    let mut last_progress = TransferProgress::default();
    sftp.put_with(
        &local_src,
        "big.bin",
        0,
        &TransferControl::new(),
        |progress| {
            last_progress = progress;
            Ok(())
        },
    )
    .await
    .expect("put");
    assert_eq!(last_progress.bytes_transferred, payload.len() as u64);

    let control = TransferControl::new();
    let cancel = control.clone();
    let download_path = local_dst.clone();
    let host_id = env.host_id;
    let mgr_cancel = env.manager_password();
    let task = tokio::spawn(async move {
        let sftp = mgr_cancel.sftp(host_id).await.expect("sftp");
        sftp.get_with("big.bin", &download_path, 0, &cancel, |_| Ok(()))
            .await
    });
    control.cancel();
    let err = task.await.expect("join").expect_err("cancelled");
    assert!(matches!(err, Error::TransferCancelled));

    let partial = std::fs::metadata(&local_dst).map(|m| m.len()).unwrap_or(0);
    assert!(partial < payload.len() as u64);

    let sftp2 = mgr.sftp(env.host_id).await.expect("sftp resume");
    sftp2
        .get_with(
            "big.bin",
            &local_dst,
            partial,
            &TransferControl::new(),
            |_| Ok(()),
        )
        .await
        .expect("resume");
    let got = std::fs::read(&local_dst).expect("read");
    assert_eq!(got, payload);
    sftp2.close().await.expect("close");
    sftp.close().await.expect("close");
}

#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn host_key_mismatch_refused() {
    let env = TestEnv::setup().await;

    let mgr = env.manager_password();
    let _ = mgr.exec(env.host_id, "true").await.expect("first connect");

    let host = env.hosts.get(env.host_id).await.expect("host");
    assert!(host.known_host_key.is_some());

    env.hosts
        .set_known_host_key(
            env.host_id,
            KnownHostKey {
                algorithm: "ssh-ed25519".into(),
                fingerprint_sha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into(),
                openssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialHere0000000000000"
                    .into(),
            },
        )
        .await
        .expect("poison");

    let err = mgr
        .exec(env.host_id, "true")
        .await
        .expect_err("should refuse mismatch");
    assert!(
        matches!(err, Error::HostKeyMismatch { .. }),
        "unexpected error: {err:?}"
    );
}

#[tokio::test]
async fn approval_gate_denies_without_network() {
    let hosts = Arc::new(InMemoryHostStore::new());
    let host_id = hosts
        .insert(Host::new("x", "127.0.0.1", "u").with_port(1))
        .await;
    let mgr = SessionManager::new(
        hosts as Arc<dyn HostStore>,
        Arc::new(StaticAuthProvider::password("x")),
        Arc::new(TofuHostKeyPolicy),
        Arc::new(AlwaysDeny) as Arc<dyn ApprovalGate>,
    );
    let err = mgr.exec(host_id, "true").await.expect_err("denied");
    assert!(matches!(err, Error::ApprovalDenied));
}

#[tokio::test]
async fn reject_policy_blocks_unknown_key() {
    struct RejectAll;
    #[async_trait::async_trait]
    impl HostKeyPolicy for RejectAll {
        async fn decide(
            &self,
            _host_id: Uuid,
            _presented: &PresentedHostKey,
            _known: Option<&KnownHostKey>,
        ) -> Result<HostKeyDecision> {
            Ok(HostKeyDecision::Reject)
        }
    }

    let policy = RejectAll;
    let presented = PresentedHostKey {
        algorithm: "ssh-ed25519".into(),
        fingerprint_sha256: "abc".into(),
        openssh: "ssh-ed25519 AAA".into(),
    };
    let decision = policy
        .decide(Uuid::nil(), &presented, None)
        .await
        .expect("decide");
    assert_eq!(decision, HostKeyDecision::Reject);
}
