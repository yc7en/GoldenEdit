//! P13 性能验收的进程内驱动（ARCHITECTURE §13.1）。
//!
//! 为什么不用远程调试端口：wry 建 WebView2 环境时总会以编程方式设置
//! `AdditionalBrowserArguments`，WebView2 因此忽略 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`，
//! CDP 端口时有时无（实测同一份二进制前后两次启动行为不一致）。而为了跑性能测试
//! 在发布版里固定开一个调试端口更不可接受，所以改成进程内自测：
//! Rust 读样本 → 前端用真实渲染管线量 → 前端把结果写回文件 → 退出进程。
//!
//! 两个命令只在 `GE_PERF_MANIFEST` / `GE_PERF_OUT` 存在时才有意义；正常启动下
//! `perf_plan` 直接返回 `None`，不会读任何文件。

use crate::error::{ApiError, ApiResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 清单条目：脚本写这一份，阈值只维护在 perf-check.mjs 一处
#[derive(Deserialize)]
struct PlanEntry {
    file: String,
    budget: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfSample {
    pub name: String,
    pub budget: u64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfPlan {
    pub samples: Vec<PerfSample>,
    /// 结果要写到哪里（脚本随后轮询这个文件）
    pub out: String,
}

/// 读取验收清单与样本正文。没有 `GE_PERF_MANIFEST` 就说明是普通启动。
#[tauri::command]
pub fn perf_plan() -> ApiResult<Option<PerfPlan>> {
    let Some(manifest) = std::env::var_os("GE_PERF_MANIFEST") else {
        return Ok(None);
    };
    let manifest = PathBuf::from(manifest);
    let out = std::env::var("GE_PERF_OUT").map_err(|_| {
        ApiError::internal("设置了 GE_PERF_MANIFEST 却没有 GE_PERF_OUT")
    })?;

    let raw = std::fs::read_to_string(&manifest)?;
    let entries: Vec<PlanEntry> = serde_json::from_str(&raw)
        .map_err(|e| ApiError::internal(format!("清单格式错误：{e}")))?;
    let dir = manifest.parent().map(PathBuf::from).unwrap_or_default();

    let mut samples = Vec::with_capacity(entries.len());
    for entry in entries {
        let path = dir.join(&entry.file);
        let text = std::fs::read_to_string(&path)
            .map_err(|e| ApiError::io(format!("{}：{e}", path.display())))?;
        samples.push(PerfSample {
            name: entry.file,
            budget: entry.budget,
            text,
        });
    }

    Ok(Some(PerfPlan { samples, out }))
}

/// 落盘后退出：脚本靠这个文件的出现判断一轮跑完。
#[tauri::command]
pub fn perf_report(out: String, rows: String, app: tauri::AppHandle) -> ApiResult<()> {
    std::fs::write(&out, rows)?;
    app.exit(0);
    Ok(())
}
