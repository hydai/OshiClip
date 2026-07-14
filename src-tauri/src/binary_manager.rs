use crate::{
    error::{AppError, AppResult},
    manifest::{relative_binary_path, ManifestStore},
    models::{ApiInstalledVersion, AvailableRelease, InstalledVersion, Tool},
    AppState,
};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "macos"))]
use std::collections::BTreeSet;
use std::{fs, io, path::Path, time::Duration};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

const MAX_DOWNLOAD_BYTES: u64 = 1_000_000_000;

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    tool: Tool,
    version: &'a str,
    percent: u8,
    stage: &'a str,
}

fn github_client() -> AppResult<Client> {
    Ok(Client::builder()
        .user_agent("vods-oshi-desktop/0.1")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()?)
}

#[tauri::command]
pub async fn list_available_versions(tool: Tool) -> AppResult<Vec<AvailableRelease>> {
    fetch_available_releases(&github_client()?, tool).await
}

#[tauri::command]
pub async fn install_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    tool: Tool,
    version: Option<String>,
) -> AppResult<ApiInstalledVersion> {
    let _install_guard = state.install_lock.lock().await;
    let client = github_client()?;
    let releases = fetch_available_releases(&client, tool).await?;
    let release = match version.as_deref() {
        Some(requested) => releases
            .into_iter()
            .find(|release| release.version == requested)
            .ok_or_else(|| AppError::Message(format!("找不到 {tool} {requested} 的可用下載")))?,
        None => releases
            .into_iter()
            .next()
            .ok_or_else(|| AppError::Message(format!("目前找不到可安裝的 {tool} 版本")))?,
    };
    validate_version(&release.version)?;
    ensure_github_url(&release.asset_url)?;
    if !release.checksum_url.is_empty() {
        ensure_github_url(&release.checksum_url)?;
    }

    let store = ManifestStore::new(state.app_data.clone());
    let mut manifest = store.read()?;
    if let Some(existing) = manifest
        .tools
        .get(tool)
        .installed
        .iter()
        .find(|installed| installed.version == release.version)
        .cloned()
    {
        manifest.tools.get_mut(tool).selected = Some(release.version.clone());
        store.write(&manifest)?;
        return Ok(ApiInstalledVersion::from(&existing));
    }

    emit_progress(&app, tool, &release.version, 0, "downloading");
    let expected_hash = match release.expected_sha256.clone() {
        Some(hash) => hash,
        None => fetch_expected_sha256(&client, &release.checksum_url, &release.asset_name).await?,
    };

    let downloads_root = state.app_data.join("downloads");
    fs::create_dir_all(&downloads_root)?;
    let temporary = tempfile::Builder::new()
        .prefix(&format!("{}-", tool.as_str()))
        .tempdir_in(&downloads_root)?;
    let asset_path = temporary.path().join(&release.asset_name);
    let (actual_hash, downloaded_size) = download_and_hash(
        &client,
        &release.asset_url,
        &asset_path,
        &app,
        tool,
        &release.version,
    )
    .await?;

    emit_progress(&app, tool, &release.version, 88, "verifying");
    if !actual_hash.eq_ignore_ascii_case(&expected_hash) {
        return Err(AppError::Message(
            "SHA256 驗證失敗：檔案可能損毀或被竄改，已刪除暫存檔".into(),
        ));
    }

    let prepared_binary = if release.archive {
        emit_progress(&app, tool, &release.version, 92, "extracting");
        let archive = asset_path.clone();
        let extracted = temporary.path().join(tool.binary_name());
        let extracted_for_task = extracted.clone();
        tokio::task::spawn_blocking(move || extract_binary(&archive, &extracted_for_task, tool))
            .await
            .map_err(|error| AppError::Message(format!("解壓縮工作失敗：{error}")))??;
        extracted
    } else {
        asset_path
    };

    emit_progress(&app, tool, &release.version, 96, "installing");
    set_executable(&prepared_binary)?;

    let tool_root = state.app_data.join("bin").join(tool.as_str());
    fs::create_dir_all(&tool_root)?;
    let final_directory = tool_root.join(&release.version);
    if final_directory.exists() {
        return Err(AppError::Message(format!(
            "安裝目錄已存在，請先移除或修復 {tool} {}",
            release.version
        )));
    }
    let staging_directory = tool_root.join(format!(
        ".install-{}-{}",
        release.version,
        Utc::now().timestamp_millis()
    ));
    fs::create_dir(&staging_directory)?;
    let staged_binary = staging_directory.join(tool.binary_name());
    if let Err(error) = move_or_copy(&prepared_binary, &staged_binary) {
        let _ = fs::remove_dir_all(&staging_directory);
        return Err(error);
    }
    fs::rename(&staging_directory, &final_directory)?;
    sync_directory(&tool_root);

    let final_binary = final_directory.join(tool.binary_name());
    let installed = InstalledVersion {
        version: release.version.clone(),
        path: relative_binary_path(tool, &release.version),
        sha256: actual_hash,
        source_url: release.asset_url,
        size_bytes: fs::metadata(&final_binary)
            .map(|metadata| metadata.len())
            .unwrap_or(downloaded_size),
        installed_at: Utc::now().to_rfc3339(),
    };

    let tool_state = manifest.tools.get_mut(tool);
    tool_state.installed.push(installed.clone());
    tool_state
        .installed
        .sort_by(|left, right| right.version.cmp(&left.version));
    tool_state.selected = Some(installed.version.clone());
    if let Err(error) = store.write(&manifest) {
        let _ = fs::remove_dir_all(&final_directory);
        return Err(error);
    }

    emit_progress(&app, tool, &installed.version, 100, "installing");
    Ok(ApiInstalledVersion::from(&installed))
}

