mod commands;
mod error;
mod hash;
mod instance;
mod jsonstore;
mod paths;
mod preview_server;
mod state;
mod watcher;

use serde::Serialize;
use state::AppState;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: String,
    data_dir: String,
}

#[tauri::command]
fn get_app_info(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
    }
}

/// 启动参数里带的文件（双击 `.md` 或 `goldenedit a.md`）。
/// 前端在监听器就绪前无法收事件，所以这里让前端主动取一次，取完即清。
#[tauri::command]
fn take_pending_open(state: tauri::State<'_, AppState>) -> Option<String> {
    state
        .pending_open
        .lock()
        .ok()
        .and_then(|mut cell| cell.take())
}

#[tauri::command]
fn open_plugins_dir(state: tauri::State<'_, AppState>) -> Result<(), error::ApiError> {
    let dir = state.user_plugins_dir();
    std::fs::create_dir_all(&dir)?;
    open::that_detached(dir).map_err(error::ApiError::io)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let argv: Vec<String> = std::env::args().collect();
    let initial = instance::doc_arg(&argv);
    let (incoming, primary) = match instance::acquire(initial.clone()) {
        // 已有实例接手了参数，本进程不该再开一个窗口
        instance::Acquired::Forwarded => return,
        instance::Acquired::Primary(rx) => (Some(rx), true),
        instance::Acquired::Degraded => (None, false),
    };

    tauri::Builder::default()
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("GoldenEdit"));
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(data_dir.join("plugins"))?;
            let mut state = AppState::new(data_dir);
            state.pending_open = std::sync::Mutex::new(
                initial
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string()),
            );
            app.manage(state);

            if !primary {
                log::warn!("单实例端口被其它程序占用，本次启动未启用单实例保护");
            }

            if let Some(rx) = incoming {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    while let Ok(path) = rx.recv() {
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                        if let Some(path) = path {
                            let _ = handle.emit("app:open-file", serde_json::json!({ "path": path }));
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            take_pending_open,
            open_plugins_dir,
            commands::vault::open_vault,
            commands::vault::close_vault,
            commands::vault::list_dir,
            commands::vault::create_entry,
            commands::vault::rename_entry,
            commands::vault::copy_entry,
            commands::vault::delete_entry,
            commands::vault::reveal_in_explorer,
            commands::vault::watch_vault,
            commands::vault::unwatch_vault,
            commands::vault::set_active_doc,
            commands::doc::read_doc,
            commands::doc::write_doc,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::get_ui_state,
            commands::settings::set_ui_state,
            commands::plugin::scan_plugins,
            commands::plugin::install_plugin,
            commands::plugin::remove_plugin,
            commands::system::start_preview_server,
            commands::system::stop_preview_server,
            commands::system::open_external,
            commands::system::pick_folder,
            commands::system::pick_file,
            commands::system::save_dialog,
            commands::system::git_log,
            commands::export::save_export,
            commands::export::export_pdf,
            commands::perf::perf_plan,
            commands::perf::perf_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GoldenEdit");
}
