//! 单实例与命令行打开（ARCHITECTURE §9.7）。
//!
//! 刻意不引第三方单实例插件：主实例在回环地址上持有一个固定端口作为实例锁，
//! 后续实例连上后写一行 `GE1 <path>` 即退出；主实例收到后聚焦窗口并按需打开文件。
//! 端口被无关程序占用时降级为「无单实例保护」，绝不因此启动失败。

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

const PORT: u16 = 47_821;
/// 握手魔数：用来区分「我们的主实例」和「恰好占用该端口的其它程序」
const MAGIC: &str = "GE1";
const HANDSHAKE_TIMEOUT: Duration = Duration::from_millis(600);

pub enum Acquired {
    /// 本进程是主实例；`Receiver` 给出后续实例转交的路径（None 表示只要求聚焦）
    Primary(Receiver<Option<String>>),
    /// 已有实例在跑，参数已转交，本进程应直接退出
    Forwarded,
    /// 端口被无关程序占用：照常启动，只是没有单实例保护
    Degraded,
}

/// 从 argv 里挑出可打开的文件：跳过 `--flag` 与不存在的路径。
pub fn doc_arg(args: &[String]) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

pub fn acquire(initial: Option<PathBuf>) -> Acquired {
    match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => Acquired::Primary(spawn_listener(listener)),
        Err(_) => {
            if forward(PORT, initial.as_ref()) {
                Acquired::Forwarded
            } else {
                Acquired::Degraded
            }
        }
    }
}

fn spawn_listener(listener: TcpListener) -> Receiver<Option<String>> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let Ok(mut writer) = stream.try_clone() else {
                continue;
            };
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let Some(rest) = line.trim_end().strip_prefix(MAGIC) else {
                continue;
            };
            if writer.write_all(b"OK\n").is_err() {
                continue;
            }
            let path = rest.trim();
            let payload = if path.is_empty() {
                None
            } else {
                Some(path.to_string())
            };
            if tx.send(payload).is_err() {
                break;
            }
        }
    });
    rx
}

/// 把参数转交给主实例。只有收到 `OK` 才算转交成功——
/// 否则说明端口上跑的是别的程序，此时本进程必须继续启动，不能静默退出。
fn forward(port: u16, initial: Option<&PathBuf>) -> bool {
    let Ok(addr) = format!("127.0.0.1:{port}").parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let path = initial
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if writeln!(stream, "{MAGIC} {path}").is_err() {
        return false;
    }
    let mut ack = String::new();
    BufReader::new(stream).read_line(&mut ack).is_ok() && ack.trim() == "OK"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_first_existing_file_and_skips_flags() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        std::fs::write(&doc, "# hi").unwrap();
        let argv = args(&[
            "goldenedit.exe",
            "--flag",
            "not-a-file.md",
            &doc.to_string_lossy(),
        ]);
        assert_eq!(doc_arg(&argv), Some(doc));
    }

    #[test]
    fn no_file_argument_yields_none() {
        assert_eq!(doc_arg(&args(&["goldenedit.exe"])), None);
        assert_eq!(doc_arg(&args(&["goldenedit.exe", "--help"])), None);
    }

    #[test]
    fn second_acquire_forwards_to_first() {
        // 端口用 0 让系统分配，避免与真机运行中的实例抢固定端口
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let rx = spawn_listener(listener);
        assert!(forward(port, None));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), None);
    }

    #[test]
    fn forward_reports_failure_when_nobody_listens() {
        // 先拿到一个空闲端口再释放，确保没有监听者
        let port = {
            let probe = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            probe.local_addr().unwrap().port()
        };
        assert!(!forward(port, None));
    }
}
