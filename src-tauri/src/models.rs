use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Tool {
    #[serde(rename = "yt-dlp")]
    YtDlp,
    #[serde(rename = "ffmpeg")]
    Ffmpeg,
    #[serde(rename = "deno")]
    Deno,
}

impl Tool {
    pub const ALL: [Self; 3] = [Self::YtDlp, Self::Ffmpeg, Self::Deno];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::YtDlp => "yt-dlp",
            Self::Ffmpeg => "ffmpeg",
            Self::Deno => "deno",
        }
    }

    pub fn binary_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Self::YtDlp, true) => "yt-dlp.exe",
            (Self::Ffmpeg, true) => "ffmpeg.exe",
            (Self::Deno, true) => "deno.exe",
            (Self::YtDlp, false) => "yt-dlp",
            (Self::Ffmpeg, false) => "ffmpeg",
            (Self::Deno, false) => "deno",
        }
    }
}

impl fmt::Display for Tool {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for Tool {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "yt-dlp" => Ok(Self::YtDlp),
            "ffmpeg" => Ok(Self::Ffmpeg),
            "deno" => Ok(Self::Deno),
            _ => Err(format!("不支援的工具：{value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledVersion {
    pub version: String,
    pub path: String,
    pub sha256: String,
    pub source_url: String,
    pub size_bytes: u64,
    pub installed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolState {
    pub selected: Option<String>,
    #[serde(default)]
    pub installed: Vec<InstalledVersion>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolsState {
    #[serde(rename = "yt-dlp")]
    pub yt_dlp: ToolState,
    pub ffmpeg: ToolState,
    #[serde(default)]
    pub deno: ToolState,
}

impl ToolsState {
    pub fn get(&self, tool: Tool) -> &ToolState {
        match tool {
            Tool::YtDlp => &self.yt_dlp,
            Tool::Ffmpeg => &self.ffmpeg,
            Tool::Deno => &self.deno,
        }
    }

    pub fn get_mut(&mut self, tool: Tool) -> &mut ToolState {
        match tool {
            Tool::YtDlp => &mut self.yt_dlp,
            Tool::Ffmpeg => &mut self.ffmpeg,
            Tool::Deno => &mut self.deno,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub output_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u32,
    pub tools: ToolsState,
    #[serde(default)]
    pub settings: Settings,
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            schema_version: 2,
            tools: ToolsState::default(),
            settings: Settings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInstalledVersion {
    pub version: String,
    pub path: String,
    pub sha256: String,
    pub source_url: String,
    pub size_bytes: u64,
    pub installed_at: String,
}

impl From<&InstalledVersion> for ApiInstalledVersion {
    fn from(value: &InstalledVersion) -> Self {
        Self {
            version: value.version.clone(),
            path: value.path.clone(),
            sha256: value.sha256.clone(),
            source_url: value.source_url.clone(),
            size_bytes: value.size_bytes,
            installed_at: value.installed_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiToolState {
    pub selected: Option<String>,
    pub installed: Vec<ApiInstalledVersion>,
}

impl From<&ToolState> for ApiToolState {
    fn from(value: &ToolState) -> Self {
        Self {
            selected: value.selected.clone(),
            installed: value
                .installed
                .iter()
                .map(ApiInstalledVersion::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSettings {
    pub output_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub tools: BTreeMap<String, ApiToolState>,
    pub settings: ApiSettings,
    pub active_job_id: Option<String>,
    pub active_download: Option<ActiveDownloadStatus>,
}

impl AppStatus {
    pub fn from_manifest(
        manifest: &Manifest,
        active_download: Option<ActiveDownloadStatus>,
    ) -> Self {
        let tools = Tool::ALL
            .into_iter()
            .map(|tool| {
                (
                    tool.as_str().to_owned(),
                    ApiToolState::from(manifest.tools.get(tool)),
                )
            })
            .collect();
        Self {
            tools,
            settings: ApiSettings {
                output_directory: manifest.settings.output_directory.clone(),
            },
            active_job_id: active_download
                .as_ref()
                .map(|download| download.job_id.clone()),
            active_download,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSpec {
    pub url: String,
    pub start_seconds: u64,
    pub end_seconds: u64,
    pub output_name: String,
    pub format_preset: FormatPreset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatPreset {
    Avc1Mp4a,
    Best,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadPhase {
    Preparing,
    Downloading,
    Finalizing,
    Waiting,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDownloadStatus {
    pub job_id: String,
    pub url: String,
    pub start_seconds: u64,
    pub end_seconds: u64,
    pub output_name: String,
    pub output_path: String,
    pub format_preset: FormatPreset,
    pub started_at: String,
    pub phase: DownloadPhase,
    pub percent: Option<f64>,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub downloaded_bytes: u64,
    pub elapsed_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub job_id: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHistoryEntry {
    pub id: String,
    pub url: String,
    pub start_seconds: u64,
    pub end_seconds: u64,
    pub output_name: String,
    pub output_path: String,
    pub format_preset: FormatPreset,
    pub completed_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDownloadHistoryEntry {
    pub id: String,
    pub url: String,
    pub start_seconds: u64,
    pub end_seconds: u64,
    pub output_name: String,
    pub output_path: String,
    pub format_preset: FormatPreset,
    pub completed_at: String,
    pub size_bytes: u64,
    pub file_exists: bool,
}

impl From<&DownloadHistoryEntry> for ApiDownloadHistoryEntry {
    fn from(value: &DownloadHistoryEntry) -> Self {
        Self {
            id: value.id.clone(),
            url: value.url.clone(),
            start_seconds: value.start_seconds,
            end_seconds: value.end_seconds,
            output_name: value.output_name.clone(),
            output_path: value.output_path.clone(),
            format_preset: value.format_preset,
            completed_at: value.completed_at.clone(),
            size_bytes: value.size_bytes,
            file_exists: std::path::Path::new(&value.output_path).is_file(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableRelease {
    pub tool: Tool,
    pub version: String,
    pub asset_name: String,
    pub size_bytes: u64,
    pub published_at: Option<String>,
    #[serde(skip)]
    pub asset_url: String,
    #[serde(skip)]
    pub checksum_url: String,
    #[serde(skip)]
    pub expected_sha256: Option<String>,
    #[serde(skip)]
    pub archive: bool,
}
