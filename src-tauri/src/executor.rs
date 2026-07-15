use crate::{
    command_builder::build_download_args,
    error::{AppError, AppResult},
    history::record_completed_download,
    manifest::ManifestStore,
    models::{ActiveDownloadStatus, AppStatus, DownloadJob, DownloadPhase, DownloadSpec, Tool},
    ActiveDownload, AppState,
};
use chrono::Utc;
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const WAITING_AFTER: Duration = Duration::from_secs(30);

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
    let active_download = state
        .active_download
        .lock()
        .map_err(|_| AppError::Message("下載狀態鎖定失敗".into()))?
        .as_ref()
        .map(|download| download.status.clone());
    Ok(AppStatus::from_manifest(&manifest, active_download))
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
                        for line in stdout_lines.push(&bytes) {
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
                        for line in stderr_lines.push(&bytes) {
                            let line = line.trim();
                            if !line.is_empty() {
                                last_activity = Instant::now();
                                if let Some(progress) = parse_progress(line) {
                                    base_phase = DownloadPhase::Downloading;
                                    emit_progress_update(
                                        &app,
                                        &job_id,
                                        &progress,
                                        DownloadPhase::Downloading,
                                        started.elapsed().as_secs(),
                                    );
                                } else {
                                    emit_log(&app, &job_id, line, "stderr");
                                }
                            }
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
                        "[OshiClip] 已有 30 秒沒有收到新資料；下載工具仍在執行，可繼續等待或取消任務。",
                        "stderr",
                    );
                    waiting_reported = true;
                } else if !waiting && waiting_reported {
                    emit_log(&app, &job_id, "[OshiClip] 下載工具已恢復輸出。", "stdout");
                    waiting_reported = false;
                }

                last_size = current_size;
                last_sample = now;
            }
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
    let _ = app.emit(
        "download-log",
        LogEvent {
            job_id,
            line,
            stream,
        },
    );
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
        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            lines.push(String::from_utf8_lossy(&line).into_owned());
        }
        lines
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
    fn formats_observed_file_write_rate() {
        assert_eq!(format_transfer_rate(5.25 * 1024.0 * 1024.0), "5.2 MiB/s");
        assert_eq!(format_transfer_rate(512.0 * 1024.0), "512 KiB/s");
    }
}
