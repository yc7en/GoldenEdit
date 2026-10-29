use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::{entry_of, sort_entries, Entry};
use crate::error::{ApiError, ApiResult};
use crate::paths;
use crate::state::{AppState, VaultState};
use crate::watcher;

#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub id: String,
    pub name: String,
    pub entries: Vec<Entry>,
}

fn list(root: &Path, rel: &str) -> ApiResult<Vec<Entry>> {
    let dir = paths::resolve_in_vault(root, rel)?;
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&dir)? {
        let item = item?;
        if let Some(e) = entry_of(root, &item.path()) {
            entries.push(e);
        }
    }
    sort_entries(&mut entries);
    Ok(entries)
}

#[tauri::command]
pub fn open_vault(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> ApiResult<VaultInfo> {
    let abs = Path::new(&path);
    if !abs.is_dir() {
        return Err(ApiError::not_found("不是有效目录"));
    }
    let root = abs
        .canonicalize()
        .map_err(|e| ApiError::denied(format!("工作区不可访问：{e}")))?;
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    let id = paths::vault_id(&root);

    let entries = list(&root, "")?;

    // 先停旧监听，避免切换工作区时收到上一个目录的事件
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    let handle = watcher::start(app, root.clone())?;
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = Some(handle);

    *state.vault.lock().map_err(|_| ApiError::internal("状态锁失效"))? = Some(VaultState {
        root: root.clone(),
        id: id.clone(),
        name: name.clone(),
    });
    *state.active_doc.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    state.set_vault_root(Some(root.clone()))?;

    Ok(VaultInfo {
        root: root.to_string_lossy().to_string(),
        id,
        name,
        entries,
    })
}

#[tauri::command]
pub fn close_vault(state: State<'_, AppState>) -> ApiResult<()> {
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    *state.vault.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    *state.active_doc.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    state.set_vault_root(None)?;
    Ok(())
}

#[tauri::command]
pub fn list_dir(rel: String, state: State<'_, AppState>) -> ApiResult<Vec<Entry>> {
    let vault = state.require_vault()?;
    list(&vault.root, &rel)
}

#[tauri::command]
pub fn create_entry(rel: String, kind: String, state: State<'_, AppState>) -> ApiResult<Entry> {
    let vault = state.require_vault()?;
    let abs = paths::resolve_in_vault(&vault.root, &rel)?;
    if abs.exists() {
        return Err(ApiError::conflict("同名文件已存在"));
    }
    if kind == "dir" {
        std::fs::create_dir(&abs)?;
    } else {
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&abs, b"")?;
    }
    entry_of(&vault.root, &abs).ok_or_else(|| ApiError::internal("条目创建后不可读"))
}

#[tauri::command]
pub fn rename_entry(rel: String, to: String, state: State<'_, AppState>) -> ApiResult<Entry> {
    let vault = state.require_vault()?;
    let from_abs = paths::resolve_in_vault(&vault.root, &rel)?;
    let to_abs = paths::resolve_in_vault(&vault.root, &to)?;
    if !from_abs.exists() {
        return Err(ApiError::not_found("源文件不存在"));
    }
    if to_abs.exists() {
        return Err(ApiError::conflict("目标已存在"));
    }
    if let Some(parent) = to_abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&from_abs, &to_abs)?;
    entry_of(&vault.root, &to_abs).ok_or_else(|| ApiError::internal("重命名后不可读"))
}

#[tauri::command]
pub fn delete_entry(rel: String, state: State<'_, AppState>) -> ApiResult<()> {
    let vault = state.require_vault()?;
    if paths::validate_rel(&rel)?.as_os_str().is_empty() {
        return Err(ApiError::denied("不能删除工作区根目录"));
    }
    let abs = paths::resolve_in_vault(&vault.root, &rel)?;
    if !abs.exists() {
        return Err(ApiError::not_found("文件不存在"));
    }
    // 走系统回收站，不做不可恢复的删除
    trash::delete(&abs).map_err(|e| ApiError::io(format!("移入回收站失败：{e}")))
}

#[tauri::command]
pub fn reveal_in_explorer(rel: String, state: State<'_, AppState>) -> ApiResult<()> {
    let vault = state.require_vault()?;
    let abs = paths::resolve_in_vault(&vault.root, &rel)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", abs.display()))
            .spawn()
            .map_err(ApiError::io)?;
    }
    #[cfg(not(windows))]
    {
        open::that_detached(if abs.is_dir() { abs } else { abs.parent().unwrap_or(&abs).to_path_buf() })
            .map_err(ApiError::io)?;
    }
    Ok(())
}

