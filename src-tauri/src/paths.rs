//! 路径守卫：全应用唯一允许拼接用户输入路径的模块（ARCHITECTURE §9.2）。
//!
//! 四条规则：
//! 1. 拒绝绝对路径、盘符、UNC（`\\`）、`..` 段；
//! 2. `canonicalize` 后校验 `starts_with(vault_root)`；
//! 3. Windows 下比较前统一小写并剥离长路径前缀 `\\?\`；
//! 4. 符号链接一律解析后校验，解析失败即拒绝。

use std::path::{Component, Path, PathBuf};

use crate::error::{ApiError, ApiResult};

/// 纯字符串层面的校验，不触碰文件系统。
pub fn validate_rel(rel: &str) -> ApiResult<PathBuf> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Err(ApiError::denied("路径为空"));
    }
    if trimmed.contains('\0') {
        return Err(ApiError::denied("路径包含非法字符"));
    }
    // 绝对路径 / 盘符 / UNC：三种形式都在这里拦掉，不交给后续处理
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(ApiError::denied("不允许绝对路径"));
    }
    if trimmed.contains(':') {
        return Err(ApiError::denied("不允许盘符或附加数据流"));
    }

    let mut clean = PathBuf::new();
    for seg in trimmed.split(['/', '\\']) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err(ApiError::denied("不允许 .. 路径段"));
        }
        if is_reserved_name(seg) {
            return Err(ApiError::denied(format!("系统保留名不可用：{seg}")));
        }
        clean.push(seg);
    }
    if clean.as_os_str().is_empty() {
        return Err(ApiError::denied("路径为空"));
    }
    Ok(clean)
}

/// Windows 设备名。写进这些名字会落到设备而非文件，必须拒绝。
fn is_reserved_name(seg: &str) -> bool {
    let base = seg.split('.').next().unwrap_or(seg).to_ascii_uppercase();
    const NAMES: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    NAMES.contains(&base.as_str())
}

fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        let rest = rest.strip_prefix("UNC").map(|r| format!(r"\\{r}")).unwrap_or_else(|| rest.to_string());
        return PathBuf::from(rest);
    }
    p.to_path_buf()
}

fn norm(path: &Path) -> String {
    let s = strip_verbatim(path).to_string_lossy().replace('/', "\\");
    let s = s.trim_end_matches('\\').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// 目标是否位于 root 之内（Windows 下大小写不敏感）。
pub fn is_inside(root: &Path, target: &Path) -> bool {
    let r = norm(root);
    let t = norm(target);
    !r.is_empty() && (t == r || t.starts_with(&format!("{r}\\")))
}

/// 把用户传入的 `rel` 解析成绝对路径，并做全部校验。
/// 目标不存在时，校验其父目录——新建 / 重命名都需要这条路径。
pub fn resolve_in_vault(root: &Path, rel: &str) -> ApiResult<PathBuf> {
    let rel_path = validate_rel(rel)?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| ApiError::denied(format!("工作区不可访问：{e}")))?;

    let joined = canon_root.join(&rel_path);
    let resolved = if joined.exists() {
        joined
            .canonicalize()
            .map_err(|e| ApiError::denied(format!("路径不可解析：{e}")))?
    } else {
        let parent = joined
            .parent()
            .ok_or_else(|| ApiError::denied("路径无父目录"))?;
        let canon_parent = parent
            .canonicalize()
            .map_err(|_| ApiError::denied("父目录不存在"))?;
        match joined.file_name() {
            Some(name) => canon_parent.join(name),
            None => canon_parent,
        }
    };

    if !is_inside(&canon_root, &resolved) {
        return Err(ApiError::denied("路径越出工作区"));
    }
    Ok(resolved)
}

/// vault 的稳定标识：用于 `ui-state.json` 的 key，不随大小写或长路径前缀变化。
pub fn vault_id(root: &Path) -> String {
    let key = norm(root);
    let digest = crate::hash::sha256_hex(key.as_bytes());
    digest[..12].to_string()
}

