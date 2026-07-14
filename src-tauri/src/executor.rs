use crate::{
    command_builder::build_download_args,
    error::{AppError, AppResult},
    history::record_completed_download,
    manifest::ManifestStore,
    models::{AppStatus, DownloadJob, DownloadSpec, Tool},
    ActiveDownload, AppState,
};
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    job_id: &'a str,
    line: &'a str,
    stream: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent<'a> {
    job_id: &'a str,
    output_path: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent<'a> {
    job_id: &'a str,
    message: &'a str,
    code: Option<i32>,
}

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> AppResult<AppStatus> {
    let store = ManifestStore::new(state.app_data.clone());
    let manifest = store.read()?;
    let active_job_id = state
        .active_download
        .lock()
        .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?
        .as_ref()
        .map(|download| download.job_id.clone());
    Ok(AppStatus::from_manifest(&manifest, active_job_id))
}

#[tauri::command]
pub fn set_output_directory(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let requested = PathBuf::from(path.trim());
    if !requested.is_absolute() {
        return Err(AppError::Message("輸出資料夾必須是絕對路徑".into()));
    }
    if requested.exists() && !requested.is_dir() {
        return Err(AppError::Message("選取的輸出位置不是資料夾".into()));
    }
    fs::create_dir_all(&requested)?;
    let canonical = requested.canonicalize()?;
    let store = ManifestStore::new(state.app_data.clone());
    let mut manifest = store.read()?;
    manifest.settings.output_directory = canonical.to_string_lossy().into_owned();
    store.write(&manifest)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: DownloadSpec,
) -> AppResult<DownloadJob> {
    {
        let active = state
            .active_download
            .lock()
            .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?;
        if active.is_some() {
            return Err(AppError::Message("目前已有下載任務進行中".into()));
        }
    }

    let store = ManifestStore::new(state.app_data.clone());
    let manifest = store.read()?;
    let ytdlp = store.selected_path(&manifest, Tool::YtDlp)?;
    let ffmpeg = store.selected_path(&manifest, Tool::Ffmpeg)?;
    let deno = store.selected_path(&manifest, Tool::Deno)?;
    let ffmpeg_directory = ffmpeg
        .parent()
        .ok_or_else(|| AppError::Message("ffmpeg 路徑無效".into()))?;
    let output_directory = PathBuf::from(&manifest.settings.output_directory);
    if !output_directory.is_absolute() {
        return Err(AppError::Message("請先設定有效的輸出資料夾".into()));
    }
    fs::create_dir_all(&output_directory)?;

    let arguments = build_download_args(&spec, ffmpeg_directory, &deno, &output_directory)?;
    let expected_output = output_directory.join(format!("{}.mp4", spec.output_name.trim()));
    let (receiver, child) = app.shell().command(&ytdlp).args(arguments).spawn()?;
    let job_id = format!(
        "download-{}-{}",
        child.pid(),
        chrono::Utc::now().timestamp_millis()
    );
    let output_path = expected_output.to_string_lossy().into_owned();

    {
        let mut active = state
            .active_download
            .lock()
            .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?;
        if active.is_some() {
            let _ = child.kill();
            return Err(AppError::Message("目前已有下載任務進行中".into()));
        }
        *active = Some(ActiveDownload {
            job_id: job_id.clone(),
            child: Some(child),
            cancelled: false,
        });
    }

    let app_for_task = app.clone();
    let job_for_task = job_id.clone();
    let output_for_task = output_path.clone();
    let spec_for_task = spec.clone();
    tauri::async_runtime::spawn(async move {
        monitor_download(
            app_for_task,
            job_for_task,
            spec_for_task,
            output_for_task,
            receiver,
        )
        .await;
    });

    Ok(DownloadJob {
        job_id,
        output_path,
    })
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, job_id: String) -> AppResult<()> {
    let mut active = state
        .active_download
        .lock()
        .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?;
    let download = active
        .as_mut()
        .ok_or_else(|| AppError::Message("目前沒有進行中的下載".into()))?;
    if download.job_id != job_id {
        return Err(AppError::Message("下載任務識別碼不符".into()));
    }
    download.cancelled = true;
    let child = download
        .child
        .take()
        .ok_or_else(|| AppError::Message("下載任務已在停止中".into()))?;
    terminate_child_tree(child)
}

#[tauri::command]
pub fn reveal_output(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    let store = ManifestStore::new(state.app_data.clone());
    let manifest = store.read()?;
    let output_root = PathBuf::from(manifest.settings.output_directory).canonicalize()?;
    let requested = PathBuf::from(path).canonicalize()?;
    if !requested.starts_with(&output_root) {
        return Err(AppError::Message("只能開啟目前輸出資料夾內的檔案".into()));
    }
    app.opener()
        .reveal_item_in_dir(&requested)
        .map_err(|error| AppError::Message(format!("無法開啟檔案位置：{error}")))
}

