use crate::{
    binary_manager::installation_layout_is_usable,
    command_builder::build_download_args,
    error::{AppError, AppResult},
    history::record_completed_download,
    manifest::ManifestStore,
    models::{
        ActiveDownloadStatus, AppStatus, DownloadJob, DownloadPhase, DownloadSpec, Manifest, Tool,
    },
    ActiveDownload, AppState,
};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const WAITING_AFTER: Duration = Duration::from_secs(30);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
const STALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const WINDOWS_YTDLP_PROBE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_DIAGNOSTIC_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_DIAGNOSTIC_LINE_BYTES: usize = 16 * 1024;
const DIAGNOSTIC_LOGS_TO_KEEP: usize = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    job_id: &'a str,
    line: &'a str,
    stream: &'a str,
    timestamp: &'a str,
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
    let active_download = state
        .active_download
        .lock()
        .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?
        .as_ref()
        .map(|download| download.status.clone());
    let mut status = AppStatus::from_manifest(&manifest, active_download);
    if cfg!(windows) && manifest.tools.get(Tool::YtDlp).selected.is_some() {
        let layout_is_usable = store
            .selected_path(&manifest, Tool::YtDlp)
            .is_ok_and(|path| installation_layout_is_usable(&path, Tool::YtDlp, true));
        if !layout_is_usable {
            if let Some(tool) = status.tools.get_mut(Tool::YtDlp.as_str()) {
                tool.requires_repair = true;
            }
        }
    }
    Ok(status)
}

