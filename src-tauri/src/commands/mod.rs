pub mod doc;
pub mod export;
pub mod plugin;
pub mod settings;
pub mod system;
pub mod vault;

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// 单次目录列举返回的条目。`rel` 始终是 `/` 分隔、相对 vault 根的路径。
#[derive(Serialize, Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub rel: String,
    pub kind: &'static str,
    pub size: u64,
    pub mtime: u64,
}

pub fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn entry_of(root: &Path, path: &Path) -> Option<Entry> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    let rel = crate::paths::to_rel(root, path)?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let is_dir = meta.is_dir();
    Some(Entry {
        name,
        rel,
        kind: if is_dir { "dir" } else { "file" },
        size: if is_dir { 0 } else { meta.len() },
        mtime: mtime_ms(&meta),
    })
}

/// 目录条目排序：目录在前，同类按名称不区分大小写。
pub fn sort_entries(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        let ad = a.kind == "dir";
        let bd = b.kind == "dir";
        bd.cmp(&ad)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}
