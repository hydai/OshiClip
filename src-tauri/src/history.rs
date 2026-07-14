use crate::{
    error::{AppError, AppResult},
    models::{ApiDownloadHistoryEntry, DownloadHistoryEntry, DownloadSpec},
    AppState,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::MutexGuard,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const HISTORY_SCHEMA_VERSION: u32 = 1;
const MAX_HISTORY_ENTRIES: usize = 500;

#[derive(Debug, Serialize, Deserialize)]
struct HistoryFile {
    schema_version: u32,
    #[serde(default)]
    entries: Vec<DownloadHistoryEntry>,
}

impl Default for HistoryFile {
    fn default() -> Self {
        Self {
            schema_version: HISTORY_SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct DownloadHistoryStore {
    app_data: PathBuf,
}

impl DownloadHistoryStore {
    fn new(app_data: PathBuf) -> Self {
        Self { app_data }
    }

    fn list(&self) -> AppResult<Vec<DownloadHistoryEntry>> {
        Ok(self.read()?.entries)
    }

    fn find(&self, id: &str) -> AppResult<Option<DownloadHistoryEntry>> {
        Ok(self
            .read()?
            .entries
            .into_iter()
            .find(|entry| entry.id == id))
    }

    fn append(&self, entry: DownloadHistoryEntry) -> AppResult<()> {
        let mut history = self.read()?;
        history
            .entries
            .retain(|current| current.id != entry.id && current.output_path != entry.output_path);
        history.entries.insert(0, entry);
        history.entries.truncate(MAX_HISTORY_ENTRIES);
        self.write(&history)
    }

    fn remove(&self, id: &str) -> AppResult<()> {
        let mut history = self.read()?;
        let original_len = history.entries.len();
        history.entries.retain(|entry| entry.id != id);
        if history.entries.len() != original_len {
            self.write(&history)?;
        }
        Ok(())
    }

    fn clear(&self) -> AppResult<()> {
        self.write(&HistoryFile::default())
    }

    fn read(&self) -> AppResult<HistoryFile> {
        let path = self.path();
        if !path.exists() {
            return Ok(HistoryFile::default());
        }

        let contents = fs::read_to_string(&path)?;
        match serde_json::from_str::<HistoryFile>(&contents) {
            Ok(history) if history.schema_version == HISTORY_SCHEMA_VERSION => Ok(history),
            Ok(history) => Err(AppError::Message(format!(
                "不支援的下載紀錄 schema 版本：{}",
                history.schema_version
            ))),
            Err(_) => {
                self.back_up_corrupt_file()?;
                Ok(HistoryFile::default())
            }
        }
    }

    fn write(&self, history: &HistoryFile) -> AppResult<()> {
        fs::create_dir_all(&self.app_data)?;
        let mut temp = tempfile::Builder::new()
            .prefix("history-")
            .suffix(".tmp")
            .tempfile_in(&self.app_data)?;
        {
            let mut writer = BufWriter::new(temp.as_file_mut());
            serde_json::to_writer_pretty(&mut writer, history)?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
        temp.as_file().sync_all()?;
        temp.persist(self.path())?;
        sync_directory(&self.app_data);
        Ok(())
    }

    fn back_up_corrupt_file(&self) -> AppResult<()> {
        let source = self.path();
        if source.exists() {
            let backup = self.app_data.join(format!(
                "history.corrupt-{}.json",
                Utc::now().format("%Y%m%d%H%M%S%3f")
            ));
            fs::rename(source, backup)?;
        }
        Ok(())
    }

    fn path(&self) -> PathBuf {
        self.app_data.join("history.json")
    }
}

fn lock_history(state: &AppState) -> AppResult<MutexGuard<'_, ()>> {
    state
        .history_lock
        .lock()
        .map_err(|_| AppError::Message("下載紀錄鎖定失敗".into()))
}

pub fn record_completed_download(
    app: &AppHandle,
    id: &str,
    spec: &DownloadSpec,
    output_path: &str,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let _guard = lock_history(&state)?;
    let size_bytes = fs::metadata(output_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    DownloadHistoryStore::new(state.app_data.clone()).append(DownloadHistoryEntry {
        id: id.to_owned(),
        url: spec.url.trim().to_owned(),
        start_seconds: spec.start_seconds,
        end_seconds: spec.end_seconds,
        output_name: spec.output_name.trim().to_owned(),
        output_path: output_path.to_owned(),
        format_preset: spec.format_preset,
        completed_at: Utc::now().to_rfc3339(),
        size_bytes,
    })
}

#[tauri::command]
pub fn list_download_history(
    state: State<'_, AppState>,
) -> AppResult<Vec<ApiDownloadHistoryEntry>> {
    let _guard = lock_history(&state)?;
    Ok(DownloadHistoryStore::new(state.app_data.clone())
        .list()?
        .iter()
        .map(ApiDownloadHistoryEntry::from)
        .collect())
}

#[tauri::command]
pub fn remove_download_history(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _guard = lock_history(&state)?;
    DownloadHistoryStore::new(state.app_data.clone()).remove(&id)
}

#[tauri::command]
pub fn clear_download_history(state: State<'_, AppState>) -> AppResult<()> {
    let _guard = lock_history(&state)?;
    DownloadHistoryStore::new(state.app_data.clone()).clear()
}

#[tauri::command]
pub fn reveal_history_output(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let requested = {
        let _guard = lock_history(&state)?;
        let entry = DownloadHistoryStore::new(state.app_data.clone())
            .find(&id)?
            .ok_or_else(|| AppError::Message("找不到這筆下載紀錄".into()))?;
        PathBuf::from(entry.output_path)
    };
    if !requested.is_absolute() || !requested.is_file() {
        return Err(AppError::Message("下載檔案已被移動或刪除".into()));
    }
    app.opener()
        .reveal_item_in_dir(&requested)
        .map_err(|error| AppError::Message(format!("無法開啟檔案位置：{error}")))
}

#[cfg(unix)]
fn sync_directory(path: &Path) {
    if let Ok(directory) = fs::File::open(path) {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FormatPreset;

    fn entry(id: &str, output_path: PathBuf) -> DownloadHistoryEntry {
        DownloadHistoryEntry {
            id: id.into(),
            url: "https://www.youtube.com/watch?v=mLSIBfQWqB4".into(),
            start_seconds: 120,
            end_seconds: 180,
            output_name: format!("clip-{id}"),
            output_path: output_path.to_string_lossy().into_owned(),
            format_preset: FormatPreset::Avc1Mp4a,
            completed_at: "2026-07-15T12:00:00Z".into(),
            size_bytes: 1024,
        }
    }

    #[test]
    fn keeps_newest_entries_first_and_persists_them() {
        let temp = tempfile::tempdir().unwrap();
        let store = DownloadHistoryStore::new(temp.path().to_owned());
        store
            .append(entry("first", temp.path().join("first.mp4")))
            .unwrap();
        store
            .append(entry("second", temp.path().join("second.mp4")))
            .unwrap();

        let entries = store.list().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "second");
        assert_eq!(entries[1].id, "first");
    }

    #[test]
    fn replaces_duplicate_jobs_and_removes_records_without_touching_files() {
        let temp = tempfile::tempdir().unwrap();
        let store = DownloadHistoryStore::new(temp.path().to_owned());
        let output = temp.path().join("clip.mp4");
        fs::write(&output, b"video").unwrap();
        store.append(entry("same", output.clone())).unwrap();
        let mut replacement = entry("same", output.clone());
        replacement.output_name = "replacement".into();
        store.append(replacement).unwrap();

        let mut same_output = entry("new-job", output.clone());
        same_output.output_name = "same-output".into();
        store.append(same_output).unwrap();

        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.list().unwrap()[0].output_name, "same-output");
        store.remove("new-job").unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(output.is_file());
    }

    #[test]
    fn backs_up_malformed_history_before_starting_fresh() {
        let temp = tempfile::tempdir().unwrap();
        let store = DownloadHistoryStore::new(temp.path().to_owned());
        fs::write(temp.path().join("history.json"), b"not-json").unwrap();

        assert!(store.list().unwrap().is_empty());
        assert!(!temp.path().join("history.json").exists());
        assert!(fs::read_dir(temp.path()).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("history.corrupt-")
        }));
    }
}