#[tauri::command]
pub fn get_download_diagnostics(state: State<'_, AppState>, job_id: String) -> AppResult<String> {
    let path = diagnostic_log_path(&state.app_data, &job_id)?;
    fs::read_to_string(&path).map_err(|error| {
        AppError::Message(format!(
            "無法讀取診斷資訊（{}）：{error}",
            path.file_name()
                .and_then(OsStr::to_str)
                .unwrap_or("download.log")
        ))
    })
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
    let request_started = Instant::now();
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
    ensure_ytdlp_runtime_layout(&ytdlp, cfg!(windows))?;
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
    let job_id = format!(
        "download-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    );
    let diagnostic_error = prepare_diagnostic_log(&state.app_data, &job_id)
        .err()
        .map(|error| error.to_string());
    for line in startup_diagnostic_lines(
        &job_id,
        StartupDiagnosticContext {
            manifest: &manifest,
            spec: &spec,
            ytdlp: &ytdlp,
            ffmpeg: &ffmpeg,
            deno: &deno,
            output_directory: &output_directory,
            expected_output: &expected_output,
            arguments: &arguments,
        },
    ) {
        emit_log(&app, &job_id, &line, "diagnostic");
    }
    if let Some(error) = diagnostic_error {
        emit_log(
            &app,
            &job_id,
            &format!("[OshiClip][診斷] 無法建立持久化診斷檔：{error}"),
            "stderr",
        );
    }

    if cfg!(windows) {
        verify_windows_ytdlp(&app, &job_id, &ytdlp).await?;
    }

    let spawn_started = Instant::now();
    let spawn_result = app
        .shell()
        .command(&ytdlp)
        .args(arguments)
        .set_raw_out(true)
        .spawn();
    let (receiver, child) = match spawn_result {
        Ok(process) => process,
        Err(error) => {
            emit_log(
                &app,
                &job_id,
                &format!("[OshiClip][診斷] 正式 yt-dlp 程序無法建立：{error}"),
                "stderr",
            );
            return Err(AppError::Message(format!(
                "無法啟動 yt-dlp：{error}。請展開並複製診斷資訊（ID：{job_id}）。"
            )));
        }
    };
    let child_pid = child.pid();
    emit_log(
        &app,
        &job_id,
        &format!(
            "[OshiClip][診斷] 正式程序已建立：pid={child_pid}; spawnMs={}; requestMs={}",
            spawn_started.elapsed().as_millis(),
            request_started.elapsed().as_millis()
        ),
        "diagnostic",
    );
    let output_path = expected_output.to_string_lossy().into_owned();
    let status = ActiveDownloadStatus {
        job_id: job_id.clone(),
        url: spec.url.trim().to_owned(),
        start_seconds: spec.start_seconds,
        end_seconds: spec.end_seconds,
        output_name: spec.output_name.trim().to_owned(),
        output_path: output_path.clone(),
        format_preset: spec.format_preset,
        started_at: Utc::now().to_rfc3339(),
        phase: DownloadPhase::Preparing,
        percent: None,
        speed: None,
        eta: None,
        downloaded_bytes: 0,
        elapsed_seconds: 0,
    };

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
            status,
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
            child_pid,
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

#[derive(Default)]
struct ProcessOutputStats {
    stdout_bytes: u64,
    stderr_bytes: u64,
    stdout_lines: u64,
    stderr_lines: u64,
    first_output_ms: Option<u128>,
}

impl ProcessOutputStats {
    fn record_bytes(&mut self, stream: &str, byte_count: usize, elapsed: Duration) {
        if byte_count == 0 {
            return;
        }
        self.first_output_ms.get_or_insert(elapsed.as_millis());
        if stream == "stdout" {
            self.stdout_bytes = self.stdout_bytes.saturating_add(byte_count as u64);
        } else {
            self.stderr_bytes = self.stderr_bytes.saturating_add(byte_count as u64);
        }
    }

    fn record_line(&mut self, stream: &str, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        if stream == "stdout" {
            self.stdout_lines = self.stdout_lines.saturating_add(1);
        } else {
            self.stderr_lines = self.stderr_lines.saturating_add(1);
        }
    }
}

async fn verify_windows_ytdlp(app: &AppHandle, job_id: &str, ytdlp: &Path) -> AppResult<()> {
    let spawn_started = Instant::now();
    let spawn_result = app
        .shell()
        .command(ytdlp)
        .args(["--ignore-config", "--version"])
        .set_raw_out(true)
        .spawn();
    let (mut receiver, child) = match spawn_result {
        Ok(process) => process,
        Err(error) => {
            emit_log(
                app,
                job_id,
                &format!("[OshiClip][診斷] Windows preflight 無法建立程序：{error}"),
                "stderr",
            );
            return Err(AppError::Message(format!(
                "yt-dlp 自我檢查無法啟動：{error}。請複製診斷資訊後回報（ID：{job_id}）。"
            )));
        }
    };
    let pid = child.pid();
    emit_log(
        app,
        job_id,
        &format!(
            "[OshiClip][診斷] Windows preflight 程序已建立：pid={pid}; spawnMs={}",
            spawn_started.elapsed().as_millis()
        ),
        "diagnostic",
    );

    let started = Instant::now();
    let deadline = tokio::time::sleep(WINDOWS_YTDLP_PROBE_TIMEOUT);
    tokio::pin!(deadline);
    let mut child = Some(child);
    let mut stdout_decoder = LineDecoder::default();
    let mut stderr_decoder = LineDecoder::default();
    let mut stdout_lines = Vec::new();
    let mut stderr_lines = Vec::new();
    let mut stdout_bytes = 0_u64;
    let mut stderr_bytes = 0_u64;

    loop {
        tokio::select! {
            event = receiver.recv() => {
                let Some(event) = event else {
                    let termination_error = child
                        .take()
                        .map(terminate_child_tree)
                        .and_then(Result::err)
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "none".into());
                    emit_log(
                        app,
                        job_id,
                        &format!(
                            "[OshiClip][診斷] Windows preflight 事件通道提早關閉：pid={pid}; stdoutBytes={stdout_bytes}; stderrBytes={stderr_bytes}; terminationError={termination_error}"
                        ),
                        "stderr",
                    );
                    return Err(AppError::Message(format!(
                        "yt-dlp 自我檢查意外中止。請複製診斷資訊後回報（ID：{job_id}）。"
                    )));
                };
                match event {
                    CommandEvent::Stdout(bytes) => {
                        stdout_bytes = stdout_bytes.saturating_add(bytes.len() as u64);
                        stdout_lines.extend(stdout_decoder.push(&bytes));
                    }
                    CommandEvent::Stderr(bytes) => {
                        stderr_bytes = stderr_bytes.saturating_add(bytes.len() as u64);
                        stderr_lines.extend(stderr_decoder.push(&bytes));
                    }
                    CommandEvent::Terminated(payload) => {
                        if let Some(line) = stdout_decoder.flush() {
                            stdout_lines.push(line);
                        }
                        if let Some(line) = stderr_decoder.flush() {
                            stderr_lines.push(line);
                        }
                        let stdout = summarize_probe_lines(&stdout_lines);
                        let stderr = summarize_probe_lines(&stderr_lines);
                        emit_log(
                            app,
                            job_id,
                            &format!(
                                "[OshiClip][診斷] Windows preflight 結束：pid={pid}; code={:?}; signal={:?}; elapsedMs={}; stdoutBytes={stdout_bytes}; stderrBytes={stderr_bytes}; stdout={stdout}; stderr={stderr}",
                                payload.code,
                                payload.signal,
                                started.elapsed().as_millis(),
                            ),
                            if payload.code == Some(0) { "diagnostic" } else { "stderr" },
                        );
                        if payload.code == Some(0) {
                            return Ok(());
                        }
                        return Err(AppError::Message(format!(
                            "yt-dlp 自我檢查失敗（結束碼 {:?}）。請複製診斷資訊後回報（ID：{job_id}）。",
                            payload.code
                        )));
                    }
                    CommandEvent::Error(error) => {
                        let termination_error = child
                            .take()
                            .map(terminate_child_tree)
                            .and_then(Result::err)
                            .map(|error| error.to_string())
                            .unwrap_or_else(|| "none".into());
                        emit_log(
                            app,
                            job_id,
                            &format!(
                                "[OshiClip][診斷] Windows preflight 事件錯誤：pid={pid}; error={error}; terminationError={termination_error}"
                            ),
                            "stderr",
                        );
                        return Err(AppError::Message(format!(
                            "yt-dlp 自我檢查無法讀取輸出：{error}。請複製診斷資訊後回報（ID：{job_id}）。"
                        )));
                    }
                    _ => {}
                }
            }
            _ = &mut deadline => {
                let pending_stdout = stdout_decoder.pending_len();
                let pending_stderr = stderr_decoder.pending_len();
                let termination_error = child
                    .take()
                    .map(terminate_child_tree)
                    .and_then(Result::err)
                    .map(|error| error.to_string())
                    .unwrap_or_else(|| "none".into());
                emit_log(
                    app,
                    job_id,
                    &format!(
                        "[OshiClip][診斷] Windows preflight 超時：pid={pid}; elapsedMs={}; stdoutBytes={stdout_bytes}; stderrBytes={stderr_bytes}; pendingStdoutBytes={pending_stdout}; pendingStderrBytes={pending_stderr}; terminationError={termination_error}; 判讀=yt-dlp 連 --version 都無法在 {} 秒內完成，問題位於執行檔初始化、DLL 載入或 Windows 安全軟體掃描，尚未進入 YouTube 網路請求",
                        started.elapsed().as_millis(),
                        WINDOWS_YTDLP_PROBE_TIMEOUT.as_secs(),
                    ),
                    "stderr",
                );
                return Err(AppError::Message(format!(
                    "yt-dlp 自我檢查在 {} 秒內沒有完成，已停止；尚未連線至 YouTube。請複製診斷資訊後回報（ID：{job_id}）。",
                    WINDOWS_YTDLP_PROBE_TIMEOUT.as_secs()
                )));
            }
        }
    }
}

fn summarize_probe_lines(lines: &[String]) -> String {
    let summary = lines
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join(" | ");
    if summary.is_empty() {
        "<none>".into()
    } else {
        truncate_diagnostic_line(&summary, 2_048)
    }
}

async fn monitor_download(
    app: AppHandle,
    job_id: String,
    spec: DownloadSpec,
    expected_output: String,
    child_pid: u32,
    mut receiver: tokio::sync::mpsc::Receiver<CommandEvent>,
) {
    let mut final_output = expected_output.clone();
    let mut saw_termination = false;
    let started = Instant::now();
    let mut last_activity = started;
    let mut last_sample = started;
    let mut last_size = partial_output_size(&expected_output);
    let mut base_phase = DownloadPhase::Preparing;
    let mut waiting_reported = false;
    let mut ffmpeg_progress =
        FfmpegProgressTracker::new(spec.end_seconds.saturating_sub(spec.start_seconds));
    let mut stdout_lines = LineDecoder::default();
    let mut stderr_lines = LineDecoder::default();
    let mut output_stats = ProcessOutputStats::default();

    emit_log(
        &app,
        &job_id,
        "[OshiClip] 正在解析 YouTube 來源並準備片段下載…",
        "stdout",
    );
    if let Some(status) = update_active_download(&app, &job_id, |status| {
        status.elapsed_seconds = 0;
    }) {
        emit_download_status(&app, &status);
    }

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    heartbeat.tick().await;

    loop {
        tokio::select! {
            event = receiver.recv() => {
                let Some(event) = event else { break };
                match event {
                    CommandEvent::Stdout(bytes) => {
                        output_stats.record_bytes("stdout", bytes.len(), started.elapsed());
                        if !bytes.is_empty() {
                            last_activity = Instant::now();
                        }
                        for line in stdout_lines.push(&bytes) {
                            output_stats.record_line("stdout", &line);
                            handle_stdout_line(
                                DownloadEventTarget {
                                    app: &app,
                                    job_id: &job_id,
                                },
                                &line,
                                &mut final_output,
                                &mut ffmpeg_progress,
                                started,
                                &mut last_activity,
                                &mut base_phase,
                            );
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        output_stats.record_bytes("stderr", bytes.len(), started.elapsed());
                        if !bytes.is_empty() {
                            last_activity = Instant::now();
                        }
                        for line in stderr_lines.push(&bytes) {
                            output_stats.record_line("stderr", &line);
                            handle_stderr_line(
                                &app,
                                &job_id,
                                &line,
                                started,
                                &mut last_activity,
                                &mut base_phase,
                            );
                        }
                    }
                    CommandEvent::Terminated(payload) => {
                        saw_termination = true;
                        if let Some(line) = stdout_lines.flush() {
                            output_stats.record_line("stdout", &line);
                            handle_stdout_line(
                                DownloadEventTarget {
                                    app: &app,
                                    job_id: &job_id,
                                },
                                &line,
                                &mut final_output,
                                &mut ffmpeg_progress,
                                started,
                                &mut last_activity,
                                &mut base_phase,
                            );
                        }
                        if let Some(line) = stderr_lines.flush() {
                            output_stats.record_line("stderr", &line);
                            handle_stderr_line(
                                &app,
                                &job_id,
                                &line,
                                started,
                                &mut last_activity,
                                &mut base_phase,
                            );
                        }
                        emit_log(
                            &app,
                            &job_id,
                            &format!(
                                "[OshiClip][診斷] 程序結束：pid={child_pid}; code={:?}; signal={:?}; {}",
                                payload.code,
                                payload.signal,
                                process_activity_summary(
                                    &output_stats,
                                    stdout_lines.pending_len(),
                                    stderr_lines.pending_len(),
                                    started.elapsed(),
                                    Instant::now().duration_since(last_activity),
                                    base_phase,
                                    partial_output_size(&expected_output),
                                )
                            ),
                            "diagnostic",
                        );
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
                                emit_log(&app, &job_id, &warning, "stderr");
                            }
                            let _ = app.emit(
                                "download-done",
                                DoneEvent {
                                    job_id: &job_id,
                                    output_path: &final_output,
                                },
                            );
                        } else {
                            emit_log(
                                &app,
                                &job_id,
                                "[OshiClip] yt-dlp 回傳非零結束碼；上方 verbose 輸出與程序摘要可用來定位原因。",
                                "stderr",
                            );
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
                    CommandEvent::Error(error) => {
                        emit_log(
                            &app,
                            &job_id,
                            &format!(
                                "[OshiClip][診斷] 程序事件通道錯誤：pid={child_pid}; error={error}; {}",
                                process_activity_summary(
                                    &output_stats,
                                    stdout_lines.pending_len(),
                                    stderr_lines.pending_len(),
                                    started.elapsed(),
                                    Instant::now().duration_since(last_activity),
                                    base_phase,
                                    partial_output_size(&expected_output),
                                )
                            ),
                            "stderr",
                        );
                        let message = format!(
                            "無法讀取 yt-dlp 的執行結果：{error}。請複製診斷資訊後回報。"
                        );
                        emit_log(&app, &job_id, &format!("[OshiClip] {message}"), "stderr");
                        fail_active_download(&app, &job_id, &message);
                        saw_termination = true;
                        break;
                    }
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                let now = Instant::now();
                let current_size = partial_output_size(&expected_output);
                let sample_seconds = now.duration_since(last_sample).as_secs_f64();
                let sampled_speed = (current_size > last_size && sample_seconds > 0.0)
                    .then(|| format_transfer_rate((current_size - last_size) as f64 / sample_seconds));

                if current_size > last_size {
                    last_activity = now;
                    if base_phase != DownloadPhase::Finalizing {
                        base_phase = DownloadPhase::Downloading;
                    }
                }

                if let Some(message) = inactivity_timeout_message(
                    base_phase,
                    now.duration_since(last_activity),
                ) {
                    emit_log(
                        &app,
                        &job_id,
                        &format!(
                            "[OshiClip][診斷] watchdog 觸發：pid={child_pid}; {}; 判讀={}",
                            process_activity_summary(
                                &output_stats,
                                stdout_lines.pending_len(),
                                stderr_lines.pending_len(),
                                started.elapsed(),
                                now.duration_since(last_activity),
                                base_phase,
                                current_size,
                            ),
                            timeout_interpretation(&output_stats, base_phase),
                        ),
                        "stderr",
                    );
                    if let Some(line) = stdout_lines.flush() {
                        output_stats.record_line("stdout", &line);
                        handle_stdout_line(
                            DownloadEventTarget {
                                app: &app,
                                job_id: &job_id,
                            },
                            &line,
                            &mut final_output,
                            &mut ffmpeg_progress,
                            started,
                            &mut last_activity,
                            &mut base_phase,
                        );
                    }
                    if let Some(line) = stderr_lines.flush() {
                        output_stats.record_line("stderr", &line);
                        handle_stderr_line(
                            &app,
                            &job_id,
                            &line,
                            started,
                            &mut last_activity,
                            &mut base_phase,
                        );
                    }
                    emit_log(&app, &job_id, &format!("[OshiClip] {message}"), "stderr");
                    fail_active_download(&app, &job_id, message);
                    saw_termination = true;
                    break;
                }

                let waiting = base_phase != DownloadPhase::Finalizing
                    && now.duration_since(last_activity) >= WAITING_AFTER;
                let visible_phase = if waiting {
                    DownloadPhase::Waiting
                } else {
                    base_phase
                };
                if let Some(status) = update_active_download(&app, &job_id, |status| {
                    status.phase = visible_phase;
                    status.elapsed_seconds = started.elapsed().as_secs();
                    status.downloaded_bytes = status.downloaded_bytes.max(current_size);
                    if waiting {
                        status.speed = None;
                        status.eta = None;
                    } else if status.percent.is_none() && sampled_speed.is_some() {
                        status.speed.clone_from(&sampled_speed);
                    }
                }) {
                    emit_download_status(&app, &status);
                }

                if waiting && !waiting_reported {
                    emit_log(
                        &app,
                        &job_id,
                        "[OshiClip] 已有 30 秒沒有收到新資料；若仍無回應，OshiClip 會自動停止並顯示處理方式。",
                        "stderr",
                    );
                    emit_log(
                        &app,
                        &job_id,
                        &format!(
                            "[OshiClip][診斷] 等待快照：pid={child_pid}; {}",
                            process_activity_summary(
                                &output_stats,
                                stdout_lines.pending_len(),
                                stderr_lines.pending_len(),
                                started.elapsed(),
                                now.duration_since(last_activity),
                                base_phase,
                                current_size,
                            )
                        ),
                        "diagnostic",
                    );
                    waiting_reported = true;
                } else if !waiting && waiting_reported {
                    emit_log(
                        &app,
                        &job_id,
                        &format!(
                            "[OshiClip] 下載工具已恢復輸出。{}",
                            output_stats
                                .first_output_ms
                                .map(|milliseconds| format!(" firstOutputMs={milliseconds}"))
                                .unwrap_or_default()
                        ),
                        "stdout",
                    );
                    waiting_reported = false;
                }

                last_size = current_size;
                last_sample = now;
            }
        }
    }

    if !saw_termination {
        emit_log(
            &app,
            &job_id,
            &format!(
                "[OshiClip][診斷] 程序事件通道在 Terminated 事件前關閉：pid={child_pid}; {}",
                process_activity_summary(
                    &output_stats,
                    stdout_lines.pending_len(),
                    stderr_lines.pending_len(),
                    started.elapsed(),
                    Instant::now().duration_since(last_activity),
                    base_phase,
                    partial_output_size(&expected_output),
                )
            ),
            "stderr",
        );
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
    downloaded_bytes: Option<u64>,
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
        downloaded_bytes: None,
    })
}

struct DownloadEventTarget<'a> {
    app: &'a AppHandle,
    job_id: &'a str,
}

fn handle_stdout_line(
    target: DownloadEventTarget<'_>,
    raw_line: &str,
    final_output: &mut String,
    ffmpeg_progress: &mut FfmpegProgressTracker,
    started: Instant,
    last_activity: &mut Instant,
    base_phase: &mut DownloadPhase,
) {
    let line = raw_line.trim();
    if line.is_empty() {
        return;
    }

    if let Some(progress) = parse_progress(line) {
        *last_activity = Instant::now();
        *base_phase = DownloadPhase::Downloading;
        emit_progress_update(
            target.app,
            target.job_id,
            &progress,
            DownloadPhase::Downloading,
            started.elapsed().as_secs(),
        );
        return;
    }

    match ffmpeg_progress.consume(line) {
        FfmpegLine::Field => {
            *last_activity = Instant::now();
        }
        FfmpegLine::Report { progress, ended } => {
            *last_activity = Instant::now();
            *base_phase = if ended {
                DownloadPhase::Finalizing
            } else {
                DownloadPhase::Downloading
            };
            emit_progress_update(
                target.app,
                target.job_id,
                &progress,
                *base_phase,
                started.elapsed().as_secs(),
            );
        }
        FfmpegLine::NotProgress => {
            if let Some(path) = line.strip_prefix("FINAL ") {
                *last_activity = Instant::now();
                *base_phase = DownloadPhase::Finalizing;
                *final_output = path.trim().to_owned();
                if let Some(status) = update_active_download(target.app, target.job_id, |status| {
                    status.output_path.clone_from(final_output);
                    status.phase = DownloadPhase::Finalizing;
                    status.elapsed_seconds = started.elapsed().as_secs();
                }) {
                    emit_download_status(target.app, &status);
                }
            } else {
                *last_activity = Instant::now();
                emit_log(target.app, target.job_id, line, "stdout");
            }
        }
    }
}

fn handle_stderr_line(
    app: &AppHandle,
    job_id: &str,
    raw_line: &str,
    started: Instant,
    last_activity: &mut Instant,
    base_phase: &mut DownloadPhase,
) {
    let line = raw_line.trim();
    if line.is_empty() {
        return;
    }
    *last_activity = Instant::now();
    if let Some(progress) = parse_progress(line) {
        *base_phase = DownloadPhase::Downloading;
        emit_progress_update(
            app,
            job_id,
            &progress,
            DownloadPhase::Downloading,
            started.elapsed().as_secs(),
        );
    } else {
        emit_log(app, job_id, line, "stderr");
    }
}

fn process_activity_summary(
    stats: &ProcessOutputStats,
    pending_stdout_bytes: usize,
    pending_stderr_bytes: usize,
    elapsed: Duration,
    inactive: Duration,
    phase: DownloadPhase,
    partial_bytes: u64,
) -> String {
    format!(
        "phase={phase:?}; elapsedMs={}; inactiveMs={}; stdoutBytes={}; stderrBytes={}; stdoutLines={}; stderrLines={}; pendingStdoutBytes={pending_stdout_bytes}; pendingStderrBytes={pending_stderr_bytes}; firstOutputMs={}; partialBytes={partial_bytes}",
        elapsed.as_millis(),
        inactive.as_millis(),
        stats.stdout_bytes,
        stats.stderr_bytes,
        stats.stdout_lines,
        stats.stderr_lines,
        stats
            .first_output_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".into()),
    )
}

fn timeout_interpretation(stats: &ProcessOutputStats, phase: DownloadPhase) -> &'static str {
    if stats.stdout_bytes == 0 && stats.stderr_bytes == 0 {
        "程序已建立但從未寫入 stdout/stderr；較可能卡在執行檔初始化、DLL 載入或 Windows 安全軟體掃描"
    } else if stats.stdout_lines == 0 && stats.stderr_lines == 0 {
        "程序曾寫入資料但沒有完整換行；已在停止前保留殘留 bytes"
    } else if phase == DownloadPhase::Preparing {
        "yt-dlp 已成功啟動，但在來源解析或網路請求階段停止產生新資料"
    } else {
        "下載已開始，但資料傳輸或 ffmpeg 處理停止產生進度"
    }
}

