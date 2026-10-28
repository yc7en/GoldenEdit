use std::path::PathBuf;

use tauri::State;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

/// HTML 内容由前端生成，Rust 只落盘（ARCHITECTURE §9.5）。
/// 这样「预览」与「导出」共用同一段渲染代码，像素一致是结构性保证。
#[tauri::command]
pub fn save_export(path: String, contents: String, state: State<'_, AppState>) -> ApiResult<()> {
    let _ = &state; // 导出路径由用户显式选择，不经 vault 守卫
    let target = PathBuf::from(&path);
    if target.extension().is_none() {
        return Err(ApiError::denied("导出路径必须带扩展名"));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = target.with_extension(format!(
        "{}.tmp",
        target
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    ));
    std::fs::write(&tmp, contents.as_bytes())?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// PDF 一期走系统打印对话框：Tauri 2 未暴露 `PrintToPdfAsync`，
/// 与其用 COM 互操作硬接一个平台相关实现，不如先给出可用的打印链路。
/// 前端收到 `PRINT_FALLBACK` 后调用预览 iframe 的 `print()`。
#[tauri::command]
pub fn export_pdf(_path: String) -> ApiResult<()> {
    Err(ApiError::new(
        "PRINT_FALLBACK",
        "PDF 输出改用系统打印对话框，请选择「另存为 PDF」",
    ))
}