/// 把绝对路径转成相对 vault 的 `/` 分隔路径，用于事件回推。
pub fn to_rel(root: &Path, target: &Path) -> Option<String> {
    let r = strip_verbatim(root);
    let t = strip_verbatim(target);
    let rel = t.strip_prefix(&r).ok()?;
    let mut parts: Vec<String> = Vec::new();
    for c in rel.components() {
        if let Component::Normal(seg) = c {
            parts.push(seg.to_string_lossy().to_string());
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn vault() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("docs/nested")).unwrap();
        fs::write(root.join("docs/a.md"), "hello").unwrap();
        (dir, root)
    }

    #[test]
    fn rejects_absolute_path() {
        assert_eq!(validate_rel("C:/windows/system32").unwrap_err().code, "DENIED");
        assert_eq!(validate_rel("/etc/passwd").unwrap_err().code, "DENIED");
    }

    #[test]
    fn rejects_parent_segments() {
        assert_eq!(validate_rel("../secret.md").unwrap_err().code, "DENIED");
        assert_eq!(validate_rel("docs/../../x.md").unwrap_err().code, "DENIED");
        assert_eq!(validate_rel(r"docs\..\..\x.md").unwrap_err().code, "DENIED");
    }

    #[test]
    fn rejects_unc_path() {
        assert_eq!(validate_rel(r"\\server\share\x.md").unwrap_err().code, "DENIED");
    }

    #[test]
    fn rejects_device_names_and_ads() {
        assert_eq!(validate_rel("CON").unwrap_err().code, "DENIED");
        assert_eq!(validate_rel("docs/nul.md").unwrap_err().code, "DENIED");
        assert_eq!(validate_rel("docs/a.md:hidden").unwrap_err().code, "DENIED");
    }

    #[test]
    fn resolves_nested_relative_path() {
        let (_g, root) = vault();
        let p = resolve_in_vault(&root, "docs/a.md").unwrap();
        assert!(p.ends_with("a.md"));
        assert!(is_inside(&root, &p));
    }

    #[test]
    fn resolves_not_yet_existing_target() {
        let (_g, root) = vault();
        let p = resolve_in_vault(&root, "docs/new.md").expect("允许对尚不存在的文件做校验");
        assert!(is_inside(&root, &p));
    }

    #[cfg(windows)]
    #[test]
    fn case_difference_is_tolerated() {
        let (_g, root) = vault();
        // 大小写不同的绝对路径指同一目录，必须被认作「在工作区内」
        let upper = PathBuf::from(root.to_string_lossy().to_uppercase());
        assert!(is_inside(&upper, &root.join("docs/a.md")) || is_inside(&root, &upper.join("docs/a.md")));
        assert!(resolve_in_vault(&upper, "docs/a.md").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_prefix_is_normalized() {
        let (_g, root) = vault();
        let verbatim = PathBuf::from(format!(r"\\?\{}", root.display()));
        assert!(is_inside(&verbatim, &root.join("docs/a.md")));
    }

    #[cfg(windows)]
    #[test]
    fn rejects_symlink_escape() {
        let (_g, root) = vault();
        let outside = tempfile::tempdir().unwrap();
        let link = root.join("escape");
        // 无权限创建符号链接时跳过（Windows 需开发者模式）
        if std::os::windows::fs::symlink_dir(outside.path(), &link).is_err() {
            return;
        }
        assert_eq!(
            resolve_in_vault(&root, "escape").unwrap_err().code,
            "DENIED",
            "符号链接解析后越界必须拒绝"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let (_g, root) = vault();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("escape")).unwrap();
        assert_eq!(resolve_in_vault(&root, "escape").unwrap_err().code, "DENIED");
    }

    #[test]
    fn vault_id_is_stable_across_case() {
        let (_g, root) = vault();
        let a = vault_id(&root);
        let b = vault_id(&PathBuf::from(root.to_string_lossy().to_uppercase()));
        assert_eq!(a, b);
        assert_eq!(a.len(), 12);
    }

    #[test]
    fn to_rel_round_trips() {
        let (_g, root) = vault();
        let p = root.join("docs").join("nested");
        assert_eq!(to_rel(&root, &p).as_deref(), Some("docs/nested"));
    }
}