#[tauri::command]
pub fn switch_tool_version(
    state: State<'_, AppState>,
    tool: Tool,
    version: String,
) -> AppResult<()> {
    validate_version(&version)?;
    let store = ManifestStore::new(state.app_data.clone());
    let mut manifest = store.read()?;
    let tool_state = manifest.tools.get_mut(tool);
    let installed = tool_state
        .installed
        .iter()
        .find(|installed| installed.version == version)
        .ok_or_else(|| AppError::Message(format!("尚未安裝 {tool} {version}")))?;
    let binary = store.resolve_relative(&installed.path)?;
    if !binary.is_file() {
        return Err(AppError::Message(format!(
            "找不到 {tool} {version} 的執行檔"
        )));
    }
    tool_state.selected = Some(version);
    store.write(&manifest)
}

#[tauri::command]
pub fn remove_tool_version(
    state: State<'_, AppState>,
    tool: Tool,
    version: String,
) -> AppResult<()> {
    validate_version(&version)?;
    let store = ManifestStore::new(state.app_data.clone());
    let mut manifest = store.read()?;
    let tool_state = manifest.tools.get_mut(tool);
    if tool_state.selected.as_deref() == Some(version.as_str()) {
        return Err(AppError::Message(
            "使用中的版本無法移除，請先切換版本".into(),
        ));
    }
    let index = tool_state
        .installed
        .iter()
        .position(|installed| installed.version == version)
        .ok_or_else(|| AppError::Message(format!("尚未安裝 {tool} {version}")))?;
    let installed = tool_state.installed.remove(index);
    let binary = store.resolve_relative(&installed.path)?;
    let version_directory = binary
        .parent()
        .ok_or_else(|| AppError::Message("工具路徑無效".into()))?;
    let trash_directory = version_directory.with_file_name(format!(
        ".trash-{}-{}",
        version,
        Utc::now().timestamp_millis()
    ));
    if version_directory.exists() {
        fs::rename(version_directory, &trash_directory)?;
    }
    if let Err(error) = store.write(&manifest) {
        if trash_directory.exists() {
            let _ = fs::rename(&trash_directory, version_directory);
        }
        return Err(error);
    }
    if trash_directory.exists() {
        fs::remove_dir_all(trash_directory)?;
    }
    Ok(())
}