fn emit_progress_update(
    app: &AppHandle,
    job_id: &str,
    progress: &ParsedProgress,
    phase: DownloadPhase,
    elapsed_seconds: u64,
) {
    if let Some(status) = update_active_download(app, job_id, |status| {
        status.phase = phase;
        status.percent = Some(progress.percent.clamp(0.0, 99.9));
        status.speed.clone_from(&progress.speed);
        status.eta.clone_from(&progress.eta);
        status.elapsed_seconds = elapsed_seconds;
        if let Some(downloaded_bytes) = progress.downloaded_bytes {
            status.downloaded_bytes = status.downloaded_bytes.max(downloaded_bytes);
        }
    }) {
        emit_download_status(app, &status);
    }
}

fn emit_download_status(app: &AppHandle, status: &ActiveDownloadStatus) {
    let _ = app.emit("download-progress", status);
}

fn emit_log(app: &AppHandle, job_id: &str, line: &str, stream: &str) {
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let line = redact_diagnostic_text(line);
    append_diagnostic_log(app, job_id, &timestamp, stream, &line);
    let _ = app.emit(
        "download-log",
        LogEvent {
            job_id,
            line: &line,
            stream,
            timestamp: &timestamp,
        },
    );
}

struct StartupDiagnosticContext<'a> {
    manifest: &'a Manifest,
    spec: &'a DownloadSpec,
    ytdlp: &'a Path,
    ffmpeg: &'a Path,
    deno: &'a Path,
    output_directory: &'a Path,
    expected_output: &'a Path,
    arguments: &'a [OsString],
}

