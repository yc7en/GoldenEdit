mod commands;
mod error;
mod hash;
mod jsonstore;
mod paths;
mod preview_server;
mod state;
mod watcher;

use serde::Serialize;
use state::AppState;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("GoldenEdit"));
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(data_dir.join("plugins"))?;
            app.manage(AppState::new(data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            commands::vault::open_vault,
            commands::vault::close_vault,
            commands::vault::list_dir,
            commands::vault::create_entry,
            commands::vault::rename_entry,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running GoldenEdit");
}