async fn fetch_available_releases(client: &Client, tool: Tool) -> AppResult<Vec<AvailableRelease>> {
    match tool {
        Tool::YtDlp => fetch_ytdlp_releases(client).await,
        Tool::Ffmpeg => fetch_ffmpeg_releases(client).await,
        Tool::Deno => fetch_deno_releases(client).await,
    }
}

async fn fetch_ytdlp_releases(client: &Client) -> AppResult<Vec<AvailableRelease>> {
    let releases = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases?per_page=8")
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<GithubRelease>>()
        .await?;
    let asset_name = ytdlp_asset_name();
    let mut available = Vec::new();
    for release in releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
    {
        let Some(asset) = release.assets.iter().find(|asset| asset.name == asset_name) else {
            continue;
        };
        let Some(checksum) = release
            .assets
            .iter()
            .find(|candidate| candidate.name == "SHA2-256SUMS")
        else {
            continue;
        };
        available.push(AvailableRelease {
            tool: Tool::YtDlp,
            version: release.tag_name,
            asset_name: asset.name.clone(),
            size_bytes: asset.size,
            published_at: release.published_at,
            asset_url: asset.browser_download_url.clone(),
            checksum_url: checksum.browser_download_url.clone(),
            expected_sha256: github_asset_sha256(asset),
            archive: false,
        });
    }
    Ok(available)
}

async fn fetch_ffmpeg_releases(client: &Client) -> AppResult<Vec<AvailableRelease>> {
    #[cfg(target_os = "macos")]
    {
        return fetch_macos_ffmpeg_releases(client).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        fetch_btbn_ffmpeg_releases(client).await
    }
}

#[cfg(target_os = "macos")]
async fn fetch_macos_ffmpeg_releases(client: &Client) -> AppResult<Vec<AvailableRelease>> {
    let release = client
        .get("https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json::<GithubRelease>()
        .await?;
    let asset_name = if cfg!(target_arch = "aarch64") {
        "ffmpeg-darwin-arm64"
    } else {
        "ffmpeg-darwin-x64"
    };
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| AppError::Message("macOS ffmpeg release 缺少目前架構的執行檔".into()))?;
    let expected_sha256 = github_asset_sha256(asset).ok_or_else(|| {
        AppError::Message("macOS ffmpeg release 缺少 GitHub SHA256 digest".into())
    })?;
    let version = release.tag_name.trim_start_matches('b').to_owned();
    Ok(vec![AvailableRelease {
        tool: Tool::Ffmpeg,
        version,
        asset_name: asset.name.clone(),
        size_bytes: asset.size,
        published_at: release.published_at,
        asset_url: asset.browser_download_url.clone(),
        checksum_url: String::new(),
        expected_sha256: Some(expected_sha256),
        archive: false,
    }])
}

