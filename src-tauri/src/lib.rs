mod binary_manager;
mod command_builder;
mod error;
mod executor;
mod manifest;
mod models;

#[cfg(all(target_os = "windows", not(target_arch = "x86_64")))]
compile_error!("Windows releases currently support only x86_64-pc-windows-msvc");

use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;

pub(crate) struct ActiveDownload {
    pub job_id: String,
    pub child: Option<CommandChild>,
    pub cancelled: bool,
}

pub(crate) struct AppState {
    pub app_data: PathBuf,
    pub active_download: Mutex<Option<ActiveDownload>>,
    pub install_lock: tokio::sync::Mutex<()>,
}

impl AppState {
    fn new(app_data: PathBuf) -> Self {
        Self {
            app_data,
            active_download: Mutex::new(None),
            install_lock: tokio::sync::Mutex::new(()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let output_directory = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| app_data.clone())
                .join("VODS Oshi");
            manifest::ManifestStore::new(app_data.clone())
                .initialize(output_directory)
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(AppState::new(app_data));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            executor::get_app_status,
            executor::set_output_directory,
            executor::start_download,
            executor::cancel_download,
            executor::reveal_output,
            binary_manager::list_available_versions,
            binary_manager::install_tool,
            binary_manager::switch_tool_version,
            binary_manager::remove_tool_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VODS Oshi");
}
