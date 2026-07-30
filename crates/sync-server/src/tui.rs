//! Live status TUI while the HTTP server runs.

use std::io::{self, Stdout};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use tokio::sync::watch;

use crate::config::Config;
use crate::server::{Metrics, serve};
use crate::service;
use crate::setup::{mask_token, print_client_block};

struct UiState {
    show_token: bool,
    health_ok: bool,
    started: SystemTime,
}

pub async fn run(config: Config) -> Result<(), String> {
    if !stdio_is_tty() {
        let metrics = Arc::new(Metrics::default());
        return serve_until_ctrl_c_simple(config, metrics).await;
    }

    print_client_block(&config);

    let metrics = Arc::new(Metrics::default());
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_config = config.clone();
    let server_metrics = Arc::clone(&metrics);
    let server_task =
        tokio::spawn(async move { serve(server_config, server_metrics, shutdown_rx).await });

    // Give the listener a moment to bind before drawing "listening".
    tokio::time::sleep(Duration::from_millis(50)).await;

    let result = run_tui(&config, Arc::clone(&metrics), shutdown_tx).await;

    let server_result = server_task.await.map_err(|e| format!("server task: {e}"))?;
    result.and(server_result)
}

async fn serve_until_ctrl_c_simple(config: Config, metrics: Arc<Metrics>) -> Result<(), String> {
    crate::server::serve_until_ctrl_c(config, metrics).await
}

fn stdio_is_tty() -> bool {
    crossterm::tty::IsTty::is_tty(&io::stdout()) && crossterm::tty::IsTty::is_tty(&io::stdin())
}

async fn run_tui(
    config: &Config,
    metrics: Arc<Metrics>,
    shutdown_tx: watch::Sender<bool>,
) -> Result<(), String> {
    enable_raw_mode().map_err(|e| format!("raw mode: {e}"))?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).map_err(|e| format!("enter screen: {e}"))?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|e| format!("terminal: {e}"))?;

    let mut ui = UiState {
        show_token: false,
        health_ok: false,
        started: SystemTime::now(),
    };

    let run_result = tui_loop(&mut terminal, config, &metrics, &mut ui, &shutdown_tx).await;

    disable_raw_mode().ok();
    execute!(terminal.backend_mut(), LeaveAlternateScreen).ok();
    terminal.show_cursor().ok();

    let _ = shutdown_tx.send(true);
    run_result
}

async fn tui_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    config: &Config,
    metrics: &Metrics,
    ui: &mut UiState,
    shutdown_tx: &watch::Sender<bool>,
) -> Result<(), String> {
    let mut interval = tokio::time::interval(Duration::from_millis(250));
    loop {
        interval.tick().await;

        ui.health_ok = check_health(config).await;

        terminal
            .draw(|frame| draw(frame, config, metrics, ui))
            .map_err(|e| format!("draw: {e}"))?;

        while event::poll(Duration::from_millis(0)).map_err(|e| format!("poll: {e}"))? {
            if let Event::Key(key) = event::read().map_err(|e| format!("read: {e}"))? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => {
                        let _ = shutdown_tx.send(true);
                        return Ok(());
                    }
                    KeyCode::Char('t') => ui.show_token = !ui.show_token,
                    KeyCode::Char('r') => ui.health_ok = check_health(config).await,
                    _ => {}
                }
            }
        }

        if *shutdown_tx.borrow() {
            return Ok(());
        }
    }
}

async fn check_health(config: &Config) -> bool {
    let Ok(addr) = config.listen_addr() else {
        return false;
    };
    let url = format!("http://{addr}/healthz");
    // Prefer loopback if bound to 0.0.0.0
    let url = if addr.ip().is_unspecified() {
        format!("http://127.0.0.1:{}/healthz", addr.port())
    } else {
        url
    };
    match tokio::time::timeout(Duration::from_millis(200), async {
        // Minimal GET without pulling in reqwest — use tokio TcpStream + write.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpStream;
        let host = if addr.ip().is_unspecified() {
            format!("127.0.0.1:{}", addr.port())
        } else {
            addr.to_string()
        };
        let mut stream = TcpStream::connect(&host).await.ok()?;
        let req = format!("GET /healthz HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = [0u8; 128];
        let n = stream.read(&mut buf).await.ok()?;
        let text = String::from_utf8_lossy(&buf[..n]);
        Some(text.contains("200"))
    })
    .await
    {
        Ok(Some(true)) => true,
        _ => {
            let _ = url; // silence if unused in some builds
            false
        }
    }
}

fn draw(frame: &mut ratatui::Frame<'_>, config: &Config, metrics: &Metrics, ui: &UiState) {
    let snap = metrics.snapshot();
    let client_url = config
        .client_url
        .clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", config.port().unwrap_or(8787)));
    let token_display = if ui.show_token {
        config.token.clone()
    } else {
        format!("{} (press t to reveal)", mask_token(&config.token))
    };
    let health = if ui.health_ok { "ok" } else { "unreachable" };
    let last = format_last_activity(snap.last_activity_ms, snap.last_kind_label());
    let uptime = format_uptime(ui.started);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(12), Constraint::Length(3)])
        .split(frame.area());

    let body = vec![
        Line::from(vec![
            Span::styled("Status     ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(if ui.health_ok {
                "listening"
            } else {
                "starting…"
            }),
        ]),
        Line::from(vec![
            Span::styled("Listen     ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(&config.listen),
        ]),
        Line::from(vec![
            Span::styled("Client URL ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(client_url),
        ]),
        Line::from(vec![
            Span::styled("Token      ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(token_display),
        ]),
        Line::from(vec![
            Span::styled("Data       ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(config.data_dir.display().to_string()),
        ]),
        Line::from(vec![
            Span::styled("Health     ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(health),
        ]),
        Line::from(vec![
            Span::styled("Requests   ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(format!(
                "pull {}  push {}  header {}/{}",
                snap.pull, snap.push, snap.header_get, snap.header_put
            )),
        ]),
        Line::from(vec![
            Span::styled("Last       ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(last),
        ]),
        Line::from(vec![
            Span::styled("Service    ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(service::service_label()),
        ]),
        Line::from(vec![
            Span::styled("Uptime     ", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(uptime),
        ]),
    ];

    let block = Block::default()
        .title(" Tethra sync server ")
        .borders(Borders::ALL);
    frame.render_widget(Paragraph::new(body).block(block), chunks[0]);

    let help = Paragraph::new("q quit · t toggle token · r refresh health")
        .block(Block::default().borders(Borders::ALL).title(" Keys "));
    frame.render_widget(help, chunks[1]);
}

fn format_last_activity(ms: u64, kind: &str) -> String {
    if ms == 0 {
        return "none yet".into();
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(ms);
    let ago_ms = now.saturating_sub(ms);
    let ago = if ago_ms < 1000 {
        format!("{ago_ms}ms ago")
    } else if ago_ms < 60_000 {
        format!("{}s ago", ago_ms / 1000)
    } else {
        format!("{}m ago", ago_ms / 60_000)
    };
    format!("{kind} {ago}")
}

fn format_uptime(started: SystemTime) -> String {
    let Ok(elapsed) = started.elapsed() else {
        return "?".into();
    };
    let secs = elapsed.as_secs();
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
    }
}
