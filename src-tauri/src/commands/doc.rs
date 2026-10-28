use serde::Serialize;
use tauri::State;

use crate::commands::mtime_ms;
use crate::error::{ApiError, ApiResult};
use crate::hash::sha256_hex;
use crate::paths;
use crate::state::AppState;

/// 单文档上限。超过这个体积预览也无法可用，直接拒绝并给出明确错误码。
const MAX_DOC_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
pub struct DocReadResult {
    pub text: String,
    pub mtime: u64,
    pub hash: String,
}

#[derive(Serialize)]
pub struct DocWriteResult {
    pub mtime: u64,
    pub hash: String,
}

#[tauri::command]
pub fn read_doc(rel: String, state: State<'_, AppState>) -> ApiResult<DocReadResult> {
    let vault = state.require_vault()?;
    let abs = paths::resolve_in_vault(&vault.root, &rel)?;
    let meta = std::fs::metadata(&abs)?;
    if meta.is_dir() {
        return Err(ApiError::new("IS_DIR", "目标是目录"));
    }
    if meta.len() > MAX_DOC_BYTES {
        return Err(ApiError::too_large(format!(
            "文件 {} MB，超过 32 MB 上限",
            meta.len() / 1024 / 1024
        )));
    }
    let bytes = std::fs::read(&abs)?;
    // 非 UTF-8 文件不硬失败：用替换字符读出来，至少不丢内容
    let text = String::from_utf8_lossy(&bytes).to_string();
    Ok(DocReadResult {
        hash: sha256_hex(&bytes),
        mtime: mtime_ms(&meta),
        text,
    })
}

#[tauri::command]
pub fn write_doc(
    rel: String,
    text: String,
    expected_mtime: Option<u64>,
    state: State<'_, AppState>,
) -> ApiResult<DocWriteResult> {
    let vault = state.require_vault()?;
    let abs = paths::resolve_in_vault(&vault.root, &rel)?;

    if let Some(expected) = expected_mtime {
        if abs.exists() {
            let current = mtime_ms(&std::fs::metadata(&abs)?);
            if current != expected {
                return Err(ApiError::conflict(
                    "文件已被外部修改，请先处理冲突再保存",
                ));
            }
        }
    }

    if let Some(parent) = abs.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // 原子写：同目录临时文件 + 替换，避免写到一半崩溃留下半截文档
    let tmp = abs.with_extension(format!("ge-tmp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::write(&tmp, text.as_bytes())?;
    if let Err(e) = std::fs::rename(&tmp, &abs) {
        let _ = std::fs::remove_file(&tmp);
        return Err(ApiError::io(e));
    }

    let meta = std::fs::metadata(&abs)?;
    Ok(DocWriteResult {
        mtime: mtime_ms(&meta),
        hash: sha256_hex(text.as_bytes()),
    })
}

#[cfg(test)]
mod tests {
    use super::MAX_DOC_BYTES;

    #[test]
    fn limit_is_32mb() {
        assert_eq!(MAX_DOC_BYTES, 32 * 1024 * 1024);
    }
}
