//! Native application menu (M12.5).
//!
//! macOS gets a full bar wired to `menu-command` events the UI handles.
//! Windows/Linux keep About + Quit only — commands live in the titlebar overflow
//! and command palette (no fake macOS menu bar).

use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::menu::{MenuItemBuilder, PredefinedMenuItem};
use tauri::{App, AppHandle, Emitter, Runtime};

/// Build the platform menu. Callers must register [`wire_menu_events`].
pub fn build<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let version = app.package_info().version.to_string();
    let about = AboutMetadataBuilder::new()
        .name(Some("Tethra"))
        .version(Some(version))
        .comments(Some(
            "Private, cross-platform SSH and SFTP workspace with an encrypted vault.",
        ))
        .website(Some("https://github.com/AnthonyFiset/Tethra"))
        .icon(app.default_window_icon().cloned())
        .build();

    #[cfg(target_os = "macos")]
    {
        build_macos(app, about)
    }

    #[cfg(not(target_os = "macos"))]
    {
        // No full menu bar on Windows/Linux — overflow + palette are the entry points.
        let file = SubmenuBuilder::new(app, "File")
            .about_with_text("About Tethra", Some(about))
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app).item(&file).build()
    }
}

#[cfg(target_os = "macos")]
fn build_macos<R: Runtime>(
    app: &App<R>,
    about: tauri::menu::AboutMetadata<'_>,
) -> tauri::Result<Menu<R>> {
    let item = |id: &str, title: &str, accel: Option<&str>| -> tauri::Result<_> {
        let mut builder = MenuItemBuilder::with_id(id, title);
        if let Some(a) = accel {
            builder = builder.accelerator(a);
        }
        builder.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Tethra")
        .about_with_text("About Tethra", Some(about))
        .separator()
        .item(&item("app.settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .item(&item("app.lock", "Lock Vault", Some("CmdOrCtrl+Shift+L"))?)
        .item(&item("app.check_updates", "Check for Updates…", None)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(
            "file.new_terminal",
            "New Terminal Tab",
            Some("CmdOrCtrl+T"),
        )?)
        .item(&item(
            "file.new_local",
            "New Local Tab",
            Some("CmdOrCtrl+Shift+T"),
        )?)
        .item(&item("file.new_window", "New Window", Some("CmdOrCtrl+N"))?)
        .separator()
        .item(&item(
            "file.open_project",
            "Open Project…",
            Some("CmdOrCtrl+O"),
        )?)
        .item(&item("file.import_ssh", "Import ~/.ssh/config…", None)?)
        .separator()
        .item(&item("file.close_tab", "Close Tab", Some("CmdOrCtrl+W"))?)
        .build()?;

    // Custom Copy/Paste so terminal selections (xterm) work; predefined
    // items only copy the WebView's empty textarea selection.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .item(&item("edit.copy", "Copy", Some("CmdOrCtrl+C"))?)
        .item(&item("edit.paste", "Paste", Some("CmdOrCtrl+V"))?)
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(
            "view.toggle_sidebar",
            "Toggle Sidebar",
            Some("CmdOrCtrl+B"),
        )?)
        .item(&item(
            "view.launcher",
            "Launcher",
            Some("CmdOrCtrl+Escape"),
        )?)
        .separator()
        .item(&item(
            "view.split_right",
            "Split Right",
            Some("CmdOrCtrl+\\"),
        )?)
        .item(&item(
            "view.split_down",
            "Split Down",
            Some("CmdOrCtrl+Shift+\\"),
        )?)
        .item(&item(
            "view.zoom_pane",
            "Zoom Pane",
            Some("CmdOrCtrl+Shift+Enter"),
        )?)
        .build()?;

    let terminal = SubmenuBuilder::new(app, "Terminal")
        .item(&item("terminal.clear", "Clear", Some("CmdOrCtrl+Shift+K"))?)
        .item(&item("terminal.reset", "Reset", None)?)
        .separator()
        .item(&item("terminal.assist", "Assist", Some("CmdOrCtrl+I"))?)
        .item(&item("terminal.rerun_last", "Rerun Last Block", None)?)
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&item("go.palette", "Command Palette", Some("CmdOrCtrl+K"))?)
        .separator()
        .item(&item("go.next_tab", "Next Tab", Some("Ctrl+Tab"))?)
        .item(&item(
            "go.prev_tab",
            "Previous Tab",
            Some("Ctrl+Shift+Tab"),
        )?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some("Close Window"),
        )?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help.docs", "Documentation", None)?)
        .item(&item("help.shortcuts", "Keyboard Shortcuts", None)?)
        .separator()
        .item(&item("help.issue", "Report an Issue", None)?)
        .item(&item("help.release_notes", "Release Notes", None)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&terminal)
        .item(&go)
        .item(&window)
        .item(&help)
        .build()
}

/// Forward custom menu item IDs to the frontend as `menu-command` events.
pub fn wire_menu_events<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.on_menu_event(move |_app, event| {
        let id = event.id().0.clone();
        // Predefined items (copy/paste/quit/…) have opaque IDs — only emit ours.
        if id.contains('.') {
            let _ = handle.emit("menu-command", id);
        }
    });
}