fn startup_diagnostic_lines(job_id: &str, context: StartupDiagnosticContext<'_>) -> Vec<String> {
    let StartupDiagnosticContext {
        manifest,
        spec,
        ytdlp,
        ffmpeg,
        deno,
        output_directory,
        expected_output,
        arguments,
    } = context;
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let current_executable = env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|error| format!("unavailable:{error}"));
    let current_directory = env::current_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|error| format!("unavailable:{error}"));
    let video_id = diagnostic_video_id(&spec.url).unwrap_or_else(|| "unknown".into());
    let write_probe = match tempfile::Builder::new()
        .prefix(".oshiclip-write-test-")
        .tempfile_in(output_directory)
    {
        Ok(file) => {
            drop(file);
            "ok".to_owned()
        }
        Err(error) => format!("failed:{error}"),
    };

    let mut lines = vec![
        format!(
            "[OshiClip][診斷] session={job_id}; reportVersion=1; startedAt={}",
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
        ),
        format!(
            "[OshiClip][診斷] appVersion={}; build={build}; target={}/{}; platformVersion={}; executable={current_executable}; cwd={current_directory}",
            env!("CARGO_PKG_VERSION"),
            env::consts::OS,
            env::consts::ARCH,
            platform_version(),
        ),
        format!(
            "[OshiClip][診斷] environment: OS={}; PROCESSOR_ARCHITECTURE={}; PROCESSOR_IDENTIFIER={}; NUMBER_OF_PROCESSORS={}; LANG={}; TEMP={}; HTTP_PROXY={}; HTTPS_PROXY={}; ALL_PROXY={}",
            environment_value("OS"),
            environment_value("PROCESSOR_ARCHITECTURE"),
            environment_value("PROCESSOR_IDENTIFIER"),
            environment_value("NUMBER_OF_PROCESSORS"),
            environment_value("LANG"),
            environment_value("TEMP"),
            environment_presence("HTTP_PROXY"),
            environment_presence("HTTPS_PROXY"),
            environment_presence("ALL_PROXY"),
        ),
        tool_diagnostic_line(manifest, Tool::YtDlp, ytdlp),
        tool_diagnostic_line(manifest, Tool::Ffmpeg, ffmpeg),
        tool_diagnostic_line(manifest, Tool::Deno, deno),
        format!(
            "[OshiClip][診斷] task: videoId={video_id}; start={}; end={}; duration={}; preset={:?}; outputName={}",
            spec.start_seconds,
            spec.end_seconds,
            spec.end_seconds.saturating_sub(spec.start_seconds),
            spec.format_preset,
            spec.output_name.trim(),
        ),
        format!(
            "[OshiClip][診斷] output: directory={}; writeProbe={write_probe}; expected={}; expectedExists={}; partialExists={}; partialBytes={}",
            output_directory.display(),
            expected_output.display(),
            expected_output.exists(),
            PathBuf::from(format!("{}.part", expected_output.display())).exists(),
            partial_output_size(&expected_output.to_string_lossy()),
        ),
        format!(
            "[OshiClip][診斷] argv: {} {}",
            ytdlp.display(),
            format_diagnostic_arguments(arguments),
        ),
    ];
    if cfg!(windows) {
        lines.push(windows_ytdlp_runtime_line(ytdlp));
        lines.push(format!(
            "[OshiClip][診斷] Windows preflight: command=yt-dlp --ignore-config --version; timeoutSeconds={}",
            WINDOWS_YTDLP_PROBE_TIMEOUT.as_secs()
        ));
    }
    lines
}

