use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub const API_VERSION: u32 = 1;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchRule {
    #[serde(default)]
    pub fence: Vec<String>,
    #[serde(default)]
    pub container: Vec<String>,
    #[serde(default)]
    pub delimiter: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_trust")]
    pub trust: String,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub r#match: Option<MatchRule>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub config: BTreeMap<String, Value>,
    #[serde(default)]
    pub preview: Option<String>,
}

fn default_trust() -> String {
    "local".to_string()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    pub author: Option<String>,
    pub description: Option<String>,
    pub trust: String,
    pub entry: Option<String>,
    pub style: Option<String>,
    pub r#match: MatchOut,
    pub permissions: Vec<String>,
    pub config: BTreeMap<String, Value>,
    pub preview: Option<String>,
    pub source: SourceOut,
    pub capability: String,
    pub base: String,
    /// 目录绝对路径，仅用于「打开插件目录」与诊断，不下发给 L3
    pub dir: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchOut {
    pub fence: Vec<String>,
    pub container: Vec<String>,
    pub delimiter: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceOut {
    pub r#type: String,
    pub path: Option<String>,
}

/// 静态嗅探能力等级：没有 entry 即 L0；用了 onMount 即 L2；出现 net/fs 即 L3。
/// 运行时还会用 Proxy 访问记录再判一次（§5.4），这里只是安装前的提示依据。
fn sniff_capability(dir: &Path, manifest: &Manifest) -> String {
    let Some(entry) = &manifest.entry else {
        return "L0".into();
    };
    // 声明了 editor 权限的插件会在主页面注册编辑器命令，按 L2 计（§5.4）
    let wants_editor = manifest.permissions.iter().any(|p| p == "editor");
    let Ok(code) = std::fs::read_to_string(dir.join(entry)) else {
        return if wants_editor { "L2".into() } else { "L1".into() };
    };
    if code.contains("ctx.net") || code.contains("ctx.fs") {
        return "L3".into();
    }
    if wants_editor || code.contains("onMount(") || code.contains("commands.register") {
        return "L2".into();
    }
    "L1".into()
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    let manifest: Manifest = serde_json::from_str(&text).ok()?;
    if manifest.id.trim().is_empty() || manifest.name.trim().is_empty() {
        return None;
    }
    if manifest.api_version != API_VERSION {
        log::warn!("插件 {} 的 apiVersion 不兼容，已跳过", manifest.id);
        return None;
    }
    Some(manifest)
}

fn to_info(dir: &Path, manifest: Manifest, source_type: &str) -> PluginInfo {
    let capability = sniff_capability(dir, &manifest);
    let m = manifest.r#match.clone().unwrap_or_default();
    PluginInfo {
        base: format!("plugin/{}", manifest.id),
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        api_version: manifest.api_version,
        author: manifest.author,
        description: manifest.description,
        trust: manifest.trust,
        entry: manifest.entry,
        style: manifest.style,
        r#match: MatchOut {
            fence: m.fence,
            container: m.container,
            delimiter: m.delimiter,
        },
        permissions: manifest.permissions,
        config: manifest.config,
        preview: manifest.preview,
        source: SourceOut {
            r#type: source_type.to_string(),
            path: Some(dir.to_string_lossy().to_string()),
        },
        capability,
        dir: dir.to_string_lossy().to_string(),
    }
}

/// 内置插件目录候选：开发态在仓库根，发布态在资源目录。
fn builtin_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res.join("plugins"));
        roots.push(res.join("_up_/plugins"));
        roots.push(res.join("frontend").join("plugins"));
        roots.push(res.join("_up_/frontend").join("plugins"));
    }
    // 兼容从 target/debug/ 或其他嵌套子目录直接运行的情况，向上逐级回溯 6 层探测
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.as_path();
        for _ in 0..6 {
            if let Some(p) = cur.parent() {
                roots.push(p.join("plugins"));
                roots.push(p.join("frontend").join("plugins"));
                cur = p;
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut cur = cwd.as_path();
    for _ in 0..4 {
        roots.push(cur.join("frontend").join("plugins"));
        roots.push(cur.join("plugins"));
        if let Some(p) = cur.parent() {
            cur = p;
        }
    }
    roots
}

fn scan_dir(root: &Path, source_type: &str, out: &mut BTreeMap<String, PluginInfo>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(manifest) = read_manifest(&dir) else {
            continue;
        };
        // 后扫描的覆盖先扫描的：用户插件覆盖内置同名插件
        out.insert(manifest.id.clone(), to_info(&dir, manifest, source_type));
    }
}

