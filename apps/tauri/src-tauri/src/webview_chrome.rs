//! Suppress the platform WebView’s default context menu (M12.5).
//!
//! Real menus are Radix ContextMenus in the React tree. Without this, WKWebView
//! / WebView2 leak Safari/Edge chrome (Writing Tools, Inspect Element, …).
//!
//! IMPORTANT: do **not** `preventDefault` in the *capture* phase. Radix opens
//! via `composeEventHandlers`, which skips its handler when
//! `event.defaultPrevented` is already true — capture-phase suppress silently
//! kills every app context menu (terminal Copy/Paste, host cards, tabs, …).
//! Bubble-phase suppress still blocks the native menu after Radix has run.

use tauri::{AppHandle, Manager, Runtime};

const SUPPRESS_CONTEXT_MENU: &str = r#"
(function () {
  // Bumped flag: older builds used capture-phase preventDefault which broke Radix.
  if (window.__tethraCtxMenuBubble) return;
  window.__tethraCtxMenuBubble = true;
  document.addEventListener(
    "contextmenu",
    function (e) { e.preventDefault(); },
    false
  );
})();
"#;

/// Inject the suppress script into every live webview.
pub fn harden_all_webviews<R: Runtime>(app: &AppHandle<R>) {
    for (_, window) in app.webview_windows() {
        harden_webview(&window);
    }
}

pub fn harden_webview<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.eval(SUPPRESS_CONTEXT_MENU);
}
