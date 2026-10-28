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
