mod binary_manager;
mod command_builder;
mod error;
mod executor;
mod external_navigation;
mod history;
mod manifest;
mod models;
mod vod_library;

#[cfg(all(target_os = "windows", not(target_arch = "x86_64")))]
compile_error!("Windows releases currently support only x86_64-pc-windows-msvc");

use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::CommandChild;

pub(crate) struct ActiveDownload {
    pub job_id: String,
    pub child: Option<CommandChild>,
    pub cancelled: bool,
    pub status: models::ActiveDownloadStatus,
}

pub(crate) struct AppState {
    pub app_data: PathBuf,
    pub active_download: Mutex<Option<ActiveDownload>>,
    pub history_lock: Mutex<()>,
    pub install_lock: tokio::sync::Mutex<()>,
    pub vod_library_cache: tokio::sync::Mutex<Option<vod_library::CachedVodLibrary>>,
}

impl AppState {
    fn new(app_data: PathBuf) -> Self {
        Self {
            app_data,
            active_download: Mutex::new(None),
            history_lock: Mutex::new(()),
            install_lock: tokio::sync::Mutex::new(()),
            vod_library_cache: tokio::sync::Mutex::new(None),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_single_instance::init(
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
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or_else(|| std::io::Error::other("missing main window configuration"))?;
            let app_handle = app.handle().clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &main_window_config)?
                .on_new_window(move |url, _features| {
                    if external_navigation::can_open_in_system_browser(&url) {
                        if let Err(error) = app_handle.opener().open_url(url.as_str(), None::<&str>)
                        {
                            eprintln!("failed to open external URL: {error}");
                        }
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;

            let app_data = app.path().app_data_dir()?;
            let output_directory = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| app_data.clone())
                .join("OshiClip");
            manifest::ManifestStore::new(app_data.clone())
                .initialize(output_directory)
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            app.manage(AppState::new(app_data));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            executor::get_app_status,
            executor::get_download_diagnostics,
            executor::set_output_directory,
            executor::start_download,
            executor::cancel_download,
            executor::reveal_output,
            history::list_download_history,
            history::remove_download_history,
            history::clear_download_history,
            history::reveal_history_output,
            binary_manager::list_available_versions,
            binary_manager::install_tool,
            binary_manager::switch_tool_version,
            binary_manager::remove_tool_version,
            vod_library::get_vod_library,
            vod_library::get_vod_streamer_avatar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OshiClip");
}
