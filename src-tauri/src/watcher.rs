//! 文件监听：notify 事件在这里做去抖与合并，再以 `vault:changed` 回推前端。

use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{ApiError, ApiResult};
use crate::paths;

#[derive(Serialize, Clone)]
struct ChangedPayload {
    paths: Vec<String>,
}

pub struct WatchHandle {
    /// 保留 watcher，drop 即停止监听
    _watcher: notify::RecommendedWatcher,
}

/// 启动监听。事件在 120 ms 静默后合并成一批发出，避免一次保存触发十几次刷新。
pub fn start(app: AppHandle, root: PathBuf) -> ApiResult<WatchHandle> {
    let (tx, rx) = channel::<notify::Event>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })
    .map_err(ApiError::io)?;

    watcher.watch(&root, RecursiveMode::Recursive).map_err(ApiError::io)?;

    std::thread::spawn(move || {
        let mut batch: Vec<String> = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(event) => {
                    for p in event.paths {
                        if let Some(rel) = paths::to_rel(&root, &p) {
                            if !batch.contains(&rel) {
                                batch.push(rel);
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() {
                        let payload = ChangedPayload { paths: std::mem::take(&mut batch) };
                        let _ = app.emit("vault:changed", payload);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WatchHandle { _watcher: watcher })
}

/// 监听插件目录（内置 + 用户），任一文件变化后 300ms 合并成一次 `plugins:changed`。
/// 插件是「一个目录即一个插件」，改动 entry.js / style.css 后重扫即可生效（§5.10）。
pub fn start_plugins(app: AppHandle, roots: Vec<PathBuf>) -> ApiResult<WatchHandle> {
    let (tx, rx) = channel::<notify::Event>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let _ = tx.send(event);
        }
    })
    .map_err(ApiError::io)?;

    let mut watched = 0usize;
    for root in roots.iter().filter(|r| r.is_dir()) {
        if watcher.watch(root, RecursiveMode::Recursive).is_ok() {
            watched += 1;
        }
    }
    if watched == 0 {
        return Err(ApiError::new("NO_PLUGIN_DIR", "没有可监听的插件目录"));
    }

    std::thread::spawn(move || {
        let mut touched = false;
        loop {
            match rx.recv_timeout(Duration::from_millis(300)) {
                Ok(_event) => touched = true,
                Err(RecvTimeoutError::Timeout) => {
                    if touched {
                        touched = false;
                        let _ = app.emit("plugins:changed", ());
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WatchHandle { _watcher: watcher })
}
