//! Window materials (Track B). Opaque is the default; vibrancy/Mica are opt-in.

use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialCapabilities {
    pub vibrancy: bool,
    pub mica: bool,
    pub acrylic: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialApplyResult {
    pub applied: String,
    pub message: Option<String>,
}

pub fn capabilities() -> MaterialCapabilities {
    #[cfg(target_os = "macos")]
    {
        MaterialCapabilities {
            vibrancy: true,
            mica: false,
            acrylic: false,
            note: "macOS vibrancy. Requires macOSPrivateApi (dmg distribution only).".into(),
        }
    }
    #[cfg(target_os = "windows")]
    {
        let win11 = is_windows_11();
        MaterialCapabilities {
            vibrancy: false,
            mica: win11,
            acrylic: !win11,
            note: if win11 {
                "Windows 11 Mica. Acrylic is available but may stutter while dragging.".into()
            } else {
                "Windows 10: Mica unavailable. Acrylic is opt-in and may affect resize/drag performance."
                    .into()
            },
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        MaterialCapabilities {
            vibrancy: false,
            mica: false,
            acrylic: false,
            note: "Linux materials are compositor-controlled; Tethra keeps an opaque window."
                .into(),
        }
    }
}

/// `kind`: `opaque` | `vibrant` | `custom` | `acrylic`
pub fn apply(window: &WebviewWindow, kind: &str) -> Result<MaterialApplyResult, String> {
    clear(window)?;

    match kind {
        "opaque" | "" => Ok(MaterialApplyResult {
            applied: "none".into(),
            message: None,
        }),
        "vibrant" | "custom" => apply_vibrant(window),
        "acrylic" => apply_acrylic_effect(window),
        other => Err(format!("unknown material kind: {other}")),
    }
}

fn apply_vibrant(window: &WebviewWindow) -> Result<MaterialApplyResult, String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
        apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, None)
            .map_err(|error| error.to_string())?;
        Ok(MaterialApplyResult {
            applied: "vibrancy".into(),
            message: None,
        })
    }
    #[cfg(target_os = "windows")]
    {
        if is_windows_11() {
            use window_vibrancy::apply_mica;
            apply_mica(window, Some(true)).map_err(|error| error.to_string())?;
            Ok(MaterialApplyResult {
                applied: "mica".into(),
                message: None,
            })
        } else {
            Ok(MaterialApplyResult {
                applied: "none".into(),
                message: Some(
                    "Mica requires Windows 11. Staying opaque — try Acrylic if you accept the perf trade-off."
                        .into(),
                ),
            })
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(MaterialApplyResult {
            applied: "none".into(),
            message: Some("Materials are not supported on this platform.".into()),
        })
    }
}

fn apply_acrylic_effect(window: &WebviewWindow) -> Result<MaterialApplyResult, String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        // Dark chrome tint; alpha ~0.7. May stutter on drag (documented).
        apply_acrylic(window, Some((18, 18, 18, 180))).map_err(|error| error.to_string())?;
        Ok(MaterialApplyResult {
            applied: "acrylic".into(),
            message: Some(
                "Acrylic can stutter while resizing or dragging on recent Windows builds.".into(),
            ),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Ok(MaterialApplyResult {
            applied: "none".into(),
            message: Some("Acrylic is Windows-only.".into()),
        })
    }
}

fn clear(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window_vibrancy::clear_vibrancy(window);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::clear_mica(window);
        let _ = window_vibrancy::clear_acrylic(window);
        let _ = window_vibrancy::clear_blur(window);
        let _ = window_vibrancy::clear_tabbed(window);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn is_windows_11() -> bool {
    windows_version::OsVersion::current().build >= 22000
}
