use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("檔案操作失敗：{0}")]
    Io(#[from] std::io::Error),
    #[error("資料格式錯誤：{0}")]
    Json(#[from] serde_json::Error),
    #[error("網路請求失敗：{0}")]
    Http(#[from] reqwest::Error),
    #[error("壓縮檔處理失敗：{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("系統工具執行失敗：{0}")]
    Shell(#[from] tauri_plugin_shell::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        Self::Message(value.to_string())
    }
}

impl From<tempfile::PersistError> for AppError {
    fn from(value: tempfile::PersistError) -> Self {
        Self::Io(value.error)
    }
}

pub type AppResult<T> = Result<T, AppError>;