fn tool_diagnostic_line(manifest: &Manifest, tool: Tool, path: &Path) -> String {
    let state = manifest.tools.get(tool);
    let installed = state.selected.as_deref().and_then(|selected| {
        state
            .installed
            .iter()
            .find(|version| version.version == selected)
    });
    let metadata_bytes = fs::metadata(path)
        .map(|metadata| metadata.len().to_string())
        .unwrap_or_else(|error| format!("unavailable:{error}"));
    let selected = state.selected.as_deref().unwrap_or("none");
    let asset = installed
        .map(|version| {
            version
                .source_url
                .split('?')
                .next()
                .unwrap_or(&version.source_url)
                .rsplit('/')
                .next()
                .unwrap_or("unknown")
        })
        .unwrap_or("unknown");
    let recorded_bytes = installed
        .map(|version| version.size_bytes.to_string())
        .unwrap_or_else(|| "unknown".into());
    let recorded_hash = installed
        .map(|version| short_hash(&version.sha256))
        .unwrap_or_else(|| "unknown".into());
    format!(
        "[OshiClip][診斷] tool={tool}; selected={selected}; asset={asset}; path={}; binaryBytes={metadata_bytes}; recordedPackageBytes={recorded_bytes}; recordedSha256={recorded_hash}",
        path.display(),
    )
}

