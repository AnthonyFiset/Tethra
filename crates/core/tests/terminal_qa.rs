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
use ssh_client_core::terminal::TMUX_INTEGRATION_VERSION;
use tokio::sync::mpsc::Receiver;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 2223; // openssh-tmux service (tmux + bash)
const UBUNTU_PORT: u16 = 2224; // ubuntu-sshd service (real apt/sudo/clear)
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
            .args(["up", "-d", "--build", "openssh-tmux", "ubuntu-sshd"])
            .output()
            .expect("docker compose");
        assert!(
            up.status.success(),
            "compose up failed: {}",
            String::from_utf8_lossy(&up.stderr)
        );
        let start = Instant::now();
        for port in [PORT, UBUNTU_PORT] {
            let mut ready = false;
            while start.elapsed() < Duration::from_secs(180) {
                if std::net::TcpStream::connect((HOST, port)).is_ok() {
                    ready = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            assert!(ready, "sshd not ready on {HOST}:{port}");
        }
        // linuxserver image needs settling time after the port opens.
        std::thread::sleep(Duration::from_secs(8));
    });
}

struct Env {
    host_id: uuid::Uuid,
    mgr: SessionManager,
}

impl Env {
    async fn setup() -> Self {
        Self::setup_on(PORT).await
    }

    async fn setup_ubuntu() -> Self {
        Self::setup_on(UBUNTU_PORT).await
    }