#[tauri::command]
pub fn watch_vault(app: AppHandle, state: State<'_, AppState>) -> ApiResult<()> {
    let vault = state.require_vault()?;
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    let handle = watcher::start(app, vault.root)?;
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(state: State<'_, AppState>) -> ApiResult<()> {
    *state.watcher.lock().map_err(|_| ApiError::internal("状态锁失效"))? = None;
    Ok(())
}

#[tauri::command]
pub fn set_active_doc(rel: Option<String>, state: State<'_, AppState>) -> ApiResult<()> {
    *state.active_doc.lock().map_err(|_| ApiError::internal("状态锁失效"))? = rel;
    Ok(())
}

/// 同名副本的命名：`name.ext` → `name copy.ext` → `name copy 2.ext` …
/// 第 0 个候选就是原名，所以「目标目录里没有同名」时不会加后缀。
fn copy_name(stem: &str, ext: &str, index: usize) -> String {
    match index {
        0 => format!("{stem}{ext}"),
        1 => format!("{stem} copy{ext}"),
        n => format!("{stem} copy {n}{ext}"),
    }
}

/// 拆主名与扩展名。`.gitignore` 这类以点开头的整体当主名，避免变成 `.gitignore copy`。
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> ApiResult<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        // 用不跟随链接的 file_type 判断：普通目录才递归，其余交给 fs::copy 按内容复制。
        // 目录符号链接会在这里报 IO 错误而不是被静默跳过，错误至少是可见的。
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

/// 复制文件或目录到 `to_dir`，返回新条目。同名冲突时由这里决定后缀，
/// 不让前端猜——前端看不到磁盘上的实时状态（§8.3）。
#[tauri::command]
pub fn copy_entry(rel: String, to_dir: String, state: State<'_, AppState>) -> ApiResult<Entry> {
    let vault = state.require_vault()?;
    let src = paths::resolve_in_vault(&vault.root, &rel)?;
    if !src.exists() {
        return Err(ApiError::not_found("源文件不存在"));
    }
    let dir = paths::resolve_in_vault(&vault.root, &to_dir)?;
    if !dir.is_dir() {
        return Err(ApiError::not_found("目标不是文件夹"));
    }
    if src.is_dir() {
        let canon_src = src
            .canonicalize()
            .map_err(|e| ApiError::denied(format!("源不可解析：{e}")))?;
        let canon_dir = dir
            .canonicalize()
            .map_err(|e| ApiError::denied(format!("目标不可解析：{e}")))?;
        // 复制到自身内部会无限递归（复制的副本又包含自己）
        if paths::is_inside(&canon_src, &canon_dir) {
            return Err(ApiError::denied("不能复制到自身内部"));
        }
    }

    let name = src
        .file_name()
        .ok_or_else(|| ApiError::denied("无法识别文件名"))?
        .to_string_lossy()
        .to_string();
    let (stem, ext) = split_ext(&name);

    for index in 0..1000 {
        let dest = dir.join(copy_name(stem, ext, index));
        if dest.exists() {
            continue;
        }
        if src.is_dir() {
            copy_dir_all(&src, &dest)?;
        } else {
            std::fs::copy(&src, &dest)?;
        }
        return entry_of(&vault.root, &dest).ok_or_else(|| ApiError::internal("复制后不可读"));
    }
    Err(ApiError::conflict("同名副本过多"))
}

#[cfg(test)]
mod tests {
    use super::{copy_name, split_ext};

    #[test]
    fn split_ext_keeps_dotfiles_whole() {
        assert_eq!(split_ext("notes.md"), ("notes", ".md"));
        assert_eq!(split_ext("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_ext(".gitignore"), (".gitignore", ""));
        assert_eq!(split_ext("README"), ("README", ""));
    }

    #[test]
    fn copy_name_follows_conflict_rule() {
        assert_eq!(copy_name("notes", ".md", 0), "notes.md");
        assert_eq!(copy_name("notes", ".md", 1), "notes copy.md");
        assert_eq!(copy_name("notes", ".md", 2), "notes copy 2.md");
        assert_eq!(copy_name(".gitignore", "", 1), ".gitignore copy");
    }
}
