use crate::{
    error::{AppError, AppResult},
    models::{InstalledVersion, Manifest, Tool},
};
use chrono::{DateTime, Utc};
use std::{
    fs,
    io::{BufWriter, Write},
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct ManifestStore {
    app_data: PathBuf,
}

impl ManifestStore {
    pub fn new(app_data: PathBuf) -> Self {
        Self { app_data }
    }

    pub fn initialize(&self, default_output_directory: PathBuf) -> AppResult<Manifest> {
        fs::create_dir_all(self.app_data.join("bin"))?;
        fs::create_dir_all(self.app_data.join("downloads"))?;

        let mut manifest = self.read()?;
        if manifest.settings.output_directory.trim().is_empty() {
            manifest.settings.output_directory =
                default_output_directory.to_string_lossy().into_owned();
            self.write(&manifest)?;
        }
        Ok(manifest)
    }

    pub fn read(&self) -> AppResult<Manifest> {
        let path = self.manifest_path();
        if !path.exists() {
            return Ok(Manifest::default());
        }

        match fs::read_to_string(&path)
            .map_err(AppError::from)
            .and_then(|contents| {
                serde_json::from_str::<Manifest>(&contents).map_err(AppError::from)
            }) {
            Ok(mut manifest) if (1..=2).contains(&manifest.schema_version) => {
                manifest.schema_version = 2;
                Ok(manifest)
            }
            Ok(manifest) => Err(AppError::Message(format!(
                "不支援的 manifest schema 版本：{}",
                manifest.schema_version
            ))),
            Err(_) => {
                let recovered = self.recover_from_bin()?;
                self.back_up_corrupt_manifest()?;
                self.write(&recovered)?;
                Ok(recovered)
            }
        }
    }

    pub fn write(&self, manifest: &Manifest) -> AppResult<()> {
        fs::create_dir_all(&self.app_data)?;
        let mut temp = tempfile::Builder::new()
            .prefix("manifest-")
            .suffix(".tmp")
            .tempfile_in(&self.app_data)?;
        {
            let mut writer = BufWriter::new(temp.as_file_mut());
            serde_json::to_writer_pretty(&mut writer, manifest)?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
        temp.as_file().sync_all()?;
        temp.persist(self.manifest_path())?;
        sync_directory(&self.app_data);
        Ok(())
    }

    pub fn selected_path(&self, manifest: &Manifest, tool: Tool) -> AppResult<PathBuf> {
        let state = manifest.tools.get(tool);
        let selected = state
            .selected
            .as_deref()
            .ok_or_else(|| AppError::Message(format!("{tool} 尚未安裝")))?;
        let installed = state
            .installed
            .iter()
            .find(|version| version.version == selected)
            .ok_or_else(|| AppError::Message(format!("{tool} 的 manifest 狀態不一致")))?;
        let path = self.resolve_relative(&installed.path)?;
        if !path.is_file() {
            return Err(AppError::Message(format!(
                "找不到 {tool} {selected} 的執行檔"
            )));
        }
        Ok(path)
    }

    pub fn resolve_relative(&self, relative: &str) -> AppResult<PathBuf> {
        let path = Path::new(relative);
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(AppError::Message("manifest 包含不安全的工具路徑".into()));
        }
        Ok(self.app_data.join(path))
    }

    fn manifest_path(&self) -> PathBuf {
        self.app_data.join("manifest.json")
    }

    fn back_up_corrupt_manifest(&self) -> AppResult<()> {
        let source = self.manifest_path();
        if source.exists() {
            let backup = self.app_data.join(format!(
                "manifest.corrupt-{}.json",
                Utc::now().format("%Y%m%d%H%M%S")
            ));
            fs::rename(source, backup)?;
        }
        Ok(())
    }

    fn recover_from_bin(&self) -> AppResult<Manifest> {
        let mut manifest = Manifest::default();
        for tool in Tool::ALL {
            let root = self.app_data.join("bin").join(tool.as_str());
            let Ok(entries) = fs::read_dir(&root) else {
                continue;
            };
            let state = manifest.tools.get_mut(tool);
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let version = entry.file_name().to_string_lossy().into_owned();
                if version.starts_with('.') {
                    continue;
                }
                let binary = entry.path().join(tool.binary_name());
                if !binary.is_file() {
                    continue;
                }
                let metadata = fs::metadata(&binary)?;
                let installed_at = metadata
                    .modified()
                    .ok()
                    .map(DateTime::<Utc>::from)
                    .unwrap_or_else(Utc::now)
                    .to_rfc3339();
                state.installed.push(InstalledVersion {
                    version: version.clone(),
                    path: relative_binary_path(tool, &version),
                    sha256: String::new(),
                    source_url: "recovered://local".into(),
                    size_bytes: metadata.len(),
                    installed_at,
                });
            }
            state
                .installed
                .sort_by(|left, right| right.version.cmp(&left.version));
            state.selected = state
                .installed
                .first()
                .map(|version| version.version.clone());
        }
        Ok(manifest)
    }
}

pub fn relative_binary_path(tool: Tool, version: &str) -> String {
    ["bin", tool.as_str(), version, tool.binary_name()].join("/")
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

    #[test]
    fn writes_and_reads_manifest_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let store = ManifestStore::new(temp.path().to_owned());
        let mut manifest = Manifest::default();
        manifest.settings.output_directory =
            temp.path().join("clips").to_string_lossy().into_owned();
        store.write(&manifest).unwrap();

        let loaded = store.read().unwrap();
        assert_eq!(loaded.schema_version, 2);
        assert_eq!(
            loaded.settings.output_directory,
            manifest.settings.output_directory
        );
    }

    #[test]
    fn migrates_schema_one_with_an_empty_deno_state() {
        let temp = tempfile::tempdir().unwrap();
        let store = ManifestStore::new(temp.path().to_owned());
        fs::write(
            temp.path().join("manifest.json"),
            r#"{
              "schema_version": 1,
              "tools": {
                "yt-dlp": { "selected": null, "installed": [] },
                "ffmpeg": { "selected": null, "installed": [] }
              }
            }"#,
        )
        .unwrap();

        let loaded = store.read().unwrap();
        assert_eq!(loaded.schema_version, 2);
        assert_eq!(loaded.tools.deno.selected, None);
        assert!(loaded.tools.deno.installed.is_empty());
    }

    #[test]
    fn rejects_parent_directory_paths() {
        let temp = tempfile::tempdir().unwrap();
        let store = ManifestStore::new(temp.path().to_owned());
        assert!(store.resolve_relative("../yt-dlp").is_err());
    }

    #[test]
    fn recovers_installed_binaries_when_manifest_is_invalid() {
        let temp = tempfile::tempdir().unwrap();
        let store = ManifestStore::new(temp.path().to_owned());
        let binary = temp
            .path()
            .join("bin/yt-dlp/2026.07.11")
            .join(Tool::YtDlp.binary_name());
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, b"preview").unwrap();
        fs::write(temp.path().join("manifest.json"), b"not-json").unwrap();

        let recovered = store.read().unwrap();
        assert_eq!(
            recovered.tools.yt_dlp.selected.as_deref(),
            Some("2026.07.11")
        );
    }
}
