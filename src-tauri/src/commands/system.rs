use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{ApiError, ApiResult};
use crate::preview_server::{PluginRoots, PreviewServer, ServerInfo};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub date: u64,
}

/// 预览外壳的构建产物目录。开发态在仓库根的 `dist-preview`，发布态在资源目录。
fn shell_dir(app: &AppHandle) -> ApiResult<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("dist-preview"));
        candidates.push(res.join("_up_/dist-preview"));
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    candidates.push(cwd.join("dist-preview"));
    candidates.push(cwd.join("..").join("dist-preview"));
    candidates.push(cwd.join("..").join("..").join("dist-preview"));

    for c in &candidates {
        if c.join("index.html").is_file() {
            return Ok(c.clone());
        }
    }
    Err(ApiError::internal(format!(
        "未找到预览外壳构建产物（先执行 npm run build:preview）。已尝试：{:?}",
        candidates
    )))
}

#[tauri::command]
pub fn start_preview_server(
    app: AppHandle,
    state: State<'_, AppState>,
) -> ApiResult<ServerInfo> {
    let mut guard = state.server.lock().map_err(|_| ApiError::internal("服务锁失效"))?;
    if let Some(server) = guard.as_ref() {
        return Ok(server.info.clone());
    }
    let dir = shell_dir(&app)?;
    let roots: PluginRoots = state.plugin_roots.clone();
    let server = PreviewServer::start(dir, state.vault_root.clone(), roots)?;
    let info = server.info.clone();
    *guard = Some(server);
    Ok(info)
}

#[tauri::command]
pub fn stop_preview_server(state: State<'_, AppState>) -> ApiResult<()> {
    let mut guard = state.server.lock().map_err(|_| ApiError::internal("服务锁失效"))?;
    if let Some(mut server) = guard.take() {
        server.stop();
    }
    Ok(())
}

#[tauri::command]
pub fn open_external(url: String) -> ApiResult<()> {
    let lowered = url.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|p| lowered.starts_with(p));
    if !allowed {
        return Err(ApiError::denied("只允许打开 http / https / mailto 链接"));
    }
    open::that_detached(url).map_err(ApiError::io)
}

#[tauri::command]
pub fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn apply_filters(mut dialog: rfd::FileDialog, filters: Option<Vec<FileFilter>>) -> rfd::FileDialog {
    if let Some(list) = filters {
        for f in list {
            let refs: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            dialog = dialog.add_filter(&f.name, &refs);
        }
    }
    dialog
}

#[tauri::command]
pub fn pick_file(filters: Option<Vec<FileFilter>>) -> Option<String> {
    apply_filters(rfd::FileDialog::new(), filters)
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_dialog(
    default_name: String,
    filters: Option<Vec<FileFilter>>,
) -> Option<String> {
    apply_filters(rfd::FileDialog::new().set_file_name(&default_name), filters)
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// 读取 `.git/logs/HEAD` 生成版本时间线。
/// 刻意不执行 `git` 子进程：契约 §9.6 不允许暴露进程执行，时间线也不需要完整 git 能力。
#[tauri::command]
pub fn git_log(limit: Option<usize>, state: State<'_, AppState>) -> ApiResult<Vec<Commit>> {
    let vault = state.require_vault()?;
    let path = vault.root.join(".git").join("logs").join("HEAD");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    let limit = limit.unwrap_or(12);
    let mut out: Vec<Commit> = Vec::new();
    for line in text.lines().rev() {
        if out.len() >= limit {
            break;
        }
        let Some((meta, message)) = line.split_once('\t') else {
            continue;
        };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let hash = parts[1].to_string();
        if hash.chars().all(|c| c == '0') {
            continue;
        }
        let ts = parts
            .iter()
            .find(|p| p.len() == 10 && p.chars().all(|c| c.is_ascii_digit()))
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let subject = message
            .trim()
            .trim_start_matches("commit (initial): ")
            .trim_start_matches("commit: ")
            .to_string();
        out.push(Commit {
            short: hash.chars().take(7).collect(),
            hash,
            subject,
            date: ts * 1000,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str, limit: usize) -> Vec<Commit> {
        let mut out = Vec::new();
        for line in text.lines().rev() {
            if out.len() >= limit {
                break;
            }
            let Some((meta, message)) = line.split_once('\t') else {
                continue;
            };
            let parts: Vec<&str> = meta.split_whitespace().collect();
            let hash = parts[1].to_string();
            let ts = parts
                .iter()
                .find(|p| p.len() == 10 && p.chars().all(|c| c.is_ascii_digit()))
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            out.push(Commit {
                short: hash.chars().take(7).collect(),
                hash,
                subject: message
                    .trim()
                    .trim_start_matches("commit (initial): ")
                    .trim_start_matches("commit: ")
                    .to_string(),
                date: ts * 1000,
            });
        }
        out
    }

    #[test]
    fn parses_reflog_lines_newest_first() {
        let text = "0000000 aaaaaaaa Leo <a@b.c> 1700000000 +0800\tcommit (initial): first\n\
                    aaaaaaa bbbbbbbb Leo <a@b.c> 1700000100 +0800\tcommit: second";
        let commits = parse(text, 10);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].short, "bbbbbbb");
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[1].subject, "first");
        assert_eq!(commits[0].date, 1_700_000_100_000);
    }

    #[test]
    fn rejects_non_http_links() {
        let err = open_external("file:///c:/windows".into()).unwrap_err();
        assert_eq!(err.code, "DENIED");
    }
}
