use serde_json::{json, Value};
use tauri::State;

use crate::error::{ApiError, ApiResult};
use crate::jsonstore::{deep_merge, read_json, write_json_atomic};
use crate::state::AppState;

/// 设置的默认值在这里定义，前端 `Settings` 类型与之一一对应。
pub fn default_settings() -> Value {
    json!({
        "theme": { "preset": "writing", "editor": "dark", "preview": "light" },
        "preview": {
            "width": 980,
            "syncScroll": false,
            "pauseAboveMb": 10,
            "customCss": ""
        },
        "export": {
            "format": "html",
            "width": 980,
            "inlineImages": true,
            "inlinePluginCss": true,
            "inlinePluginScripts": false
        },
        "plugins": { "enabled": [], "config": {} },
        "recents": [],
        "lastVault": null
    })
}

fn merged(path: &std::path::Path, defaults: Value) -> Value {
    let mut value = defaults;
    if let Some(stored) = read_json(path) {
        deep_merge(&mut value, &stored);
    }
    value
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> ApiResult<Value> {
    Ok(merged(&state.settings_path(), default_settings()))
}

#[tauri::command]
pub fn set_settings(patch: Value, state: State<'_, AppState>) -> ApiResult<Value> {
    if !patch.is_object() {
        return Err(ApiError::denied("设置补丁必须是对象"));
    }
    let path = state.settings_path();
    let mut current = merged(&path, default_settings());
    deep_merge(&mut current, &patch);
    write_json_atomic(&path, &current)?;
    Ok(current)
}

#[tauri::command]
pub fn get_ui_state(state: State<'_, AppState>) -> ApiResult<Value> {
    Ok(read_json(&state.ui_state_path()).unwrap_or_else(|| json!({})))
}

#[tauri::command]
pub fn set_ui_state(patch: Value, state: State<'_, AppState>) -> ApiResult<Value> {
    if !patch.is_object() {
        return Err(ApiError::denied("界面状态补丁必须是对象"));
    }
    let path = state.ui_state_path();
    let mut current = read_json(&path).unwrap_or_else(|| json!({}));
    deep_merge(&mut current, &patch);
    write_json_atomic(&path, &current)?;
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_cover_every_frontend_field() {
        let v = default_settings();
        for key in ["theme", "preview", "export", "plugins", "recents", "lastVault"] {
            assert!(v.get(key).is_some(), "缺少默认字段 {key}");
        }
        assert_eq!(v["theme"]["preset"], "writing");
    }
}