fn short_hash(value: &str) -> String {
    if value.is_empty() {
        "unknown".into()
    } else {
        value.chars().take(16).collect()
    }
}

fn diagnostic_video_id(value: &str) -> Option<String> {
    let url = url::Url::parse(value.trim()).ok()?;
    if url
        .host_str()
        .is_some_and(|host| host.ends_with("youtu.be"))
    {
        return url
            .path_segments()
            .and_then(|mut segments| segments.next())
            .map(str::to_owned);
    }
    url.query_pairs()
        .find(|(key, _)| key == "v")
        .map(|(_, value)| value.into_owned())
}

fn environment_value(name: &str) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unset".into())
}

fn environment_presence(name: &str) -> &'static str {
    if env::var_os(name).is_some() {
        "set"
    } else {
        "unset"
    }
}

#[cfg(windows)]
fn platform_version() -> String {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "ver"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .ok()
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "unavailable".into())
}

#[cfg(not(windows))]
fn platform_version() -> String {
    env::consts::OS.into()
}

fn format_diagnostic_arguments(arguments: &[OsString]) -> String {
    arguments
        .iter()
        .map(|argument| {
            let value = argument.to_string_lossy();
            if value.chars().any(char::is_whitespace) {
                format!("{value:?}")
            } else {
                value.into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn windows_ytdlp_runtime_line(ytdlp: &Path) -> String {
    let internal = ytdlp
        .parent()
        .map(|parent| parent.join("_internal"))
        .unwrap_or_default();
    let (file_count, total_bytes, truncated) = directory_inventory(&internal, 20_000);
    let python_dlls = fs::read_dir(&internal)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            name.starts_with("python") && name.ends_with(".dll")
        })
        .count();
    format!(
        "[OshiClip][診斷] Windows runtime: internalExists={}; ytDlpModuleExists={}; pythonDlls={python_dlls}; files={file_count}; bytes={total_bytes}; inventoryTruncated={truncated}; executableZoneIdentifier={}",
        internal.is_dir(),
        internal.join("yt_dlp").is_dir(),
        has_zone_identifier(ytdlp),
    )
}

fn directory_inventory(root: &Path, limit: u64) -> (u64, u64, bool) {
    if !root.is_dir() {
        return (0, 0, false);
    }
    let mut pending = vec![root.to_path_buf()];
    let mut files = 0_u64;
    let mut bytes = 0_u64;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                files = files.saturating_add(1);
                bytes = bytes
                    .saturating_add(entry.metadata().map(|metadata| metadata.len()).unwrap_or(0));
                if files >= limit {
                    return (files, bytes, true);
                }
            }
        }
    }
    (files, bytes, false)
}

#[cfg(windows)]
fn has_zone_identifier(path: &Path) -> bool {
    let mut alternate_stream = path.as_os_str().to_os_string();
    alternate_stream.push(":Zone.Identifier");
    fs::metadata(PathBuf::from(alternate_stream)).is_ok()
}

#[cfg(not(windows))]
fn has_zone_identifier(_path: &Path) -> bool {
    false
}

fn diagnostic_log_path(app_data: &Path, job_id: &str) -> AppResult<PathBuf> {
    if job_id.len() > 96
        || !job_id.starts_with("download-")
        || !job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(AppError::Message("診斷資訊識別碼無效".into()));
    }
    Ok(app_data.join("diagnostics").join(format!("{job_id}.log")))
}

fn prepare_diagnostic_log(app_data: &Path, job_id: &str) -> AppResult<()> {
    let path = diagnostic_log_path(app_data, job_id)?;
    let directory = path
        .parent()
        .ok_or_else(|| AppError::Message("診斷資訊路徑無效".into()))?;
    fs::create_dir_all(directory)?;
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)?
        .sync_all()?;
    prune_diagnostic_logs(directory, DIAGNOSTIC_LOGS_TO_KEEP);
    Ok(())
}

fn prune_diagnostic_logs(directory: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut logs = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("download-") || !name.ends_with(".log") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            metadata
                .is_file()
                .then(|| (metadata.modified().ok(), entry.path()))
        })
        .collect::<Vec<_>>();
    logs.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, path) in logs.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}

fn append_diagnostic_log(app: &AppHandle, job_id: &str, timestamp: &str, stream: &str, line: &str) {
    let state = app.state::<AppState>();
    let Ok(path) = diagnostic_log_path(&state.app_data, job_id) else {
        return;
    };
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() >= MAX_DIAGNOSTIC_LOG_BYTES) {
        return;
    }
    let line = truncate_diagnostic_line(line, MAX_DIAGNOSTIC_LINE_BYTES);
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{timestamp} [{stream}] {line}");
}

fn truncate_diagnostic_line(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [truncated]", &value[..end])
}

fn redact_diagnostic_text(value: &str) -> String {
    let mut redacted = value.to_owned();
    for (name, placeholder) in [("USERPROFILE", "%USERPROFILE%"), ("HOME", "$HOME")] {
        let Some(home) = env::var_os(name) else {
            continue;
        };
        let home = home.to_string_lossy();
        if home.trim().is_empty() {
            continue;
        }
        redacted = redacted.replace(home.as_ref(), placeholder);
        let alternate = if home.contains('\\') {
            home.replace('\\', "/")
        } else {
            home.replace('/', "\\")
        };
        redacted = redacted.replace(&alternate, placeholder);
    }
    redact_url_secrets(&redacted)
}

fn redact_url_secrets(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    while let Some(relative_start) = next_url_start(&value[cursor..]) {
        let start = cursor + relative_start;
        output.push_str(&value[cursor..start]);
        let tail = &value[start..];
        let end = tail
            .char_indices()
            .find_map(|(index, character)| {
                (index > 0
                    && (character.is_whitespace()
                        || matches!(character, '\'' | '"' | '<' | '>' | '{' | '}')))
                .then_some(index)
            })
            .unwrap_or(tail.len());
        let token = &tail[..end];
        let (candidate, suffix) = split_url_suffix(token);
        if let Ok(mut url) = url::Url::parse(candidate) {
            if !url.username().is_empty() || url.password().is_some() {
                let _ = url.set_username("redacted");
                let _ = url.set_password(Some("redacted"));
            }
            if url.query().is_some() {
                url.set_query(Some("redacted"));
            }
            if url.fragment().is_some() {
                url.set_fragment(Some("redacted"));
            }
            output.push_str(url.as_str());
            output.push_str(suffix);
        } else {
            output.push_str(token);
        }
        cursor = start + end;
    }
    output.push_str(&value[cursor..]);
    output
}

