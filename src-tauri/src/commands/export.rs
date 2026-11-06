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

/// PDF 导出走系统打印对话框：Tauri 2 未暴露 `PrintToPdfAsync`，
/// 与其用 COM 互操作硬接一个平台相关实现，不如先给出可用的打印链路。
/// 前端收到 `PRINT_FALLBACK` 后调用预览 iframe 的 `print()`。
///
/// macOS 侧没有这条链路：WKWebView 不实现 `window.print()`，调用是静默无操作。
/// 因此非 Windows 直接返回 `UNSUPPORTED`，让前端把「不支持」讲清楚，而不是假装成功
/// （ARCHITECTURE §9.5）。
#[tauri::command]
pub fn export_pdf(_path: String) -> ApiResult<()> {
    if cfg!(windows) {
        Err(ApiError::new(
            "PRINT_FALLBACK",
            "PDF 输出改用系统打印对话框，请选择「另存为 PDF」",
        ))
    } else {
        Err(ApiError::new(
            "UNSUPPORTED",
            "当前平台的 WebView 没有打印能力，PDF 导出不可用；请改用单文件 HTML 导出",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_pdf_never_pretends_to_succeed() {
        // 两个平台都只能报错：Windows 交给打印对话框，其它平台明确不支持
        let err = export_pdf("x.pdf".into()).unwrap_err();
        let expected = if cfg!(windows) { "PRINT_FALLBACK" } else { "UNSUPPORTED" };
        assert_eq!(err.code, expected);
    }
}
