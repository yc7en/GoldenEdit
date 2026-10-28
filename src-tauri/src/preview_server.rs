//! 本地预览服务（ARCHITECTURE §9.4）。
//!
//! 存在的理由：`sandbox="allow-scripts"` 的 iframe 是 opaque origin，自定义协议在该场景下
//! 加载图片与字体会失败。改由本地 HTTP 同源提供后，问题整体消失，CSP 也完全由自己掌控。
//!
//! 路由：
//!   GET /p/{token}/shell            → 302 到 /shell/
//!   GET /p/{token}/shell/           → 预览外壳页（带 CSP）
//!   GET /p/{token}/shell/{path}     → 外壳静态资源
//!   GET /p/{token}/plugin/{id}/{p}  → 仅 entry.js / style.css / assets/*
//!   GET /p/{token}/asset?p={rel}    → vault 内图片与字体（扩展名白名单）
//!   其它                            → 404；token 错误一律 403

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::error::{ApiError, ApiResult};
use crate::paths;

const ASSET_EXT: [&str; 13] = [
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico", "woff", "woff2", "ttf",
    "otf",
];

#[derive(Serialize, Clone, Debug)]
pub struct ServerInfo {
    pub port: u16,
    pub token: String,
    pub origin: String,
}

/// 插件文件根目录表，id → 目录。后加入的覆盖先加入的（用户插件覆盖内置）。
pub type PluginRoots = Arc<Mutex<HashMap<String, PathBuf>>>;

pub struct PreviewServer {
    pub info: ServerInfo,
    server: Arc<Server>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct Context {
    token: String,
    shell_dir: PathBuf,
    vault: Arc<Mutex<Option<PathBuf>>>,
    plugins: PluginRoots,
    origin: String,
}

impl PreviewServer {
    pub fn start(
        shell_dir: PathBuf,
        vault: Arc<Mutex<Option<PathBuf>>>,
        plugins: PluginRoots,
    ) -> ApiResult<Self> {
        let server = Server::http("127.0.0.1:0")
            .map_err(|e| ApiError::io(format!("预览服务绑定失败：{e}")))?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| ApiError::internal("预览服务地址不可用"))?
            .port();

        // 32 字节随机 token：两段 uuid v4（各 128 bit）拼成 64 位十六进制
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let origin = format!("http://127.0.0.1:{port}");

        let ctx = Context {
            token: token.clone(),
            shell_dir,
            vault,
            plugins,
            origin: origin.clone(),
        };
        let server = Arc::new(server);
        let stop = Arc::new(AtomicBool::new(false));
        let thread = {
            let server = server.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                for request in server.incoming_requests() {
                    if stop.load(Ordering::Relaxed) {
                        let _ = request.respond(Response::empty(StatusCode(503)));
                        break;
                    }
                    if let Err(e) = handle(request, &ctx) {
                        log::warn!("预览服务请求处理失败：{e}");
                    }
                }
            })
        };

        Ok(Self {
            info: ServerInfo { port, token, origin },
            server,
            stop,
            thread: Some(thread),
        })
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        // 唤醒阻塞在 accept 上的线程，让循环退出
        self.server.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for PreviewServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn bad(msg: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut res = Response::from_string(msg).with_status_code(StatusCode(403));
    res.add_header(mime_header("text/plain; charset=utf-8"));
    res
}

fn not_found() -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string("not found").with_status_code(StatusCode(404))
}

/// 沙箱 iframe 的 Origin 是 null，只能用 `*`；数据本身由 token 保护
fn cors_header() -> Header {
    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).expect("静态 CORS 头")
}

fn mime_header(value: &str) -> Header {
    Header::from_bytes(&b"Content-Type"[..], value.as_bytes()).expect("静态 Content-Type")
}

fn mime_of(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// 单个路径段校验：拒绝 `..`、空段、绝对路径、盘符。
fn segment_ok(seg: &str) -> bool {
    !seg.is_empty()
        && seg != "."
        && seg != ".."
        && !seg.contains(':')
        && !seg.contains('\\')
        && !seg.contains('\0')
}

fn join_checked(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        if !segment_ok(seg) {
            return None;
        }
        out.push(seg);
    }
    let canon_root = root.canonicalize().ok()?;
    let canon = out.canonicalize().ok()?;
    if paths::is_inside(&canon_root, &canon) {
        Some(canon)
    } else {
        None
    }
}

