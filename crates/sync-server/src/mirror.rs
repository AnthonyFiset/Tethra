//! Mirror desktop release assets from GitHub into the local updates dir.
//!
//! Runs on the server host, which is already `gh auth login`'d against the
//! private repo. Clients then pull updates from here without credentials.

use std::path::Path;
use std::process::Command;

use crate::updates;

pub const DEFAULT_REPO: &str = "AnthonyFiset/Tethra";

/// Download `latest.json` plus its referenced assets for `tag` (or the latest
/// release when `tag` is None). Returns the version that is now published.
pub fn sync_release(data_dir: &Path, repo: &str, tag: Option<&str>) -> Result<String, String> {
    ensure_gh()?;

    let dir = updates::updates_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let tag = match tag {
        Some(t) => t.to_string(),
        None => latest_tag(repo)?,
    };

    // `latest.json` names every platform asset for this release.
    download(repo, &tag, "latest.json", &dir)?;

    let manifest = updates::load_manifest(data_dir).ok_or_else(|| {
        "release has no usable latest.json (updater artifacts missing?)".to_string()
    })?;

    for entry in manifest.platforms.values() {
        let Some(file) = entry.url.rsplit('/').next().filter(|f| !f.is_empty()) else {
            continue;
        };
        download(repo, &tag, file, &dir)?;
    }

    Ok(manifest.version)
}

fn ensure_gh() -> Result<(), String> {
    let ok = Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map_err(|e| format!("gh not found: {e} (install GitHub CLI and run `gh auth login`)"))?
        .status
        .success();
    if !ok {
        return Err("gh is not authenticated; run `gh auth login`".into());
    }
    Ok(())
}

fn latest_tag(repo: &str) -> Result<String, String> {
    let out = Command::new("gh")
        .args([
            "release", "view", "--repo", repo, "--json", "tagName", "-q", ".tagName",
        ])
        .output()
        .map_err(|e| format!("gh release view: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "gh release view failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let tag = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if tag.is_empty() {
        return Err("no published release found (is it still a draft?)".into());
    }
    Ok(tag)
}

fn download(repo: &str, tag: &str, pattern: &str, dir: &Path) -> Result<(), String> {
    let out = Command::new("gh")
        .args([
            "release",
            "download",
            tag,
            "--repo",
            repo,
            "--pattern",
            pattern,
            "--dir",
        ])
        .arg(dir)
        .arg("--clobber")
        .output()
        .map_err(|e| format!("gh release download: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "download {pattern} from {tag}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}