#[tauri::command]
pub fn scan_plugins(app: AppHandle, state: State<'_, AppState>) -> ApiResult<Vec<PluginInfo>> {
    let mut map: BTreeMap<String, PluginInfo> = BTreeMap::new();

    for root in builtin_roots(&app) {
        scan_dir(&root, "builtin", &mut map);
    }
    scan_dir(&state.user_plugins_dir(), "local", &mut map);

    // 预览服务据此把 /plugin/{id}/* 映射到磁盘
    let mut roots = state
        .plugin_roots
        .lock()
        .map_err(|_| ApiError::internal("插件注册表锁失效"))?;
    roots.clear();
    for (id, info) in &map {
        roots.insert(id.clone(), PathBuf::from(&info.dir));
    }

    let mut list: Vec<PluginInfo> = map.into_values().collect();
    list.sort_by(|a, b| {
        let rank = |s: &str| if s == "builtin" { 0 } else { 1 };
        rank(&a.source.r#type)
            .cmp(&rank(&b.source.r#type))
            .then_with(|| a.name.cmp(&b.name))
    });

    // 插件目录监听只启动一次：每次刷新都重建 watcher 会让「改文件」变成「越改越多监听」
    start_plugin_watch(&app, &state);
    Ok(list)
}

fn start_plugin_watch(app: &AppHandle, state: &State<'_, AppState>) {
    let Ok(mut guard) = state.plugins_watch.lock() else {
        return;
    };
    if guard.is_some() {
        return;
    }
    let mut roots = builtin_roots(app);
    roots.push(state.user_plugins_dir());
    roots.dedup();
    match crate::watcher::start_plugins(app.clone(), roots) {
        Ok(handle) => *guard = Some(handle),
        Err(err) => log::warn!("插件目录监听未启动：{err}"),
    }
}

fn copy_dir(from: &Path, to: &Path) -> ApiResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

/// 安装只做「复制 + 校验 manifest」，绝不执行任何脚本（§5.9）。
#[tauri::command]
pub fn install_plugin(src: String, state: State<'_, AppState>) -> ApiResult<PluginInfo> {
    let dir = PathBuf::from(&src);
    let manifest =
        read_manifest(&dir).ok_or_else(|| ApiError::denied("目录内没有有效的 manifest.json"))?;
    if manifest.trust == "builtin" {
        return Err(ApiError::denied("第三方插件不能声明 trust=builtin"));
    }
    let target = state.user_plugins_dir().join(&manifest.id);
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    copy_dir(&dir, &target)?;
    Ok(to_info(&target, manifest, "local"))
}

#[tauri::command]
pub fn remove_plugin(id: String, state: State<'_, AppState>) -> ApiResult<()> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(ApiError::denied("非法插件 id"));
    }
    let target = state.user_plugins_dir().join(&id);
    if !target.exists() {
        return Err(ApiError::not_found("该插件不是用户安装的，无法移除"));
    }
    std::fs::remove_dir_all(&target).map_err(ApiError::io)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_plugin(dir: &Path, id: &str, entry: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{"id":"{id}","name":"{id}","version":"1.0.0","apiVersion":1,"entry":"entry.js","match":{{"fence":["demo"]}}}}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("entry.js"), entry).unwrap();
    }

    #[test]
    fn capability_is_sniffed_from_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("a");
        write_plugin(&dir, "a", "export function register(md, ctx){ ctx.onFence(['x'], ()=> '') }");
        let manifest = read_manifest(&dir).unwrap();
        assert_eq!(sniff_capability(&dir, &manifest), "L1");

        let dir2 = tmp.path().join("b");
        write_plugin(&dir2, "b", "export function register(md, ctx){ ctx.onMount('.x', () => {}) }");
        assert_eq!(sniff_capability(&dir2, &read_manifest(&dir2).unwrap()), "L2");

        let dir3 = tmp.path().join("c");
        write_plugin(&dir3, "c", "export function register(md, ctx){ ctx.net }");
        assert_eq!(sniff_capability(&dir3, &read_manifest(&dir3).unwrap()), "L3");
    }

    #[test]
    fn incompatible_api_version_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("old");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            r#"{"id":"old","name":"old","version":"1","apiVersion":9}"#,
        )
        .unwrap();
        assert!(read_manifest(&dir).is_none());
    }

    #[test]
    fn scans_builtin_plugins_from_frontend_plugins() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let plugins_root = manifest_dir.join("../frontend/plugins");
        let mut map = BTreeMap::new();
        scan_dir(&plugins_root, "builtin", &mut map);
        assert!(map.contains_key("callout"), "缺少 callout 插件");
        assert!(map.contains_key("table-gfm"), "缺少 table-gfm 插件");
        assert!(map.contains_key("heading-number"), "缺少 heading-number 插件");
        assert!(map.contains_key("mermaid"), "缺少 mermaid 插件");
        assert!(map.contains_key("katex"), "缺少 katex 插件");
        assert!(map.contains_key("codebar"), "缺少 codebar 插件");
        assert!(map.contains_key("dialogue"), "缺少 dialogue 插件");
        assert!(map.contains_key("typographer"), "缺少 typographer 插件");
        assert_eq!(map.get("mermaid").unwrap().capability, "L2");
        assert_eq!(map.get("typographer").unwrap().capability, "L0");
        assert_eq!(map.get("callout").unwrap().capability, "L1");
    }
}