fn next_url_start(value: &str) -> Option<usize> {
    [value.find("https://"), value.find("http://")]
        .into_iter()
        .flatten()
        .min()
}

fn split_url_suffix(value: &str) -> (&str, &str) {
    let trimmed = value.trim_end_matches([',', ';', ')', ']']);
    let suffix = &value[trimmed.len()..];
    (trimmed, suffix)
}

fn update_active_download(
    app: &AppHandle,
    job_id: &str,
    update: impl FnOnce(&mut ActiveDownloadStatus),
) -> Option<ActiveDownloadStatus> {
    let state = app.state::<AppState>();
    let mut active = state.active_download.lock().ok()?;
    let download = active
        .as_mut()
        .filter(|download| download.job_id == job_id)?;
    update(&mut download.status);
    Some(download.status.clone())
}

fn partial_output_size(expected_output: &str) -> u64 {
    fs::metadata(format!("{expected_output}.part"))
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn inactivity_timeout_message(
    phase: DownloadPhase,
    inactive_for: Duration,
) -> Option<&'static str> {
    match phase {
        DownloadPhase::Preparing if inactive_for >= STARTUP_TIMEOUT => Some(
            "yt-dlp 在準備來源時連續 90 秒沒有新輸出，已停止任務。診斷資訊已保留，請按「複製診斷資訊」後回報。",
        ),
        DownloadPhase::Downloading if inactive_for >= STALL_TIMEOUT => {
            Some("下載工具已連續 5 分鐘沒有進度，已停止任務。請檢查網路後重新下載。")
        }
        _ => None,
    }
}

fn ensure_ytdlp_runtime_layout(path: &std::path::Path, is_windows: bool) -> AppResult<()> {
    if installation_layout_is_usable(path, Tool::YtDlp, is_windows) {
        Ok(())
    } else {
        Err(AppError::Message(
            "Windows 的 yt-dlp 執行元件需要修復。請前往「工具管理」按下「修復 Windows 執行元件」後再試。"
                .into(),
        ))
    }
}

fn format_transfer_rate(bytes_per_second: f64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    if bytes_per_second >= MIB {
        format!("{:.1} MiB/s", bytes_per_second / MIB)
    } else if bytes_per_second >= KIB {
        format!("{:.0} KiB/s", bytes_per_second / KIB)
    } else {
        format!("{bytes_per_second:.0} B/s")
    }
}

#[derive(Default)]
struct LineDecoder {
    buffer: Vec<u8>,
}

impl LineDecoder {
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(delimiter) = self
            .buffer
            .iter()
            .position(|byte| matches!(*byte, b'\n' | b'\r'))
        {
            let mut line = self.buffer.drain(..=delimiter).collect::<Vec<_>>();
            line.pop();
            if !line.is_empty() {
                lines.push(String::from_utf8_lossy(&line).into_owned());
            }
        }
        lines
    }

    fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }
        let line = String::from_utf8_lossy(&self.buffer).into_owned();
        self.buffer.clear();
        (!line.trim().is_empty()).then_some(line)
    }

    fn pending_len(&self) -> usize {
        self.buffer.len()
    }
}

struct FfmpegProgressTracker {
    duration_micros: u64,
    out_time_micros: u64,
    downloaded_bytes: Option<u64>,
    speed: Option<String>,
}

enum FfmpegLine {
    NotProgress,
    Field,
    Report {
        progress: ParsedProgress,
        ended: bool,
    },
}

impl FfmpegProgressTracker {
    fn new(duration_seconds: u64) -> Self {
        Self {
            duration_micros: duration_seconds.saturating_mul(1_000_000),
            out_time_micros: 0,
            downloaded_bytes: None,
            speed: None,
        }
    }

    fn consume(&mut self, line: &str) -> FfmpegLine {
        let Some((key, value)) = line.split_once('=') else {
            return FfmpegLine::NotProgress;
        };
        if !is_ffmpeg_progress_key(key) {
            return FfmpegLine::NotProgress;
        }

        match key {
            "out_time_us" => {
                self.out_time_micros = value.parse::<i64>().unwrap_or(0).max(0) as u64;
            }
            "total_size" => {
                self.downloaded_bytes = value.parse().ok();
            }
            "speed" => {
                self.speed = normalize_progress_value(Some(value));
            }
            "progress" => {
                let ended = value == "end";
                let ceiling = if ended { 99.9 } else { 99.5 };
                let percent = if self.duration_micros == 0 {
                    0.0
                } else {
                    (self.out_time_micros as f64 / self.duration_micros as f64 * 100.0)
                        .clamp(0.0, ceiling)
                };
                let eta = (!ended)
                    .then(|| {
                        ffmpeg_eta(
                            self.duration_micros.saturating_sub(self.out_time_micros),
                            self.speed.as_deref(),
                        )
                    })
                    .flatten();
                return FfmpegLine::Report {
                    progress: ParsedProgress {
                        percent,
                        speed: self.speed.clone(),
                        eta,
                        downloaded_bytes: self.downloaded_bytes,
                    },
                    ended,
                };
            }
            _ => {}
        }
        FfmpegLine::Field
    }
}

fn is_ffmpeg_progress_key(key: &str) -> bool {
    matches!(
        key,
        "frame"
            | "fps"
            | "bitrate"
            | "total_size"
            | "out_time_us"
            | "out_time_ms"
            | "out_time"
            | "dup_frames"
            | "drop_frames"
            | "speed"
            | "progress"
    ) || key.starts_with("stream_")
}

fn ffmpeg_eta(remaining_micros: u64, speed: Option<&str>) -> Option<String> {
    let multiplier = speed?.strip_suffix('x')?.trim().parse::<f64>().ok()?;
    if !multiplier.is_finite() || multiplier <= 0.0 {
        return None;
    }
    let seconds = (remaining_micros as f64 / 1_000_000.0 / multiplier).ceil() as u64;
    Some(format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds % 3600 / 60,
        seconds % 60
    ))
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

