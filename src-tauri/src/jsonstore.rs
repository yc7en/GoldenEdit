//! JSON 持久化：深合并 + 原子写。设置与界面状态共用这套逻辑。

use std::path::Path;

use serde_json::Value;

use crate::error::{ApiError, ApiResult};

pub fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_json_atomic(path: &Path, value: &Value) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| ApiError::internal(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text.as_bytes())?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// 递归合并：对象逐键合并，其它类型由 patch 覆盖。
pub fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (k, v) in patch_map {
                match base_map.get_mut(k) {
                    Some(slot) => deep_merge(slot, v),
                    None => {
                        base_map.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (slot, v) => *slot = v.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_nested_objects_without_dropping_siblings() {
        let mut base = json!({"theme": {"preset": "writing", "editor": "dark"}, "recents": ["a"]});
        deep_merge(&mut base, &json!({"theme": {"editor": "light"}}));
        assert_eq!(base["theme"]["preset"], "writing");
        assert_eq!(base["theme"]["editor"], "light");
        assert_eq!(base["recents"][0], "a");
    }

    #[test]
    fn array_patch_replaces() {
        let mut base = json!({"recents": ["a", "b"]});
        deep_merge(&mut base, &json!({"recents": ["c"]}));
        assert_eq!(base["recents"], json!(["c"]));
    }
}
