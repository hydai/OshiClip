use crate::{
    error::{AppError, AppResult},
    models::{DownloadSpec, FormatPreset},
};
use std::{ffi::OsString, path::Path};
use url::Url;

const MAX_CLIP_SECONDS: u64 = 6 * 60 * 60;
pub(crate) const DOWNLOAD_STARTED_MARKER: &str = "OSHICLIP_DOWNLOAD_STARTED";

pub fn build_download_args(
    spec: &DownloadSpec,
    ffmpeg_directory: &Path,
    deno_binary: &Path,
    output_directory: &Path,
) -> AppResult<Vec<OsString>> {
    validate_spec(spec)?;

    let format = match spec.format_preset {
        FormatPreset::Avc1Mp4a => "bv[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]",
        FormatPreset::Best => "bv+ba/b",
    };
    let output_template = output_directory.join(format!("{}.%(ext)s", spec.output_name.trim()));
    let section = format!("*{}-{}", spec.start_seconds, spec.end_seconds);

    Ok(vec![
        "--ignore-config".into(),
        "--verbose".into(),
        "--no-playlist".into(),
        "--color".into(),
        "never".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--socket-timeout".into(),
        "20".into(),
        "--retries".into(),
        "3".into(),
        "--fragment-retries".into(),
        "3".into(),
        "--extractor-retries".into(),
        "3".into(),
        "--format".into(),
        format.into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--remux-video".into(),
        "mp4".into(),
        "--no-force-keyframes-at-cuts".into(),
        "--download-sections".into(),
        section.into(),
        "--no-overwrites".into(),
        "--ffmpeg-location".into(),
        ffmpeg_directory.as_os_str().to_owned(),
        "--no-js-runtimes".into(),
        "--js-runtimes".into(),
        format!("deno:{}", deno_binary.to_string_lossy()).into(),
        "--output".into(),
        output_template.into_os_string(),
        "--newline".into(),
        "--progress".into(),
        "--progress-template".into(),
        "download:PROGRESS %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s"
            .into(),
        "--downloader-args".into(),
        "ffmpeg_o:-progress pipe:1 -nostats".into(),
        "--print".into(),
        format!("before_dl:{DOWNLOAD_STARTED_MARKER}").into(),
        "--print".into(),
        "after_move:FINAL %(filepath)s".into(),
        spec.url.trim().into(),
    ])
}

pub fn validate_spec(spec: &DownloadSpec) -> AppResult<()> {
    validate_youtube_url(&spec.url)?;
    if spec.end_seconds <= spec.start_seconds {
        return Err(AppError::Message("結束時間必須晚於開始時間".into()));
    }
    if spec.end_seconds - spec.start_seconds > MAX_CLIP_SECONDS {
        return Err(AppError::Message("單一片段最長為 6 小時".into()));
    }
    validate_output_name(&spec.output_name)
}

fn validate_youtube_url(value: &str) -> AppResult<()> {
    let url =
        Url::parse(value.trim()).map_err(|_| AppError::Message("YouTube 網址格式不正確".into()))?;
    if url.scheme() != "https" {
        return Err(AppError::Message("YouTube 網址必須使用 HTTPS".into()));
    }
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.");
    let video_id = match host {
        "youtu.be" => url
            .path_segments()
            .and_then(|mut segments| segments.next())
            .map(str::to_owned),
        "youtube.com" | "m.youtube.com" | "music.youtube.com" => url
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.into_owned()),
        _ => None,
    };
    let valid = video_id.as_deref().is_some_and(|id| {
        (6..=20).contains(&id.len())
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
            })
    });
    if !valid {
        return Err(AppError::Message("僅支援有效的 YouTube 影片網址".into()));
    }
    Ok(())
}

fn validate_output_name(value: &str) -> AppResult<()> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(AppError::Message("輸出檔名需為 1 到 120 個字元".into()));
    }
    if name == "."
        || name == ".."
        || name.contains("..")
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err(AppError::Message("輸出檔名含有不允許的字元".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> DownloadSpec {
        DownloadSpec {
            url: "https://www.youtube.com/watch?v=mLSIBfQWqB4".into(),
            start_seconds: 4799,
            end_seconds: 4993,
            output_name: "nagi-4799-4993".into(),
            format_preset: FormatPreset::Avc1Mp4a,
        }
    }

    #[test]
    fn builds_argument_array_without_shell_quoting() {
        let args = build_download_args(
            &spec(),
            Path::new("/tools/ffmpeg"),
            Path::new("/tools/deno"),
            Path::new("/clips"),
        )
        .unwrap();
        assert!(args.contains(&OsString::from("*4799-4993")));
        assert!(args.contains(&OsString::from("/tools/ffmpeg")));
        assert!(args.contains(&OsString::from("deno:/tools/deno")));
        assert!(args.contains(&OsString::from("--progress")));
        assert!(args.contains(&OsString::from("--verbose")));
        assert!(args
            .windows(2)
            .any(|pair| pair == [OsString::from("--encoding"), OsString::from("utf-8")]));
        assert!(args.contains(&OsString::from("--socket-timeout")));
        assert!(args.contains(&OsString::from("--extractor-retries")));
        assert!(args.contains(&OsString::from("never")));
        assert!(args.contains(&OsString::from("ffmpeg_o:-progress pipe:1 -nostats")));
        assert!(args.windows(2).any(|pair| pair
            == [
                OsString::from("--print"),
                OsString::from(format!("before_dl:{DOWNLOAD_STARTED_MARKER}")),
            ]));
        assert_eq!(
            args.last(),
            Some(&OsString::from(
                "https://www.youtube.com/watch?v=mLSIBfQWqB4"
            ))
        );
    }

    #[test]
    fn rejects_path_traversal_and_non_youtube_urls() {
        let mut invalid = spec();
        invalid.output_name = "../secret".into();
        assert!(validate_spec(&invalid).is_err());
        invalid.output_name = "clip".into();
        invalid.url = "https://example.com/watch?v=mLSIBfQWqB4".into();
        assert!(validate_spec(&invalid).is_err());
    }
}
