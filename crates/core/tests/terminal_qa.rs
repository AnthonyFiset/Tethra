//! Persistent-terminal QA against a REAL sshd + tmux (Docker).
//!
//! This is the layer the mock UI harness cannot exercise: the tmux
//! passthrough envelope, invisible-tmux settings, session persistence,
//! stale-session migration, and keystroke latency. Run it before shipping
//! any terminal/tmux/shell-integration change.
//!
//! ```bash
//! docker compose -f crates/core/tests/docker-compose.yml up -d --build
//! cargo test -p core --test terminal_qa -- --ignored --test-threads=1 --nocapture
//! docker compose -f crates/core/tests/docker-compose.yml down -v
//! ```
//!
//! Or just: `scripts/qa-terminal.sh`

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Once};
use std::time::{Duration, Instant};

use ssh_client_core::model::{Host, PtySize};
use ssh_client_core::ssh::{
    HostStore, InMemoryHostStore, PtyHandle, SessionManager, StaticAuthProvider,
};
use tokio::sync::mpsc::Receiver;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 2223; // openssh-tmux service (tmux + bash)
const USER: &str = "testuser";
const PASS: &str = "testpass";

const OSC_PROMPT_MARK: &str = "\u{1b}]133;A";
const OSC_CMD_START: &str = "\u{1b}]133;C";
const OSC_CMD_END: &str = "\u{1b}]133;D";
const ALT_SCREEN_ENTER: &str = "\u{1b}[?1049h";

static DOCKER_READY: Once = Once::new();

fn compose_file() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/docker-compose.yml")
}