async fn monitor_download(
    app: AppHandle,
    job_id: String,
    spec: DownloadSpec,
    expected_output: String,
    mut receiver: tokio::sync::mpsc::Receiver<CommandEvent>,
) {
    let mut final_output = expected_output;
    let mut saw_termination = false;
    while let Some(event) = receiver.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                    if let Some(progress) = parse_progress(line) {
                        let _ = app.emit(
                            "download-progress",
                            ProgressEvent {
                                job_id: &job_id,
                                percent: progress.percent,
                                speed: progress.speed,
                                eta: progress.eta,
                            },
                        );
                    } else if let Some(path) = line.strip_prefix("FINAL ") {
                        final_output = path.trim().to_owned();
                    } else {
                        let _ = app.emit(
                            "download-log",
                            LogEvent {
                                job_id: &job_id,
                                line,
                                stream: "stdout",
                            },
                        );
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                    let _ = app.emit(
                        "download-log",
                        LogEvent {
                            job_id: &job_id,
                            line,
                            stream: "stderr",
                        },
                    );
                }
            }
            CommandEvent::Terminated(payload) => {
                saw_termination = true;
                let cancelled = clear_active_download(&app, &job_id);
                if cancelled {
                    let _ = app.emit(
                        "download-error",
                        ErrorEvent {
                            job_id: &job_id,
                            message: "下載已取消",
                            code: payload.code,
                        },
                    );
                } else if payload.code == Some(0) {
                    if let Err(error) =
                        record_completed_download(&app, &job_id, &spec, &final_output)
                    {
                        let warning = format!("無法保存下載紀錄：{error}");
                        let _ = app.emit(
                            "download-log",
                            LogEvent {
                                job_id: &job_id,
                                line: &warning,
                                stream: "stderr",
                            },
                        );
                    }
                    let _ = app.emit(
                        "download-done",
                        DoneEvent {
                            job_id: &job_id,
                            output_path: &final_output,
                        },
                    );
                } else {
                    let _ = app.emit(
                        "download-error",
                        ErrorEvent {
                            job_id: &job_id,
                            message: "yt-dlp 執行失敗，請展開日誌查看詳細資訊",
                            code: payload.code,
                        },
                    );
                }
                break;
            }
            _ => {}
        }
    }
    if !saw_termination {
        clear_active_download(&app, &job_id);
        let _ = app.emit(
            "download-error",
            ErrorEvent {
                job_id: &job_id,
                message: "下載程序意外中止",
                code: None,
            },
        );
    }
}

struct ParsedProgress {
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
}

fn parse_progress(line: &str) -> Option<ParsedProgress> {
    let mut parts = line.strip_prefix("PROGRESS ")?.split_whitespace();
    let percent = parts.next()?.trim_end_matches('%').parse().ok()?;
    let speed = normalize_progress_value(parts.next());
    let eta = normalize_progress_value(parts.next());
    Some(ParsedProgress {
        percent,
        speed,
        eta,
    })
}

fn normalize_progress_value(value: Option<&str>) -> Option<String> {
    value
        .filter(|value| !matches!(*value, "NA" | "N/A" | "Unknown"))
        .map(str::to_owned)
}

fn clear_active_download(app: &AppHandle, job_id: &str) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut active) = state.active_download.lock() else {
        return false;
    };
    if active
        .as_ref()
        .is_some_and(|download| download.job_id == job_id)
    {
        return active.take().is_some_and(|download| download.cancelled);
    }
    false
}

#[cfg(windows)]
fn terminate_child_tree(child: tauri_plugin_shell::process::CommandChild) -> AppResult<()> {
    let pid = child.pid().to_string();
    let tree_result = std::process::Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .status();
    let direct_result = child.kill();
    match (tree_result, direct_result) {
        (Ok(status), _) if status.success() => Ok(()),
        (_, Ok(())) => Ok(()),
        (_, Err(error)) => Err(error.into()),
    }
}

#[cfg(not(windows))]
fn terminate_child_tree(child: tauri_plugin_shell::process::CommandChild) -> AppResult<()> {
    child.kill().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stable_progress_template() {
        let progress = parse_progress("PROGRESS 42.3% 5.20MiB/s 00:12").unwrap();
        assert!((progress.percent - 42.3).abs() < f64::EPSILON);
        assert_eq!(progress.speed.as_deref(), Some("5.20MiB/s"));
        assert_eq!(progress.eta.as_deref(), Some("00:12"));
    }

    #[test]
    fn accepts_unknown_speed_and_eta() {
        let progress = parse_progress("PROGRESS 1.0% NA N/A").unwrap();
        assert_eq!(progress.speed, None);
        assert_eq!(progress.eta, None);
    }
}
