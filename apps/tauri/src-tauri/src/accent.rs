//! Resolve OS accent color for chrome theming (Track C).

/// Returns `#RRGGBB` when the host exposes a system accent; otherwise `None`.
pub fn system_accent_hex() -> Option<String> {
    #[cfg(windows)]
    {
        windows_accent()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_accent() -> Option<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let dwm = hkcu.open_subkey(r"Software\Microsoft\Windows\DWM").ok()?;

    // Prefer AccentColor (0xAABBGGRR). Fall back to ColorizationColor (0xAARRGGBB).
    if let Ok(color) = dwm.get_value::<u32, _>("AccentColor") {
        let r = color & 0xff;
        let g = (color >> 8) & 0xff;
        let b = (color >> 16) & 0xff;
        if r | g | b != 0 {
            return Some(format!("#{r:02X}{g:02X}{b:02X}"));
        }
    }

    if let Ok(color) = dwm.get_value::<u32, _>("ColorizationColor") {
        let r = (color >> 16) & 0xff;
        let g = (color >> 8) & 0xff;
        let b = color & 0xff;
        if r | g | b != 0 {
            return Some(format!("#{r:02X}{g:02X}{b:02X}"));
        }
    }

    None
}
