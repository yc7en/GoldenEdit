use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::error::{ApiError, ApiResult};
use crate::preview_server::{PluginRoots, PreviewServer};
use crate::watcher::WatchHandle;

#[derive(Clone, Debug)]
pub struct VaultState {
    pub root: PathBuf,
    /// 用于 `ui-state.json` 的 key（P9 使用）
    #[allow(dead_code)]
    pub id: String,
    /// 左栏底部展示的工作区名（P7 使用）
    #[allow(dead_code)]
    pub name: String,
}

/// 应用级共享状态。所有字段都在 `setup` 里初始化，命令通过 `tauri::State` 取用。
pub struct AppState {
    /// `<appdata>/GoldenEdit/`
    pub data_dir: PathBuf,
    pub vault: Mutex<Option<VaultState>>,
    pub watcher: Mutex<Option<WatchHandle>>,
    /// 当前编辑器打开的文件（相对路径），供监听侧判断是否需要单独提示外部改动
    pub active_doc: Mutex<Option<String>>,
    /// 与预览服务共享的工作区根路径；服务只读它，用来解析 /asset
    pub vault_root: Arc<Mutex<Option<PathBuf>>>,
    pub server: Mutex<Option<PreviewServer>>,
    /// 插件 id → 目录，预览服务据此路由 /plugin/{id}/*
    pub plugin_roots: PluginRoots,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            vault: Mutex::new(None),
            watcher: Mutex::new(None),
            active_doc: Mutex::new(None),
            vault_root: Arc::new(Mutex::new(None)),
            server: Mutex::new(None),
            plugin_roots: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// P9 设置持久化使用
    #[allow(dead_code)]
    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    /// P9 界面状态持久化使用
    #[allow(dead_code)]
    pub fn ui_state_path(&self) -> PathBuf {
        self.data_dir.join("ui-state.json")
    }

    /// P4 插件安装目录
    pub fn user_plugins_dir(&self) -> PathBuf {
        self.data_dir.join("plugins")
    }

    /// 同步工作区根路径给预览服务
    pub fn set_vault_root(&self, root: Option<PathBuf>) -> ApiResult<()> {
        let mut cell = self
            .vault_root
            .lock()
            .map_err(|_| ApiError::internal("工作区路径锁失效"))?;
        *cell = root;
        Ok(())
    }

    /// 取当前工作区；未打开时返回结构化错误，而不是 panic。
    pub fn require_vault(&self) -> ApiResult<VaultState> {
        self.vault
            .lock()
            .map_err(|_| ApiError::internal("状态锁失效"))?
            .clone()
            .ok_or_else(|| ApiError::new("NO_VAULT", "尚未打开工作区"))
    }
}