fn fail_active_download(app: &AppHandle, job_id: &str, message: &str) {
    let termination = {
        let state = app.state::<AppState>();
        let mut active = match state.active_download.lock() {
            Ok(active) => active,
            Err(_) => {
                let _ = app.emit(
                    "download-error",
                    ErrorEvent {
                        job_id,
                        message,
                        code: None,
                    },
                );
                return;
            }
        };
        active
            .as_mut()
            .filter(|download| download.job_id == job_id)
            .and_then(|download| download.child.take())
    };

    let termination_error = termination.map(terminate_child_tree).and_then(Result::err);
    clear_active_download(app, job_id);

    let final_message = termination_error
        .map(|error| format!("{message}（停止下載程序時發生錯誤：{error}）"))
        .unwrap_or_else(|| message.to_owned());
    let _ = app.emit(
        "download-error",
        ErrorEvent {
            job_id,
            message: &final_message,
            code: None,
        },
    );
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

    #[test]
    fn parses_ffmpeg_machine_progress_for_clip_percentage() {
        let mut tracker = FfmpegProgressTracker::new(330);
        assert!(matches!(
            tracker.consume("total_size=10485760"),
            FfmpegLine::Field
        ));
        assert!(matches!(
            tracker.consume("out_time_us=165000000"),
            FfmpegLine::Field
        ));
        assert!(matches!(tracker.consume("speed=2.00x"), FfmpegLine::Field));

        let FfmpegLine::Report { progress, ended } = tracker.consume("progress=continue") else {
            panic!("expected a complete ffmpeg progress report");
        };
        assert!(!ended);
        assert!((progress.percent - 50.0).abs() < f64::EPSILON);
        assert_eq!(progress.downloaded_bytes, Some(10_485_760));
        assert_eq!(progress.speed.as_deref(), Some("2.00x"));
        assert_eq!(progress.eta.as_deref(), Some("00:01:23"));
    }

    #[test]
    fn keeps_ffmpeg_completion_below_one_hundred_until_process_exit() {
        let mut tracker = FfmpegProgressTracker::new(10);
        tracker.consume("out_time_us=12000000");
        let FfmpegLine::Report { progress, ended } = tracker.consume("progress=end") else {
            panic!("expected the final ffmpeg progress report");
        };
        assert!(ended);
        assert!((progress.percent - 99.9).abs() < f64::EPSILON);
        assert_eq!(progress.eta, None);
    }

    #[test]
    fn buffers_split_utf8_and_multiple_process_lines() {
        let mut decoder = LineDecoder::default();
        let output = "FINAL /tmp/六等星.mp4\nprogress=end\n".as_bytes();
        let split = output.iter().position(|byte| *byte >= 0x80).unwrap() + 1;
        assert!(decoder.push(&output[..split]).is_empty());
        assert_eq!(
            decoder.push(&output[split..]),
            vec!["FINAL /tmp/六等星.mp4", "progress=end"]
        );
    }

    #[test]
    fn decodes_carriage_return_lines_and_flushes_partial_output() {
        let mut decoder = LineDecoder::default();
        assert_eq!(
            decoder.push(b"first\rsecond\r\nthird\npartial"),
            vec!["first", "second", "third"]
        );
        assert_eq!(decoder.pending_len(), 7);
        assert_eq!(decoder.flush().as_deref(), Some("partial"));
        assert_eq!(decoder.pending_len(), 0);
    }

    #[test]
    fn redacts_url_credentials_queries_and_fragments() {
        let redacted = redact_url_secrets(
            "source=https://www.youtube.com/watch?v=secret-video&t=30 proxy=http://user:password@proxy.example:8080/path?token=secret#private",
        );
        assert!(!redacted.contains("secret-video"));
        assert!(!redacted.contains("password"));
        assert!(!redacted.contains("token=secret"));
        assert!(!redacted.contains("private"));
        assert!(redacted.contains("https://www.youtube.com/watch?redacted"));
        assert!(
            redacted.contains("http://redacted:redacted@proxy.example:8080/path?redacted#redacted")
        );
    }

    #[test]
    fn diagnostic_paths_reject_traversal_and_accept_generated_ids() {
        let root = Path::new("/app-data");
        assert!(diagnostic_log_path(root, "../../manifest").is_err());
        assert!(diagnostic_log_path(root, "download-123/escape").is_err());
        assert_eq!(
            diagnostic_log_path(root, "download-123-456").unwrap(),
            root.join("diagnostics/download-123-456.log")
        );
    }

    #[test]
    fn truncates_diagnostic_lines_on_utf8_boundaries() {
        let value = "診斷資訊".repeat(20);
        let truncated = truncate_diagnostic_line(&value, 17);
        assert!(truncated.ends_with("… [truncated]"));
        assert!(truncated.is_char_boundary(truncated.len()));
    }

    #[test]
    fn formats_observed_file_write_rate() {
        assert_eq!(format_transfer_rate(5.25 * 1024.0 * 1024.0), "5.2 MiB/s");
        assert_eq!(format_transfer_rate(512.0 * 1024.0), "512 KiB/s");
    }

    #[test]
    fn stops_a_silent_startup_and_a_stalled_download() {
        assert!(
            inactivity_timeout_message(DownloadPhase::Preparing, Duration::from_secs(89)).is_none()
        );
        assert!(
            inactivity_timeout_message(DownloadPhase::Preparing, Duration::from_secs(90)).is_some()
        );
        assert!(inactivity_timeout_message(
            DownloadPhase::Downloading,
            Duration::from_secs(5 * 60)
        )
        .is_some());
        assert!(inactivity_timeout_message(
            DownloadPhase::Finalizing,
            Duration::from_secs(10 * 60)
        )
        .is_none());
    }

    #[test]
    fn windows_ytdlp_requires_its_adjacent_runtime_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let binary = temporary.path().join("yt-dlp.exe");
        fs::write(&binary, b"preview").unwrap();

        assert!(ensure_ytdlp_runtime_layout(&binary, true).is_err());
        fs::create_dir(temporary.path().join("_internal")).unwrap();
        assert!(ensure_ytdlp_runtime_layout(&binary, true).is_ok());
        assert!(ensure_ytdlp_runtime_layout(&binary, false).is_ok());
    }
}
