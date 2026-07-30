//! Local filesystem commands for the SFTP browser left pane.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../ui/src/lib/generated/")]
pub struct FileEntryDto {
    pub name: String,
    pub path: String,
    pub file_type: String,
    pub size: Option<u64>,
    pub modified_unix: Option<u64>,
}

pub fn local_home() -> Result<String, String> {
    let home = platform_desktop::home_dir().map_err(|e| e.to_string())?;
    Ok(home.to_string_lossy().into_owned())
}

pub fn local_list(path: String) -> Result<Vec<FileEntryDto>, String> {
    let path = PathBuf::from(path);
    validate_local_path(&path)?;
    let read_dir = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        entries.push(entry_to_dto(&entry)?);
    }
    entries.sort_by(|a, b| {
        file_type_rank(&a.file_type)
            .cmp(&file_type_rank(&b.file_type))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn local_mkdir(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    validate_local_path(&path)?;
    std::fs::create_dir(&path).map_err(|e| e.to_string())
}

pub fn local_rename(from: String, to: String) -> Result<(), String> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);
    validate_local_path(&from)?;
    validate_local_path(&to)?;
    if from.file_name().is_none() || to.file_name().is_none() {
        return Err("invalid rename path".into());
    }
    std::fs::rename(from, to).map_err(|e| e.to_string())
}

pub fn local_remove(path: String, recursive: bool) -> Result<(), String> {
    let path = PathBuf::from(path);
    validate_local_path(&path)?;
    if path.file_name().is_none() {
        return Err("cannot remove root path".into());
    }
    remove_path(&path, recursive).map_err(|e| e.to_string())
}

fn entry_to_dto(entry: &std::fs::DirEntry) -> Result<FileEntryDto, String> {
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().into_owned();
    let meta = entry.metadata().map_err(|e| e.to_string())?;
    let file_type = if meta.file_type().is_symlink() {
        "symlink"
    } else if meta.is_dir() {
        "dir"
    } else {
        "file"
    };
    let modified_unix = meta.modified().ok().and_then(|time| {
        time.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs())
    });
    Ok(FileEntryDto {
        name,
        path: path.to_string_lossy().into_owned(),
        file_type: file_type.into(),
        size: if meta.is_file() {
            Some(meta.len())
        } else {
            None
        },
        modified_unix,
    })
}

fn remove_path(path: &Path, recursive: bool) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        std::fs::remove_file(path)
    } else if meta.is_dir() {
        if recursive {
            for entry in std::fs::read_dir(path)? {
                remove_path(&entry?.path(), true)?;
            }
            std::fs::remove_dir(path)
        } else {
            std::fs::remove_dir(path)
        }
    } else {
        std::fs::remove_file(path)
    }
}

fn validate_local_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("path must be absolute".into());
    }
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("path traversal is not allowed".into());
        }
    }
    Ok(())
}

fn file_type_rank(file_type: &str) -> u8 {
    match file_type {
        "dir" => 0,
        "symlink" => 1,
        _ => 2,
    }
}