fn read_file(path: &Path) -> Option<Vec<u8>> {
    if !path.is_file() {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn csp(origin: &str) -> String {
    format!(
        "default-src 'none'; \
         script-src {origin}; \
         style-src {origin} 'unsafe-inline'; \
         img-src {origin} data:; \
         font-src {origin} data:; \
         media-src {origin} data:; \
         connect-src 'none'; \
         worker-src {origin}; \
         frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"
    )
}

fn handle(request: tiny_http::Request, ctx: &Context) -> std::io::Result<()> {
    if request.method() != &Method::Get && request.method() != &Method::Head {
        let _ = request.respond(not_found());
        return Ok(());
    }
    let url = request.url().to_string();
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (url.clone(), String::new()),
    };

    let rest = match path.strip_prefix("/p/") {
        Some(r) => r,
        None => {
            let _ = request.respond(not_found());
            return Ok(());
        }
    };
    let (token, tail) = match rest.split_once('/') {
        Some((t, tail)) => (t, format!("/{tail}")),
        None => (rest, String::from("/")),
    };
    // token 不对一律 403，且不透露路由是否存在
    if token != ctx.token {
        let _ = request.respond(bad("forbidden"));
        return Ok(());
    }

    if tail.contains("..") {
        let _ = request.respond(bad("forbidden"));
        return Ok(());
    }

    // 外壳页
    if tail == "/shell" {
        let mut res = Response::empty(StatusCode(302));
        if let Ok(h) = Header::from_bytes(
            &b"Location"[..],
            format!("/p/{}/shell/", ctx.token).as_bytes(),
        ) {
            res.add_header(h);
        }
        let _ = request.respond(res);
        return Ok(());
    }

    if let Some(sub) = tail.strip_prefix("/shell/") {
        let target = if sub.is_empty() {
            ctx.shell_dir.join("index.html")
        } else {
            match join_checked(&ctx.shell_dir, sub) {
                Some(p) => p,
                None => {
                    let _ = request.respond(bad("forbidden"));
                    return Ok(());
                }
            }
        };
        let Some(bytes) = read_file(&target) else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let mut res = Response::from_data(bytes);
        res.add_header(mime_header(mime_of(&target)));
        // iframe 是 opaque origin（sandbox），浏览器把它的请求视为跨域。
        // Vite 产出的 <script crossorigin> / 字体 / CSS 都要求 CORS，缺这个头会静默丢弃资源。
        res.add_header(cors_header());
        if target.extension().map(|e| e == "html").unwrap_or(false) {
            if let Ok(h) = Header::from_bytes(&b"Content-Security-Policy"[..], csp(&ctx.origin).as_bytes()) {
                res.add_header(h);
            }
        }
        let _ = request.respond(res);
        return Ok(());
    }

    // 插件文件：只允许 entry.js / style.css / assets/*
    if let Some(sub) = tail.strip_prefix("/plugin/") {
        let Some((id, rel)) = sub.split_once('/') else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let allowed = rel == "entry.js"
            || rel == "style.css"
            || rel == "preview.png"
            || rel.starts_with("assets/");
        if !allowed || rel.split('/').any(|s| !segment_ok(s)) {
            let _ = request.respond(bad("forbidden"));
            return Ok(());
        }
        let root = {
            let map = ctx.plugins.lock().map_err(|_| std::io::Error::other("lock"))?;
            map.get(id).cloned()
        };
        let Some(root) = root else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let Some(target) = join_checked(&root, rel) else {
            let _ = request.respond(bad("forbidden"));
            return Ok(());
        };
        let Some(bytes) = read_file(&target) else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let mut res = Response::from_data(bytes);
        res.add_header(mime_header(mime_of(&target)));
        res.add_header(cors_header());
        let _ = request.respond(res);
        return Ok(());
    }

    // vault 资源
    if tail == "/asset" || tail.starts_with("/asset?") {
        let rel = query
            .split('&')
            .find_map(|kv| kv.strip_prefix("p="))
            .map(|v| percent_decode(v))
            .unwrap_or_default();
        let ext = Path::new(&rel)
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if rel.is_empty() || !ASSET_EXT.contains(&ext.as_str()) {
            let _ = request.respond(bad("forbidden"));
            return Ok(());
        }
        let root = {
            let guard = ctx.vault.lock().map_err(|_| std::io::Error::other("lock"))?;
            guard.clone()
        };
        let Some(root) = root else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let Ok(target) = paths::resolve_in_vault(&root, &rel) else {
            let _ = request.respond(bad("forbidden"));
            return Ok(());
        };
        let Some(bytes) = read_file(&target) else {
            let _ = request.respond(not_found());
            return Ok(());
        };
        let mut res = Response::from_data(bytes);
        res.add_header(mime_header(mime_of(&target)));
        res.add_header(cors_header());
        let _ = request.respond(res);
        return Ok(());
    }

    let _ = request.respond(not_found());
    Ok(())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn harness() -> (tempfile::TempDir, tempfile::TempDir, PreviewServer, Arc<Mutex<Option<PathBuf>>>) {
        let shell = tempfile::tempdir().unwrap();
        std::fs::write(shell.path().join("index.html"), "<html>shell</html>").unwrap();
        std::fs::create_dir_all(shell.path().join("assets")).unwrap();
        std::fs::write(shell.path().join("assets/app.js"), "console.log(1)").unwrap();
        std::fs::write(shell.path().join("secret.txt"), "nope").unwrap();

        let vault = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(vault.path().join("img")).unwrap();
        std::fs::write(vault.path().join("img/a.png"), b"\x89PNG").unwrap();
        std::fs::write(vault.path().join("img/a.exe"), b"MZ").unwrap();

        let vault_cell = Arc::new(Mutex::new(Some(vault.path().to_path_buf())));
        let server = PreviewServer::start(
            shell.path().to_path_buf(),
            vault_cell.clone(),
            Arc::new(Mutex::new(HashMap::new())),
        )
        .unwrap();
        (shell, vault, server, vault_cell)
    }

    fn get(port: u16, path: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        // 资源路由可能返回二进制（图片 / 字体），按 lossy 处理避免测试因编码失败
        let text = String::from_utf8_lossy(&raw).to_string();
        let status = text
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|c| c.parse().ok())
            .unwrap_or(0);
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    #[test]
    fn rejects_missing_or_wrong_token() {
        let (_s, _v, server, _) = harness();
        assert_eq!(get(server.info.port, "/p/nope/shell/").0, 403);
        assert_eq!(get(server.info.port, "/nothing").0, 404);
    }

    #[test]
    fn serves_shell_page_with_csp() {
        let (_s, _v, server, _) = harness();
        let (status, body) = get(server.info.port, &format!("/p/{}/shell/", server.info.token));
        assert_eq!(status, 200);
        assert!(body.contains("shell"));
    }

    #[test]
    fn redirects_bare_shell() {
        let (_s, _v, server, _) = harness();
        let (status, _) = get(server.info.port, &format!("/p/{}/shell", server.info.token));
        assert_eq!(status, 302);
    }

    #[test]
    fn blocks_traversal_in_shell() {
        let (_s, _v, server, _) = harness();
        let (status, _) = get(
            server.info.port,
            &format!("/p/{}/shell/../../../etc/passwd", server.info.token),
        );
        assert_eq!(status, 403);
    }

    #[test]
    fn blocks_traversal_in_plugin_path() {
        let (_s, _v, server, _) = harness();
        let (status, _) = get(
            server.info.port,
            &format!("/p/{}/plugin/x/../../secret", server.info.token),
        );
        assert_eq!(status, 403);
    }

    #[test]
    fn asset_whitelist_and_containment() {
        let (_s, _v, server, _) = harness();
        let token = &server.info.token;
        assert_eq!(get(server.info.port, &format!("/p/{token}/asset?p=img/a.png")).0, 200);
        assert_eq!(get(server.info.port, &format!("/p/{token}/asset?p=img/a.exe")).0, 403);
        assert_eq!(get(server.info.port, &format!("/p/{token}/asset?p=../x.png")).0, 403);
    }

    #[test]
    fn unknown_route_is_404() {
        let (_s, _v, server, _) = harness();
        assert_eq!(get(server.info.port, &format!("/p/{}/whatever", server.info.token)).0, 404);
    }
}