#[cfg(not(target_os = "macos"))]
async fn fetch_btbn_ffmpeg_releases(client: &Client) -> AppResult<Vec<AvailableRelease>> {
    let release = client
        .get("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json::<GithubRelease>()
        .await?;
    let platform = ffmpeg_platform_token();
    let archive_suffix = if cfg!(windows) { ".zip" } else { ".tar.xz" };
    let checksum = release
        .assets
        .iter()
        .find(|asset| asset.name == "checksums.sha256");
    let mut versions = BTreeSet::new();
    let mut available = Vec::new();
    for asset in &release.assets {
        let Some(version) = ffmpeg_version_from_asset(&asset.name, platform, archive_suffix) else {
            continue;
        };
        if !versions.insert(version.clone()) {
            continue;
        }
        let digest = github_asset_sha256(asset);
        if digest.is_none() && checksum.is_none() {
            continue;
        }
        available.push(AvailableRelease {
            tool: Tool::Ffmpeg,
            version,
            asset_name: asset.name.clone(),
            size_bytes: asset.size,
            published_at: release.published_at.clone(),
            asset_url: asset.browser_download_url.clone(),
            checksum_url: checksum
                .map(|asset| asset.browser_download_url.clone())
                .unwrap_or_default(),
            expected_sha256: digest,
            archive: true,
        });
    }
    available.sort_by(|left, right| version_rank(&right.version).cmp(&version_rank(&left.version)));
    Ok(available)
}

async fn fetch_deno_releases(client: &Client) -> AppResult<Vec<AvailableRelease>> {
    let releases = client
        .get("https://api.github.com/repos/denoland/deno/releases?per_page=5")
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<GithubRelease>>()
        .await?;
    let asset_name = deno_asset_name();
    let checksum_name = format!("{asset_name}.sha256sum");
    let mut available = Vec::new();
    for release in releases
        .into_iter()
        .filter(|release| !release.draft && !release.prerelease)
    {
        let Some(asset) = release.assets.iter().find(|asset| asset.name == asset_name) else {
            continue;
        };
        let checksum_url = release
            .assets
            .iter()
            .find(|asset| asset.name == checksum_name)
            .map(|asset| asset.browser_download_url.clone())
            .unwrap_or_default();
        let digest = github_asset_sha256(asset);
        if digest.is_none() && checksum_url.is_empty() {
            continue;
        }
        available.push(AvailableRelease {
            tool: Tool::Deno,
            version: release.tag_name,
            asset_name: asset.name.clone(),
            size_bytes: asset.size,
            published_at: release.published_at,
            asset_url: asset.browser_download_url.clone(),
            checksum_url,
            expected_sha256: digest,
            archive: true,
        });
    }
    Ok(available)
}

#[cfg(any(not(target_os = "macos"), test))]
fn ffmpeg_version_from_asset(name: &str, platform: &str, archive_suffix: &str) -> Option<String> {
    let remainder = name.strip_prefix("ffmpeg-")?;
    let (version, platform_and_flavor) = remainder.split_once("-latest-")?;
    if !version.starts_with('n') || version.contains('-') || version.len() > 20 {
        return None;
    }
    let base = format!("{platform}-gpl");
    let version_suffix = version.trim_start_matches('n');
    let expected_plain = format!("{base}{archive_suffix}");
    let expected_versioned = format!("{base}-{version_suffix}{archive_suffix}");
    if platform_and_flavor != expected_plain && platform_and_flavor != expected_versioned {
        return None;
    }
    Some(version.to_owned())
}

fn github_asset_sha256(asset: &GithubAsset) -> Option<String> {
    let hash = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    (hash.len() == 64 && hash.chars().all(|character| character.is_ascii_hexdigit()))
        .then(|| hash.to_ascii_lowercase())
}

#[cfg(not(target_os = "macos"))]
fn version_rank(version: &str) -> Vec<u32> {
    version
        .trim_start_matches('n')
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

async fn fetch_expected_sha256(
    client: &Client,
    checksum_url: &str,
    asset_name: &str,
) -> AppResult<String> {
    let response = client.get(checksum_url).send().await?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|length| length > 2_000_000)
    {
        return Err(AppError::Message("校驗檔大小異常".into()));
    }
    let body = response.text().await?;
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else { continue };
        let filename = parts.next().unwrap_or_default().trim_start_matches('*');
        if (filename.is_empty() || filename == asset_name)
            && hash.len() == 64
            && hash.chars().all(|character| character.is_ascii_hexdigit())
        {
            return Ok(hash.to_ascii_lowercase());
        }
    }
    Err(AppError::Message(format!(
        "校驗檔中找不到 {asset_name} 的 SHA256"
    )))
}