fn ensure_sshd() {
    DOCKER_READY.call_once(|| {
        let up = Command::new("docker")
            .args(["compose", "-f"])
            .arg(compose_file())
            .args(["up", "-d", "--build", "openssh-tmux"])
            .output()
            .expect("docker compose");
        assert!(
            up.status.success(),
            "compose up failed: {}",
            String::from_utf8_lossy(&up.stderr)
        );
        let start = Instant::now();
        let mut ready = false;
        while start.elapsed() < Duration::from_secs(120) {
            if std::net::TcpStream::connect((HOST, PORT)).is_ok() {
                std::thread::sleep(Duration::from_secs(8));
                ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        assert!(ready, "sshd (tmux) not ready on {HOST}:{PORT}");
    });
}

struct Env {
    host_id: uuid::Uuid,
    mgr: SessionManager,
}

impl Env {
    async fn setup() -> Self {
        ensure_sshd();
        let hosts = Arc::new(InMemoryHostStore::new());
        let host = Host::new("terminal-qa", HOST, USER).with_port(PORT);
        let host_id = hosts.insert(host).await;
        let mgr = SessionManager::with_defaults(
            hosts as Arc<dyn HostStore>,
            Arc::new(StaticAuthProvider::password(PASS)),
        );
        Self { host_id, mgr }
    }

    async fn exec(&self, cmd: &str) -> String {
        // sshd may still be settling on the very first call.
        let mut last = None;
        for _ in 0..10 {
            match self.mgr.exec(self.host_id, cmd).await {
                Ok(out) => return String::from_utf8_lossy(&out.stdout).into_owned(),
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
        panic!("exec failed after retries: {last:?}");
    }
}

/// Drives a PTY: accumulates output, waits for patterns, sends keystrokes.
struct Pty {
    handle: PtyHandle,
    rx: Receiver<bytes::Bytes>,
    all: String,
}

impl Pty {
    async fn open(env: &Env, mux: Option<&str>) -> Self {
        let mut last = None;
        for _ in 0..10 {
            match env
                .mgr
                .open_pty_named(env.host_id, PtySize::new(120, 30), mux)
                .await
            {
                Ok(opened) => {
                    return Self {
                        handle: opened.handle,
                        rx: opened.output,
                        all: String::new(),
                    };
                }
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
        panic!("open_pty failed after retries: {last:?}");
    }

    /// Pump output until `needle` appears (anywhere in the transcript so far).
    /// Returns the transcript on success; panics with it on timeout.
    async fn wait_for(&mut self, needle: &str, timeout: Duration) -> &str {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.all.contains(needle) {
                return &self.all;
            }
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .unwrap_or_default();
            if remaining.is_zero() {
                panic!(
                    "timed out waiting for {needle:?}; transcript so far:\n{}",
                    self.all
                );
            }
            if let Ok(Some(chunk)) = tokio::time::timeout(remaining, self.rx.recv()).await {
                self.all.push_str(&String::from_utf8_lossy(&chunk));
            } else {
                panic!(
                    "PTY closed or timed out waiting for {needle:?}; transcript:\n{}",
                    self.all
                );
            }
        }
    }

    async fn send(&mut self, s: &str) {
        self.handle.write(s.as_bytes()).await.expect("pty write");
    }

    /// Run a line and wait for a sentinel it prints.
    async fn run(&mut self, line: &str, expect: &str) {
        self.send(&format!("{line}\n")).await;
        self.wait_for(expect, Duration::from_secs(15)).await;
    }

    async fn close(mut self) {
        let _ = self.handle.close().await;
        // Drain so the channel shuts down cleanly.
        while self.rx.try_recv().is_ok() {}
    }
}

fn unique(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    format!("qa-{name}-{}", nanos % 100_000_000)
}

/// Marks must reach the client THROUGH tmux (passthrough envelope), tmux
/// must stay invisible (no status bar, no alternate screen), and OSC 133
/// C/D must bracket command output — the whole block model, end to end.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn mux_marks_arrive_and_tmux_stays_invisible() {
    let env = Env::setup().await;
    let name = unique("marks");
    let mut pty = Pty::open(&env, Some(&name)).await;

    // First prompt must announce itself even though the shell starts inside tmux.
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;

    pty.run("echo tethra-qa-$((40+2))", "tethra-qa-42").await;
    pty.wait_for(OSC_CMD_END, Duration::from_secs(10)).await;

    assert!(pty.all.contains(OSC_CMD_START), "no OSC 133;C mark");
    assert!(
        !pty.all.contains(ALT_SCREEN_ENTER),
        "tmux entered the alternate screen — smcup override not applied"
    );

    // Invisibility settings actually applied on the live server.
    let status = env.exec("tmux -L tethra show -g status").await;
    assert!(status.contains("off"), "tmux status bar on: {status}");
    let passthrough = env.exec("tmux -L tethra show -g allow-passthrough").await;
    assert!(passthrough.contains("on"), "passthrough off: {passthrough}");

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// The shell must survive a disconnect: same process, same environment,
/// and the new attach must be stamped with the integration version and
/// still produce marks (fresh prompt after reattach).
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn mux_session_survives_reconnect_with_state() {
    let env = Env::setup().await;
    let name = unique("persist");

    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    pty.run("export TETHRA_QA_TOKEN=alive-77; echo set-done", "set-done")
        .await;
    pty.close().await;

    // Simulates app quit: give the server a beat, then reattach by name.
    tokio::time::sleep(Duration::from_secs(1)).await;
    let mut pty2 = Pty::open(&env, Some(&name)).await;
    // The app sends \r after reattach to request a fresh prompt; do the same.
    tokio::time::sleep(Duration::from_millis(500)).await;
    pty2.send("\r").await;
    pty2.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    pty2.run("echo token=$TETHRA_QA_TOKEN", "token=alive-77").await;

    // Version stamp present → future attaches keep this session.
    let iv = env
        .exec(&format!("tmux -L tethra show-options -qv -t {name} @tethra_iv"))
        .await;
    assert_eq!(iv.trim(), "2", "session not version-stamped: {iv:?}");

    pty2.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// A session created WITHOUT the integration (pre-fix builds, or a raw
/// `tmux new -s`) can never emit marks — attaching must replace it with a
/// working shell instead of leaving the user in a degraded session.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn stale_unversioned_session_is_replaced_on_attach() {
    let env = Env::setup().await;
    let name = unique("stale");

    // Fake a broken-build leftover: a DEFAULT-config server (no conf, no
    // stamping) holding a plain shell with no integration. Requires killing
    // any configured server other tests left behind.
    env.exec("tmux -L tethra kill-server 2>/dev/null || true").await;
    env.exec(&format!("tmux -L tethra new-session -d -s {name} || true"))
        .await;
    let before = env
        .exec(&format!("tmux -L tethra show-options -qv -t {name} @tethra_iv"))
        .await;
    assert_eq!(before.trim(), "", "precondition: stale session unstamped");

    let mut pty = Pty::open(&env, Some(&name)).await;
    // A replaced session runs the wrapper → marks flow again.
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    pty.run("echo reborn-ok", "reborn-ok").await;

    let after = env
        .exec(&format!("tmux -L tethra show-options -qv -t {name} @tethra_iv"))
        .await;
    assert_eq!(after.trim(), "2", "replacement session not stamped");

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Keystroke echo round-trip through ssh + tmux. Catches pipeline stalls
/// (buffering, per-key IPC overhead) that make typing feel laggy. Local
/// Docker, so anything above ~250ms median is a real defect in our stack.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn keystroke_echo_latency_through_tmux() {
    let env = Env::setup().await;
    let name = unique("lat");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    // Let the prompt settle so echoes are the only traffic.
    tokio::time::sleep(Duration::from_millis(500)).await;
    while pty.rx.try_recv().is_ok() {}
    pty.all.clear();

    let mut samples = Vec::new();
    let probe = "abcdefghijklmnopqrst";
    for ch in probe.chars() {
        let mark = pty.all.len();
        let t0 = Instant::now();
        pty.send(&ch.to_string()).await;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if pty.all[mark..].contains(ch) {
                samples.push(t0.elapsed());
                break;
            }
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .unwrap_or_default();
            assert!(!remaining.is_zero(), "echo for {ch:?} never arrived");
            if let Ok(Some(chunk)) = tokio::time::timeout(remaining, pty.rx.recv()).await {
                pty.all.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
    }
    samples.sort();
    let median = samples[samples.len() / 2];
    let worst = *samples.last().unwrap();
    println!("echo latency: median={median:?} worst={worst:?}");
    assert!(
        median < Duration::from_millis(250),
        "median keystroke echo {median:?} — typing pipeline is stalling"
    );

    // Clear the probe line so nothing runs.
    pty.send("\x15").await; // Ctrl-U
    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}
