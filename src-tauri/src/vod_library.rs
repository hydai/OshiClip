use crate::{
    error::{AppError, AppResult},
    AppState,
};
use chrono::{DateTime, NaiveDate};
use futures_util::StreamExt;
use reqwest::{header::CONTENT_TYPE, Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    time::{Duration, Instant},
};
use tauri::State;
use unicode_normalization::UnicodeNormalization;
use url::Url;

const MANIFEST_URL: &str = "https://data.oshi.tw/vod/v1/manifest.json";
const SNAPSHOT_PREFIX: &str = "https://data.oshi.tw/vod/v1/snapshots/";
const MAX_MANIFEST_BYTES: usize = 65_536;
const MAX_SNAPSHOT_BYTES: usize = 10_485_760;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const FAILED_REFRESH_RETRY: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VodCounts {
    pub streamers: u64,
    pub vods: u64,
    pub performances: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VodManifest {
    schema_version: String,
    snapshot_url: String,
    sha256: String,
    published_at: String,
    uncompressed_bytes: u64,
    counts: VodCounts,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VodSnapshot {
    schema_version: String,
    streamers: Vec<VodStreamer>,
}

#[derive(Debug, Deserialize)]
#[serde(transparent)]
struct RequiredNullableString(Option<String>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VodStreamer {
    slug: String,
    display_name: String,
    youtube_channel_id: String,
    avatar_url: RequiredNullableString,
    group: RequiredNullableString,
    social_links: BTreeMap<String, Value>,
    vods: Vec<Vod>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vod {
    title: String,
    date: String,
    video_id: String,
    performances: Vec<VodPerformance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VodPerformance {
    performance_id: String,
    song_id: String,
    title: String,
    original_artist: RequiredNullableString,
    start_seconds: u64,
    end_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodLibraryDataset {
    pub schema_version: String,
    pub published_at: String,
    pub sha256: String,
    pub counts: VodCounts,
    pub streamers: Vec<VodLibraryStreamer>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodLibraryStreamer {
    pub slug: String,
    pub display_name: String,
    pub group: Option<String>,
    pub vods: Vec<VodLibraryVod>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodLibraryVod {
    pub title: String,
    pub date: String,
    pub video_id: String,
    pub performances: Vec<VodLibraryPerformance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodLibraryPerformance {
    pub performance_id: String,
    pub title: String,
    pub original_artist: Option<String>,
    pub start_seconds: u64,
    pub end_seconds: u64,
}

pub(crate) struct CachedVodLibrary {
    dataset: VodLibraryDataset,
    next_refresh_at: Instant,
}

fn vod_client() -> AppResult<Client> {
    Ok(Client::builder()
        .user_agent(concat!("OshiClip/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

#[tauri::command]
pub async fn get_vod_library(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> AppResult<VodLibraryDataset> {
    let force_refresh = force_refresh.unwrap_or(false);
    let mut cache = state.vod_library_cache.lock().await;

    if !force_refresh {
        if let Some(entry) = cache.as_ref() {
            if Instant::now() < entry.next_refresh_at {
                return Ok(entry.dataset.clone());
            }
        }
    }

    let client = match vod_client() {
        Ok(client) => client,
        Err(error) => return cached_or_error(&mut cache, force_refresh, error),
    };
    let manifest = match fetch_manifest(&client).await {
        Ok(manifest) => manifest,
        Err(error) => return cached_or_error(&mut cache, force_refresh, error),
    };

    if let Some(entry) = cache.as_mut() {
        if entry.dataset.sha256 == manifest.sha256 {
            entry.next_refresh_at = Instant::now() + REFRESH_INTERVAL;
            return Ok(entry.dataset.clone());
        }
    }

    let dataset = match fetch_snapshot(&client, manifest).await {
        Ok(dataset) => dataset,
        Err(error) => return cached_or_error(&mut cache, force_refresh, error),
    };

    *cache = Some(CachedVodLibrary {
        dataset: dataset.clone(),
        next_refresh_at: Instant::now() + REFRESH_INTERVAL,
    });
    Ok(dataset)
}

fn cached_or_error(
    cache: &mut Option<CachedVodLibrary>,
    force_refresh: bool,
    error: AppError,
) -> AppResult<VodLibraryDataset> {
    if !force_refresh {
        if let Some(entry) = cache.as_mut() {
            entry.next_refresh_at = Instant::now() + FAILED_REFRESH_RETRY;
            return Ok(entry.dataset.clone());
        }
    }
    Err(error)
}

async fn fetch_manifest(client: &Client) -> AppResult<VodManifest> {
    let response = client
        .get(MANIFEST_URL)
        .header("accept", "application/json")
        .send()
        .await?;
    assert_json_response(&response, MANIFEST_URL, "資料索引")?;
    let bytes = read_bytes_with_limit(response, MAX_MANIFEST_BYTES).await?;
    let manifest: VodManifest = parse_json(&bytes, "資料索引")?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

async fn fetch_snapshot(client: &Client, manifest: VodManifest) -> AppResult<VodLibraryDataset> {
    let response = client
        .get(&manifest.snapshot_url)
        .header("accept", "application/json")
        .send()
        .await?;
    assert_json_response(&response, &manifest.snapshot_url, "VOD 資料")?;
    let bytes = read_bytes_with_limit(response, MAX_SNAPSHOT_BYTES).await?;

    if bytes.len() as u64 != manifest.uncompressed_bytes {
        return Err(message("VOD 資料大小與索引不符"));
    }
    let actual_sha256 = hex::encode(Sha256::digest(&bytes));
    if actual_sha256 != manifest.sha256 {
        return Err(message("VOD 資料 SHA-256 驗證失敗"));
    }

    let snapshot: VodSnapshot = parse_json(&bytes, "VOD 資料")?;
    validate_snapshot(&snapshot, &manifest)?;
    Ok(to_library_dataset(manifest, snapshot))
}

fn assert_json_response(response: &Response, expected_url: &str, label: &str) -> AppResult<()> {
    if response.status() != StatusCode::OK || response.url().as_str() != expected_url {
        return Err(message(format!(
            "{label}回應不正確（HTTP {}）",
            response.status()
        )));
    }
    let media_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    if media_type.as_deref() != Some("application/json") {
        return Err(message(format!("{label}不是 JSON 格式")));
    }
    Ok(())
}

async fn read_bytes_with_limit(response: Response, limit: usize) -> AppResult<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(message(format!("遠端資料超過 {limit} bytes 安全上限")));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn parse_json<T>(bytes: &[u8], label: &str) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(message(format!("{label}含有不允許的 UTF-8 BOM")));
    }
    let raw: Value = serde_json::from_slice(bytes)?;
    Ok(serde_json::from_value(raw)?)
}

fn validate_manifest(manifest: &VodManifest) -> AppResult<()> {
    validate_schema_version(&manifest.schema_version)?;
    if !is_lower_hex_sha256(&manifest.sha256) {
        return Err(message("資料索引的 SHA-256 格式不正確"));
    }
    let expected_url = format!("{SNAPSHOT_PREFIX}{}.json", manifest.sha256);
    if manifest.snapshot_url != expected_url {
        return Err(message("資料索引包含未受信任的 snapshot URL"));
    }
    if !is_exact_utc_milliseconds(&manifest.published_at) {
        return Err(message("資料索引的發布時間格式不正確"));
    }
    if manifest.uncompressed_bytes == 0 || manifest.uncompressed_bytes > MAX_SNAPSHOT_BYTES as u64 {
        return Err(message("資料索引的 snapshot 大小超出安全範圍"));
    }
    validate_count_limits(&manifest.counts)
}

fn validate_schema_version(version: &str) -> AppResult<()> {
    let parts = version.split('.').collect::<Vec<_>>();
    let valid_part = |part: &str| {
        !part.is_empty()
            && part.chars().all(|character| character.is_ascii_digit())
            && (part == "0" || !part.starts_with('0'))
            && part.parse::<u64>().is_ok()
    };
    if parts.len() != 3 || parts.iter().any(|part| !valid_part(part)) || parts[0] != "1" {
        return Err(message(format!("不支援的 VOD schema 版本：{version}")));
    }
    Ok(())
}

fn validate_count_limits(counts: &VodCounts) -> AppResult<()> {
    if counts.streamers > 500 || counts.vods > 10_000 || counts.performances > 50_000 {
        return Err(message("VOD 資料筆數超出 v1 安全上限"));
    }
    Ok(())
}

fn validate_snapshot(snapshot: &VodSnapshot, manifest: &VodManifest) -> AppResult<()> {
    if snapshot.schema_version != manifest.schema_version {
        return Err(message("資料索引與 VOD snapshot 的 schema 版本不一致"));
    }
    if snapshot.streamers.len() > 500 {
        return Err(message("VTuber 筆數超出安全上限"));
    }

    let mut slugs = HashSet::new();
    let mut channel_ids = HashSet::new();
    let mut performance_ids = HashSet::new();
    let mut previous_slug: Option<&str> = None;
    let mut vod_count = 0_u64;
    let mut performance_count = 0_u64;

    for streamer in &snapshot.streamers {
        validate_slug(&streamer.slug)?;
        validate_display_text(&streamer.display_name, "VTuber 顯示名稱")?;
        validate_nullable_display_text(streamer.group.0.as_deref(), "VTuber 團體")?;
        if streamer.youtube_channel_id.is_empty() {
            return Err(message("YouTube channel ID 不可為空"));
        }
        if !slugs.insert(streamer.slug.as_str()) {
            return Err(message("VOD 資料包含重複的 VTuber slug"));
        }
        if !channel_ids.insert(streamer.youtube_channel_id.as_str()) {
            return Err(message("VOD 資料包含重複的 YouTube channel ID"));
        }
        if previous_slug.is_some_and(|previous| previous >= streamer.slug.as_str()) {
            return Err(message("VTuber 資料未依 canonical order 排列"));
        }
        previous_slug = Some(&streamer.slug);

        if let Some(avatar_url) = streamer.avatar_url.0.as_deref() {
            validate_safe_url(
                avatar_url,
                &[
                    "yt3.ggpht.com",
                    "yt4.ggpht.com",
                    "yt3.googleusercontent.com",
                    "lh3.googleusercontent.com",
                ],
                "VTuber 頭像",
            )?;
        }
        validate_social_links(&streamer.social_links)?;
        if streamer.vods.len() > 10_000 {
            return Err(message("單一 VTuber 的 VOD 筆數超出安全上限"));
        }

        let mut video_ids = HashSet::new();
        let mut previous_vod: Option<&Vod> = None;
        for vod in &streamer.vods {
            vod_count += 1;
            validate_display_text(&vod.title, "VOD 標題")?;
            validate_date(&vod.date)?;
            validate_video_id(&vod.video_id)?;
            if !video_ids.insert(vod.video_id.as_str()) {
                return Err(message("同一 VTuber 之下包含重複的 VOD"));
            }
            if let Some(previous) = previous_vod {
                if vod.date > previous.date
                    || (vod.date == previous.date && vod.video_id <= previous.video_id)
                {
                    return Err(message("VOD 資料未依 canonical order 排列"));
                }
            }
            previous_vod = Some(vod);
            if vod.performances.is_empty() || vod.performances.len() > 50_000 {
                return Err(message("每一筆 VOD 必須包含有效且有限的歌曲資料"));
            }

            let mut previous_performance: Option<&VodPerformance> = None;
            for performance in &vod.performances {
                performance_count += 1;
                if performance.performance_id.is_empty() || performance.song_id.is_empty() {
                    return Err(message("歌曲資料的識別碼不可為空"));
                }
                if !performance_ids.insert(performance.performance_id.as_str()) {
                    return Err(message("VOD 資料包含重複的 performance ID"));
                }
                validate_display_text(&performance.title, "歌曲名稱")?;
                validate_nullable_display_text(
                    performance.original_artist.0.as_deref(),
                    "原唱名稱",
                )?;
                if performance.start_seconds > MAX_SAFE_INTEGER
                    || performance.end_seconds > MAX_SAFE_INTEGER
                    || performance.end_seconds <= performance.start_seconds
                {
                    return Err(message("歌曲時間範圍不正確"));
                }
                if let Some(previous) = previous_performance {
                    if performance.start_seconds < previous.start_seconds
                        || (performance.start_seconds == previous.start_seconds
                            && performance.performance_id <= previous.performance_id)
                    {
                        return Err(message("歌曲資料未依 canonical order 排列"));
                    }
                }
                previous_performance = Some(performance);
            }
        }
    }

    let actual = VodCounts {
        streamers: snapshot.streamers.len() as u64,
        vods: vod_count,
        performances: performance_count,
    };
    if actual != manifest.counts {
        return Err(message("VOD snapshot 的資料筆數與索引不一致"));
    }
    validate_count_limits(&actual)
}

fn validate_slug(value: &str) -> AppResult<()> {
    let valid = (1..=50).contains(&value.len())
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        });
    if !valid {
        return Err(message("VTuber slug 格式不正確"));
    }
    Ok(())
}

fn validate_video_id(value: &str) -> AppResult<()> {
    let valid = value.len() == 11
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    if !valid {
        return Err(message("YouTube video ID 格式不正確"));
    }
    Ok(())
}

fn validate_date(value: &str) -> AppResult<()> {
    if value.len() != 10 || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
        return Err(message(format!("VOD 日期格式不正確：{value}")));
    }
    Ok(())
}

fn validate_display_text(value: &str, label: &str) -> AppResult<()> {
    if value.is_empty() || has_surrounding_contract_whitespace(value) {
        return Err(message(format!("{label}不可為空或含首尾空白")));
    }
    if value.nfc().ne(value.chars()) {
        return Err(message(format!("{label}不是 Unicode NFC")));
    }
    Ok(())
}

fn validate_nullable_display_text(value: Option<&str>, label: &str) -> AppResult<()> {
    if let Some(value) = value {
        validate_display_text(value, label)?;
    }
    Ok(())
}

fn has_surrounding_contract_whitespace(value: &str) -> bool {
    let is_contract_whitespace = |character: char| {
        matches!(
            character,
            '\u{0009}'..='\u{000d}'
                | '\u{0020}'
                | '\u{00a0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
        )
    };
    value.chars().next().is_some_and(is_contract_whitespace)
        || value
            .chars()
            .next_back()
            .is_some_and(is_contract_whitespace)
}

fn validate_social_links(links: &BTreeMap<String, Value>) -> AppResult<()> {
    let providers: [(&str, &[&str]); 5] = [
        ("youtube", &["youtube.com", "m.youtube.com", "youtu.be"]),
        ("twitter", &["twitter.com", "mobile.twitter.com", "x.com"]),
        ("facebook", &["facebook.com", "m.facebook.com", "fb.com"]),
        ("instagram", &["instagram.com"]),
        ("twitch", &["twitch.tv"]),
    ];
    for (provider, hosts) in providers {
        let Some(value) = links.get(provider) else {
            continue;
        };
        let url = value
            .as_str()
            .ok_or_else(|| message(format!("{provider} 社群連結必須是字串")))?;
        let parsed = validate_safe_url(url, hosts, provider)?;
        if provider == "youtube" && parsed.path() == "/redirect" {
            return Err(message("YouTube redirect URL 不受支援"));
        }
    }
    Ok(())
}

fn validate_safe_url(value: &str, allowed_hosts: &[&str], label: &str) -> AppResult<Url> {
    let url = Url::parse(value).map_err(|_| message(format!("{label} URL 格式不正確")))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let normalized_host = host.strip_prefix("www.").unwrap_or(&host);
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !allowed_hosts.contains(&normalized_host)
    {
        return Err(message(format!("{label} URL 不在允許清單中")));
    }
    Ok(url)
}

fn is_lower_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character))
}

fn is_exact_utc_milliseconds(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 24
        && bytes.get(4) == Some(&b'-')
        && bytes.get(7) == Some(&b'-')
        && bytes.get(10) == Some(&b'T')
        && bytes.get(13) == Some(&b':')
        && bytes.get(16) == Some(&b':')
        && bytes.get(19) == Some(&b'.')
        && bytes.get(23) == Some(&b'Z')
        && DateTime::parse_from_rfc3339(value).is_ok()
}

fn to_library_dataset(manifest: VodManifest, snapshot: VodSnapshot) -> VodLibraryDataset {
    VodLibraryDataset {
        schema_version: snapshot.schema_version,
        published_at: manifest.published_at,
        sha256: manifest.sha256,
        counts: manifest.counts,
        streamers: snapshot
            .streamers
            .into_iter()
            .map(|streamer| VodLibraryStreamer {
                slug: streamer.slug,
                display_name: streamer.display_name,
                group: streamer.group.0,
                vods: streamer
                    .vods
                    .into_iter()
                    .map(|vod| VodLibraryVod {
                        title: vod.title,
                        date: vod.date,
                        video_id: vod.video_id,
                        performances: vod
                            .performances
                            .into_iter()
                            .map(|performance| VodLibraryPerformance {
                                performance_id: performance.performance_id,
                                title: performance.title,
                                original_artist: performance.original_artist.0,
                                start_seconds: performance.start_seconds,
                                end_seconds: performance.end_seconds,
                            })
                            .collect(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn message(value: impl Into<String>) -> AppError {
    AppError::Message(value.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> VodManifest {
        VodManifest {
            schema_version: "1.0.0".into(),
            snapshot_url: format!("{SNAPSHOT_PREFIX}{}.json", "a".repeat(64)),
            sha256: "a".repeat(64),
            published_at: "2026-07-11T20:04:22.682Z".into(),
            uncompressed_bytes: 1024,
            counts: VodCounts {
                streamers: 1,
                vods: 1,
                performances: 1,
            },
        }
    }

    fn snapshot() -> VodSnapshot {
        VodSnapshot {
            schema_version: "1.0.0".into(),
            streamers: vec![VodStreamer {
                slug: "nagi".into(),
                display_name: "涅默 Nemesis".into(),
                youtube_channel_id: "channel-id".into(),
                avatar_url: RequiredNullableString(None),
                group: RequiredNullableString(Some("極深空計畫".into())),
                social_links: BTreeMap::new(),
                vods: vec![Vod {
                    title: "測試歌回".into(),
                    date: "2026-07-10".into(),
                    video_id: "mLSIBfQWqB4".into(),
                    performances: vec![VodPerformance {
                        performance_id: "p-1".into(),
                        song_id: "song-1".into(),
                        title: "測試歌曲".into(),
                        original_artist: RequiredNullableString(Some("測試歌手".into())),
                        start_seconds: 10,
                        end_seconds: 20,
                    }],
                }],
            }],
        }
    }

    #[test]
    fn accepts_a_valid_v1_dataset() {
        let manifest = manifest();
        assert!(validate_manifest(&manifest).is_ok());
        assert!(validate_snapshot(&snapshot(), &manifest).is_ok());
    }

    #[test]
    fn rejects_untrusted_snapshot_urls_and_schema_versions() {
        let mut manifest = manifest();
        manifest.snapshot_url = "https://example.com/snapshot.json".into();
        assert!(validate_manifest(&manifest).is_err());
        assert!(validate_schema_version("2.0.0").is_err());
        assert!(validate_schema_version("1.01.0").is_err());
    }

    #[test]
    fn rejects_invalid_counts_order_and_ranges() {
        let manifest = manifest();
        let mut invalid_range = snapshot();
        invalid_range.streamers[0].vods[0].performances[0].end_seconds = 10;
        assert!(validate_snapshot(&invalid_range, &manifest).is_err());

        let mut out_of_order = snapshot();
        out_of_order.streamers[0].vods[0]
            .performances
            .push(VodPerformance {
                performance_id: "p-0".into(),
                song_id: "song-2".into(),
                title: "另一首歌".into(),
                original_artist: RequiredNullableString(None),
                start_seconds: 5,
                end_seconds: 9,
            });
        assert!(validate_snapshot(&out_of_order, &manifest).is_err());
    }

    #[test]
    fn rejects_unsafe_urls_and_non_normalized_display_text() {
        assert!(validate_safe_url(
            "https://example.com/avatar.png",
            &["yt3.ggpht.com"],
            "avatar"
        )
        .is_err());
        assert!(validate_display_text(" spaced ", "title").is_err());
        assert!(validate_display_text("e\u{301}", "title").is_err());
    }
}