async fn download_and_hash(
    client: &Client,
    url: &str,
    destination: &Path,
    app: &AppHandle,
    tool: Tool,
    version: &str,
) -> AppResult<(String, u64)> {
    let response = client.get(url).send().await?.error_for_status()?;
    let total = response.content_length().unwrap_or(0);
    if total > MAX_DOWNLOAD_BYTES {
        return Err(AppError::Message("下載檔案大小超出安全上限".into()));
    }
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(destination).await?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(AppError::Message("下載檔案大小超出安全上限".into()));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        let percent = downloaded
            .saturating_mul(85)
            .checked_div(total)
            .unwrap_or(1)
            .min(85) as u8;
        emit_progress(app, tool, version, percent, "downloading");
    }
    file.flush().await?;
    file.sync_all().await?;
    Ok((hex::encode(hasher.finalize()), downloaded))
}

fn extract_binary(archive_path: &Path, destination: &Path, tool: Tool) -> AppResult<()> {
    if archive_path
        .extension()
        .and_then(|extension| extension.to_str())
        == Some("zip")
    {
        let archive_file = fs::File::open(archive_path)?;
        let mut archive = zip::ZipArchive::new(archive_file)?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            let is_binary = Path::new(entry.name())
                .file_name()
                .and_then(|name| name.to_str())
                == Some(tool.binary_name());
            if is_binary && entry.is_file() {
                let mut output = fs::File::create(destination)?;
                io::copy(&mut entry, &mut output)?;
                output.sync_all()?;
                return Ok(());
            }
        }
    } else if archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".tar.xz"))
    {
        #[cfg(any(target_os = "linux", test))]
        return extract_tar_xz_binary(archive_path, destination, tool);

        #[cfg(not(any(target_os = "linux", test)))]
        return Err(AppError::Message(format!(
            "{} 的 tar.xz 壓縮包只支援 Linux",
            tool.as_str()
        )));
    } else {
        return Err(AppError::Message(format!(
            "{} 壓縮包不是受支援的 ZIP 或 tar.xz 格式",
            tool.as_str()
        )));
    }
    Err(AppError::Message(format!(
        "{} 壓縮包內找不到執行檔",
        tool.as_str()
    )))
}

#[cfg(any(target_os = "linux", test))]
fn extract_tar_xz_binary(archive_path: &Path, destination: &Path, tool: Tool) -> AppResult<()> {
    let archive_file = io::BufReader::new(fs::File::open(archive_path)?);
    let decoder = lzma_rust2::XzReader::new(archive_file, true);
    let mut archive = tar::Archive::new(decoder);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        let is_binary = path.file_name().and_then(|name| name.to_str()) == Some(tool.binary_name());
        if is_binary && entry.header().entry_type().is_file() {
            let mut output = fs::File::create(destination)?;
            io::copy(&mut entry, &mut output)?;
            output.sync_all()?;
            return Ok(());
        }
    }
    Err(AppError::Message(format!(
        "{} 壓縮包內找不到執行檔",
        tool.as_str()
    )))
}

fn move_or_copy(source: &Path, destination: &Path) -> AppResult<()> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, destination)?;
            fs::File::open(destination)?.sync_all()?;
            fs::remove_file(source)?;
            Ok(())
        }
    }
}

#[cfg(unix)]
fn set_executable(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> AppResult<()> {
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) {
    if let Ok(directory) = fs::File::open(path) {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) {}

fn emit_progress(app: &AppHandle, tool: Tool, version: &str, percent: u8, stage: &str) {
    let _ = app.emit(
        "tool-install-progress",
        InstallProgress {
            tool,
            version,
            percent,
            stage,
        },
    );
}

fn validate_version(version: &str) -> AppResult<()> {
    let valid = !version.is_empty()
        && version.len() <= 80
        && !version.contains("..")
        && version.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::Message("版本字串格式不安全".into()))
    }
}

fn ensure_github_url(value: &str) -> AppResult<()> {
    let url = url::Url::parse(value).map_err(|_| AppError::Message("下載網址格式不正確".into()))?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() == "https" && matches!(host, "github.com" | "objects.githubusercontent.com") {
        Ok(())
    } else {
        Err(AppError::Message("下載來源不在允許的 GitHub 網域".into()))
    }
}