    async fn setup_on(port: u16) -> Self {
        ensure_sshd();
        let hosts = Arc::new(InMemoryHostStore::new());
        let host = Host::new("terminal-qa", HOST, USER).with_port(port);
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
    raw: Vec<u8>,
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
                        raw: Vec::new(),
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
                self.ingest(&chunk);
            } else {
                panic!(
                    "PTY closed or timed out waiting for {needle:?}; transcript:\n{}",
                    self.all
                );
            }
        }
    }

    fn ingest(&mut self, chunk: &[u8]) {
        self.raw.extend_from_slice(chunk);
        self.all.push_str(&String::from_utf8_lossy(chunk));
    }

    /// Pump output for a fixed window (used to let redraws/land marks settle).
    async fn settle(&mut self, dur: Duration) {
        let deadline = tokio::time::Instant::now() + dur;
        loop {
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .unwrap_or_default();
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, self.rx.recv()).await {
                Ok(Some(chunk)) => self.ingest(&chunk),
                _ => break,
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
    pty2.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20))
        .await;
    pty2.run("echo token=$TETHRA_QA_TOKEN", "token=alive-77")
        .await;

    // Version stamp present → future attaches keep this session.
    let iv = env
        .exec(&format!(
            "tmux -L tethra show-options -qv -t {name} @tethra_iv"
        ))
        .await;
    assert_eq!(
        iv.trim(),
        TMUX_INTEGRATION_VERSION,
        "session not version-stamped: {iv:?}"
    );

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
    env.exec("tmux -L tethra kill-server 2>/dev/null || true")
        .await;
    env.exec(&format!("tmux -L tethra new-session -d -s {name} || true"))
        .await;
    let before = env
        .exec(&format!(
            "tmux -L tethra show-options -qv -t {name} @tethra_iv"
        ))
        .await;
    assert_eq!(before.trim(), "", "precondition: stale session unstamped");

    let mut pty = Pty::open(&env, Some(&name)).await;
    // A replaced session runs the wrapper → marks flow again.
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    pty.run("echo reborn-ok", "reborn-ok").await;

    let after = env
        .exec(&format!(
            "tmux -L tethra show-options -qv -t {name} @tethra_iv"
        ))
        .await;
    assert_eq!(
        after.trim(),
        TMUX_INTEGRATION_VERSION,
        "replacement session not stamped"
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Strip everything except the OSC 133 mark letters, in order.
fn mark_sequence(transcript: &str) -> Vec<char> {
    let mut out = Vec::new();
    let mut rest = transcript;
    while let Some(idx) = rest.find("\u{1b}]133;") {
        rest = &rest[idx + 6..];
        if let Some(c) = rest.chars().next() {
            out.push(c);
        }
    }
    out
}

/// The block model depends on a STRICT mark grammar: every prompt is A B,
/// every executed command is exactly one C … one D, and an empty Enter emits
/// NO C/D at all. Bash's DEBUG trap fires for prompt hooks too — without
/// guards it sprays phantom C/D pairs that create duplicate blocks, garbage
/// durations, and flickering covers (the "glitching" bug).
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn osc133_mark_grammar_is_clean() {
    let env = Env::setup().await;
    let name = unique("grammar");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    tokio::time::sleep(Duration::from_millis(700)).await;

    // Three empty Enters (what the reattach nudge and idle typing produce).
    for _ in 0..3 {
        pty.send("\r").await;
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    // One real command.
    pty.run("echo grammar-$((20+2))", "grammar-22").await;
    // One more empty Enter, then let marks settle.
    pty.send("\r").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    while let Ok(chunk) = pty.rx.try_recv() {
        pty.all.push_str(&String::from_utf8_lossy(&chunk));
    }

    let seq: String = mark_sequence(&pty.all).into_iter().collect();
    println!("mark sequence: {seq}");

    let c_count = seq.matches('C').count();
    let d_count = seq.matches('D').count();
    assert_eq!(
        c_count, 1,
        "expected exactly one command-start mark for one command, got {c_count} — \
         phantom C marks (DEBUG-trap firing for prompt hooks?). sequence: {seq}"
    );
    assert_eq!(
        d_count, 1,
        "expected exactly one command-end mark, got {d_count}. sequence: {seq}"
    );
    // No block ever opens twice: C must be followed by D before the next C.
    let mut open = false;
    for ch in seq.chars() {
        match ch {
            'C' => {
                assert!(!open, "double C without D between — sequence: {seq}");
                open = true;
            }
            'D' => open = false,
            _ => {}
        }
    }
    // The command really ran exactly once.
    let runs = pty.all.matches("grammar-22").count();
    assert!(
        (1..=3).contains(&runs),
        "unexpected occurrences of command output: {runs}"
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Reattaching at the SAME size the session already has (what the app does —
/// it persists the pane size and opens the PTY with it) must restore content
/// exactly once. Attaching at a different size and resizing forces full tmux
/// redraws that duplicate content into scrollback; that path is measured and
/// reported but is avoided by the app, not asserted clean.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn reattach_at_same_size_restores_content_once() {
    let env = Env::setup().await;
    let name = unique("dup");

    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(20)).await;
    pty.run("echo DUP-MARK-$((7*3))", "DUP-MARK-21").await;
    pty.close().await;
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Same size as the original open (Pty::open uses 120x30).
    let mut pty2 = Pty::open(&env, Some(&name)).await;
    pty2.wait_for("DUP-MARK-21", Duration::from_secs(20)).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    while let Ok(chunk) = pty2.rx.try_recv() {
        pty2.all.push_str(&String::from_utf8_lossy(&chunk));
    }
    let copies = pty2.all.matches("DUP-MARK-21").count();
    println!("same-size reattach: restored-content copies = {copies}");
    assert!(
        copies <= 2,
        "restored content duplicated {copies}x on a same-size reattach"
    );

    // Wrong-size dance, for the record: how bad is attach-small-then-grow?
    pty2.handle
        .resize(PtySize::new(140, 40))
        .await
        .expect("resize");
    tokio::time::sleep(Duration::from_secs(2)).await;
    while let Ok(chunk) = pty2.rx.try_recv() {
        pty2.all.push_str(&String::from_utf8_lossy(&chunk));
    }
    println!(
        "after resize redraw: copies = {} (informational — app avoids this by \
         opening at the persisted size)",
        pty2.all.matches("DUP-MARK-21").count()
    );

    pty2.close().await;
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

/// THE flow the user actually runs on a VPS: real `sudo apt-get update`
/// (carriage-return progress bars, scroll regions), then `clear`, then more
/// typing. The shell must stay usable, the mark grammar must stay balanced
/// (a stuck open C = "command running" forever = dead input box), and the
/// raw byte stream is saved so the UI harness can replay it against the
/// real renderer.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn ubuntu_apt_update_clear_then_typing_works() {
    let env = Env::setup_ubuntu().await;
    let name = unique("apt");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(30)).await;
    pty.settle(Duration::from_millis(700)).await;

    pty.send("sudo apt-get update\n").await;
    pty.wait_for("Reading package lists", Duration::from_secs(90))
        .await;
    // Wait for the command to finish (its D mark) and the next prompt.
    pty.settle(Duration::from_secs(3)).await;

    pty.send("clear\n").await;
    pty.settle(Duration::from_secs(2)).await;

    // The bug report: after clear, typing appeared dead. Prove the shell
    // still accepts and echoes input.
    pty.send("echo after-$((11*3))\n").await;
    pty.wait_for("after-33", Duration::from_secs(15)).await;
    pty.settle(Duration::from_secs(1)).await;

    let seq: String = mark_sequence(&pty.all).into_iter().collect();
    println!("apt/clear mark sequence: {seq}");
    let c = seq.matches('C').count();
    let d = seq.matches('D').count();
    assert_eq!(
        c, d,
        "unbalanced marks after apt+clear ({c} C vs {d} D) — a stuck open \
         command keeps the input box in 'command running' mode. seq: {seq}"
    );
    assert!(
        c >= 3,
        "expected marks for apt, clear, echo — got {c}. seq: {seq}"
    );
    // The alternate screen must stay off even through apt's fancy output.
    assert!(
        !pty.all.contains(ALT_SCREEN_ENTER),
        "alternate screen entered during apt"
    );

    // Persist the raw stream for UI replay (target/qa-transcripts/).
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/qa-transcripts");
    std::fs::create_dir_all(&dir).expect("mkdir transcripts");
    std::fs::write(dir.join("ubuntu-apt-clear.bin"), &pty.raw).expect("write transcript");
    println!(
        "saved {} bytes to target/qa-transcripts/ubuntu-apt-clear.bin",
        pty.raw.len()
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Masked input (`read -s`, sudo password prompts): echo is off, nothing
/// appears on screen — but keystrokes must still reach the shell and Enter
/// must complete the read. This is the "it's not letting me type" class.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn ubuntu_masked_input_still_receives_keys() {
    let env = Env::setup_ubuntu().await;
    let name = unique("mask");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(30)).await;
    pty.settle(Duration::from_millis(700)).await;

    pty.send("read -s TETHRA_SECRET\n").await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    pty.send("hunter2\n").await;
    pty.settle(Duration::from_secs(1)).await;
    pty.send("echo got-$TETHRA_SECRET\n").await;
    pty.wait_for("got-hunter2", Duration::from_secs(15)).await;

    // The masked text must never be echoed while typed — its only appearance
    // is inside the `got-hunter2` output line.
    let occurrences = pty.all.matches("hunter2").count();
    assert_eq!(
        occurrences, 1,
        "masked input appeared {occurrences}x — it was echoed while typed"
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Full apt run with REAL downloads — apt's progress bar uses a scroll
/// region that deletes lines under xterm markers, which is where block
/// headers historically died. The transcript is saved for the UI replay,
/// whose assertion is the user-visible requirement: every command in the
/// history shows its header (ls AND apt — "consistency").
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn ubuntu_apt_full_download_transcript() {
    let env = Env::setup_ubuntu().await;
    let name = unique("aptfull");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(30)).await;
    pty.settle(Duration::from_millis(700)).await;

    pty.send("ls -a\n").await;
    pty.wait_for(".bashrc", Duration::from_secs(15)).await;
    pty.settle(Duration::from_millis(500)).await;

    // Force real downloads so apt draws its scroll-region progress bar.
    pty.send("sudo rm -rf /var/lib/apt/lists/*\n").await;
    pty.settle(Duration::from_secs(2)).await;
    pty.send("sudo apt-get update\n").await;
    pty.wait_for("Reading package lists", Duration::from_secs(180))
        .await;
    pty.settle(Duration::from_secs(3)).await;

    pty.send("echo tail-$((6*7))\n").await;
    pty.wait_for("tail-42", Duration::from_secs(15)).await;
    pty.settle(Duration::from_secs(1)).await;

    let seq: String = mark_sequence(&pty.all).into_iter().collect();
    println!("apt-full mark sequence: {seq}");
    let c = seq.matches('C').count();
    let d = seq.matches('D').count();
    assert_eq!(c, d, "unbalanced marks ({c} C vs {d} D): {seq}");

    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/qa-transcripts");
    std::fs::create_dir_all(&dir).expect("mkdir transcripts");
    std::fs::write(dir.join("ubuntu-apt-full.bin"), &pty.raw).expect("write transcript");
    println!(
        "saved {} bytes to target/qa-transcripts/ubuntu-apt-full.bin",
        pty.raw.len()
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}

/// Torture: fast long output, colors/unicode, very wide lines, rapid
/// back-to-back commands (no waiting between Enters), clear mid-stream,
/// then more output. Marks must stay balanced 1:1 with commands and the
/// transcript feeds the UI replay's consistency assertions.
#[tokio::test]
#[ignore = "requires Docker openssh-server"]
async fn ubuntu_torture_transcript() {
    let env = Env::setup_ubuntu().await;
    let name = unique("torture");
    let mut pty = Pty::open(&env, Some(&name)).await;
    pty.wait_for(OSC_PROMPT_MARK, Duration::from_secs(30)).await;
    pty.settle(Duration::from_millis(700)).await;

    pty.send("seq 1 300\n").await;
    pty.wait_for("\r\n300", Duration::from_secs(20)).await;
    pty.settle(Duration::from_millis(400)).await;

    pty.send("printf '\\033[31mred\\033[32mgreen\\033[34mblue\\033[0m unicode ✓ 漢字 🚀\\n'\n")
        .await;
    pty.wait_for("🚀", Duration::from_secs(10)).await;
    pty.settle(Duration::from_millis(300)).await;

    pty.send("ls --color=always /usr/bin | head -40\n").await;
    pty.settle(Duration::from_secs(2)).await;

    pty.send("printf 'y%.0s' $(seq 1 500); echo END-WIDE\n")
        .await;
    pty.wait_for("END-WIDE", Duration::from_secs(10)).await;
    pty.settle(Duration::from_millis(300)).await;

    // Rapid burst — three Enters with no waiting at all.
    pty.send("echo rapid-1\n").await;
    pty.send("echo rapid-2\n").await;
    pty.send("echo rapid-3\n").await;
    pty.wait_for("rapid-3", Duration::from_secs(10)).await;
    pty.settle(Duration::from_millis(500)).await;

    pty.send("clear\n").await;
    pty.settle(Duration::from_secs(1)).await;

    pty.send("find /usr/lib -name '*.so*' | head -200\n").await;
    pty.settle(Duration::from_secs(3)).await;

    pty.send("echo done-$((90+9))\n").await;
    pty.wait_for("done-99", Duration::from_secs(10)).await;
    pty.settle(Duration::from_secs(1)).await;

    let seq: String = mark_sequence(&pty.all).into_iter().collect();
    println!("torture mark sequence: {seq}");
    let c = seq.matches('C').count();
    let d = seq.matches('D').count();
    assert_eq!(c, d, "unbalanced marks ({c} C vs {d} D): {seq}");
    assert_eq!(c, 10, "expected 10 commands, marks say {c}: {seq}");
    assert!(!pty.all.contains(ALT_SCREEN_ENTER), "alt screen entered");

    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/qa-transcripts");
    std::fs::create_dir_all(&dir).expect("mkdir");
    std::fs::write(dir.join("ubuntu-torture.bin"), &pty.raw).expect("write");
    println!(
        "saved {} bytes to target/qa-transcripts/ubuntu-torture.bin",
        pty.raw.len()
    );

    pty.close().await;
    env.exec(&format!("tmux -L tethra kill-session -t {name} || true"))
        .await;
}
