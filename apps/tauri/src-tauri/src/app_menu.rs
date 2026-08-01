//! Native application menu.
//!
//! Built explicitly rather than using the Tauri default so the macOS About
//! panel carries the app icon. In development the binary is not an `.app`
//! bundle, so macOS has no `Info.plist` icon to fall back on; passing the
//! embedded window icon through `AboutMetadata` makes the panel correct in
//! both dev and bundled builds.

use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{App, Runtime};

pub fn build<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    // Same source as the in-app About (`getVersion`) and the updater's
    // "you have X" line: the stamped package version for this binary.
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

    // Copy/paste must be present explicitly: replacing the default menu also
    // replaces the standard Edit items the terminal depends on.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .close_window()
        .build()?;

    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "Tethra")
        .about_with_text("About Tethra", Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let app_menu = SubmenuBuilder::new(app, "File")
        .about_with_text("About Tethra", Some(about))
        .separator()
        .quit()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit)
        .item(&window)
        .build()
}