#[cfg(target_os = "macos")]
fn ytdlp_asset_name() -> &'static str {
    "yt-dlp_macos"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn ytdlp_asset_name() -> &'static str {
    "yt-dlp_linux_aarch64"
}

#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
fn ytdlp_asset_name() -> &'static str {
    "yt-dlp_linux"
}

#[cfg(windows)]
fn ytdlp_asset_name() -> &'static str {
    "yt-dlp.exe"
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn deno_asset_name() -> &'static str {
    "deno-aarch64-apple-darwin.zip"
}

#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
fn deno_asset_name() -> &'static str {
    "deno-x86_64-apple-darwin.zip"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn deno_asset_name() -> &'static str {
    "deno-aarch64-unknown-linux-gnu.zip"
}

#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
fn deno_asset_name() -> &'static str {
    "deno-x86_64-unknown-linux-gnu.zip"
}

#[cfg(all(windows, target_arch = "aarch64"))]
fn deno_asset_name() -> &'static str {
    "deno-aarch64-pc-windows-msvc.zip"
}

#[cfg(all(windows, not(target_arch = "aarch64")))]
fn deno_asset_name() -> &'static str {
    "deno-x86_64-pc-windows-msvc.zip"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn ffmpeg_platform_token() -> &'static str {
    "linuxarm64"
}

#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
fn ffmpeg_platform_token() -> &'static str {
    "linux64"
}

#[cfg(windows)]
fn ffmpeg_platform_token() -> &'static str {
    "win64"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_tar_xz_with_the_pure_rust_decoder() {
        let temporary = tempfile::tempdir().expect("create temporary directory");
        let archive_path = temporary.path().join("ffmpeg.tar.xz");
        let destination = temporary.path().join("ffmpeg");
        let payload = b"fake ffmpeg executable";

        let mut tar_bytes = Vec::new();
        {
            let mut archive = tar::Builder::new(&mut tar_bytes);
            let mut header = tar::Header::new_gnu();
            header.set_size(payload.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            archive
                .append_data(&mut header, "release/bin/ffmpeg", &payload[..])
                .expect("append fake ffmpeg to tar archive");
            archive.finish().expect("finish tar archive");
        }

        let archive_file = fs::File::create(&archive_path).expect("create xz archive");
        let mut encoder =
            lzma_rust2::XzWriter::new(archive_file, lzma_rust2::XzOptions::with_preset(1))
                .expect("create pure Rust xz encoder");
        encoder.write_all(&tar_bytes).expect("compress tar archive");
        encoder
            .finish()
            .expect("finish xz archive")
            .sync_all()
            .expect("sync xz archive");

        extract_binary(&archive_path, &destination, Tool::Ffmpeg).expect("extract fake ffmpeg");
        assert_eq!(
            fs::read(destination).expect("read extracted binary"),
            payload
        );
    }

    #[test]
    fn parses_only_stable_ffmpeg_assets_for_the_platform() {
        assert_eq!(
            ffmpeg_version_from_asset(
                "ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz",
                "linux64",
                ".tar.xz"
            ),
            Some("n8.1".into())
        );
        assert_eq!(
            ffmpeg_version_from_asset(
                "ffmpeg-master-latest-linux64-gpl.tar.xz",
                "linux64",
                ".tar.xz"
            ),
            None
        );
        assert_eq!(
            ffmpeg_version_from_asset("ffmpeg-n8.1-latest-win64-gpl-8.1.zip", "linux64", ".tar.xz"),
            None
        );
    }

    #[test]
    fn rejects_unsafe_version_strings() {
        assert!(validate_version("2026.07.11").is_ok());
        assert!(validate_version("../escape").is_err());
        assert!(validate_version("n8.0/../../escape").is_err());
    }
}
