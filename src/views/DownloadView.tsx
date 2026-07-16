import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileVideo2,
  FolderOpen,
  Gauge,
  HardDrive,
  Link2,
  ListVideo,
  LoaderCircle,
  Play,
  Scissors,
  Square,
  TerminalSquare,
  WandSparkles,
} from "lucide-react";
import {
  cancelDownload,
  onDesktopEvent,
  revealOutput,
  startDownload,
} from "../lib/desktop";
import {
  downloadPhaseDescription,
  downloadPhaseLabel,
  formatElapsedTime,
} from "../lib/downloadActivity";
import {
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TEMPLATE_MAX_LENGTH,
  FILENAME_TEMPLATE_TAGS,
  loadFilenameTemplate,
  resolveFilenameTemplate,
  saveFilenameTemplate,
} from "../lib/filenameTemplate";
import { formatHistoryBytes } from "../lib/history";
import {
  buildDefaultOutputName,
  formatDuration,
  formatTimecode,
  isSupportedYouTubeUrl,
  parseTimecode,
  sanitizeOutputName,
} from "../lib/time";
import type {
  AppStatus,
  DownloadFilenameMetadata,
  DownloadPhase,
  DownloadPrefill,
  DownloadSpec,
  FormatPreset,
} from "../types";

type DownloadState = "idle" | "starting" | "running" | "completed" | "error";

interface DownloadViewProps {
  status: AppStatus;
  prefill: DownloadPrefill | null;
  onOpenTools: () => void;
  onStatusChange: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}

const PREVIEW_PREFILL: DownloadPrefill = {
  url: "https://www.youtube.com/watch?v=mLSIBfQWqB4",
  startSeconds: 4799,
  endSeconds: 4993,
  filenameMetadata: {
    streamer: "涅默 Nemesis",
    songTitle: "六等星の夜",
    artist: "Aimer",
    vodTitle: "深夜歌回：把喜歡的歌唱給你聽",
    vodDate: "2026-07-10",
  },
};

const FORMAT_PRESET_OPTIONS: ReadonlyArray<{
  value: FormatPreset;
  label: string;
  description: string;
}> = [
  {
    value: "avc1_mp4a",
    label: "相容 MP4",
    description: "avc1 + mp4a，適合大多數播放器",
  },
  {
    value: "best",
    label: "最佳品質",
    description: "由 yt-dlp 選擇最高品質來源",
  },
];

export function DownloadView({
  status,
  prefill,
  onOpenTools,
  onStatusChange,
  notify,
}: DownloadViewProps) {
  const initial =
    status.activeDownload ??
    ("__TAURI_INTERNALS__" in window ? null : PREVIEW_PREFILL);
  const initialFilenameMetadata =
    initial && "filenameMetadata" in initial
      ? initial.filenameMetadata ?? null
      : null;
  const [url, setUrl] = useState(initial?.url ?? "");
  const [startTime, setStartTime] = useState(formatTimecode(initial?.startSeconds ?? 0));
  const [endTime, setEndTime] = useState(formatTimecode(initial?.endSeconds ?? 90));
  const [filenameMetadata, setFilenameMetadata] =
    useState<DownloadFilenameMetadata | null>(initialFilenameMetadata);
  const [outputName, setOutputName] = useState(
    initialFilenameMetadata
      ? loadFilenameTemplate()
      : initial?.outputName ?? "",
  );
  const [formatPreset, setFormatPreset] = useState<FormatPreset>(
    status.activeDownload?.formatPreset ?? "avc1_mp4a",
  );
  const [outputTouched, setOutputTouched] = useState(
    Boolean(initial?.outputName || initialFilenameMetadata),
  );
  const [downloadState, setDownloadState] = useState<DownloadState>(
    status.activeDownload ? "running" : "idle",
  );
  const [jobId, setJobId] = useState<string | null>(status.activeJobId);
  const jobIdRef = useRef<string | null>(status.activeJobId);
  const filenameInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<DownloadPhase>(
    status.activeDownload?.phase ?? "preparing",
  );
  const [progress, setProgress] = useState<number | null>(
    status.activeDownload?.percent ?? null,
  );
  const [speed, setSpeed] = useState<string | null>(status.activeDownload?.speed ?? null);
  const [eta, setEta] = useState<string | null>(status.activeDownload?.eta ?? null);
  const [downloadedBytes, setDownloadedBytes] = useState(
    status.activeDownload?.downloadedBytes ?? 0,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(
    status.activeDownload?.elapsedSeconds ?? 0,
  );
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill || status.activeDownload) return;
    setUrl(prefill.url);
    setStartTime(formatTimecode(prefill.startSeconds));
    setEndTime(formatTimecode(prefill.endSeconds));
    const metadata = prefill.filenameMetadata ?? null;
    setFilenameMetadata(metadata);
    if (metadata) {
      setOutputName(loadFilenameTemplate());
      setOutputTouched(true);
    } else {
      setOutputName(
        prefill.outputName ??
          buildDefaultOutputName(prefill.url, prefill.startSeconds, prefill.endSeconds),
      );
      setOutputTouched(Boolean(prefill.outputName));
    }
  }, [prefill, status.activeDownload]);

  useEffect(() => {
    const active = status.activeDownload;
    if (!active) return;
    const isNewJob = jobIdRef.current !== active.jobId;
    jobIdRef.current = active.jobId;
    setJobId(active.jobId);
    setDownloadState("running");
    setPhase(active.phase);
    setProgress(active.percent);
    setSpeed(active.speed);
    setEta(active.eta);
    setDownloadedBytes(active.downloadedBytes);
    setElapsedSeconds(active.elapsedSeconds);
    setResultPath(active.outputPath);
    if (isNewJob) {
      setUrl(active.url);
      setStartTime(formatTimecode(active.startSeconds));
      setEndTime(formatTimecode(active.endSeconds));
      setFilenameMetadata(null);
      setOutputName(active.outputName);
      setOutputTouched(true);
      setFormatPreset(active.formatPreset);
    }
  }, [status.activeDownload]);

  useEffect(() => {
    const start = parseTimecode(startTime);
    const end = parseTimecode(endTime);
    if (
      !filenameMetadata &&
      !outputTouched &&
      isSupportedYouTubeUrl(url) &&
      start !== null &&
      end !== null &&
      end > start
    ) {
      setOutputName(buildDefaultOutputName(url, start, end));
    }
  }, [url, startTime, endTime, filenameMetadata, outputTouched]);

  useEffect(() => {
    let active = true;
    const disposers: Array<() => void> = [];
    void Promise.all([
      onDesktopEvent("download-progress", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        jobIdRef.current = event.jobId;
        setJobId(event.jobId);
        setDownloadState("running");
        setPhase(event.phase);
        setProgress(
          event.percent === null
            ? null
            : Math.max(0, Math.min(100, event.percent)),
        );
        setSpeed(event.speed);
        setEta(event.eta);
        setDownloadedBytes(event.downloadedBytes);
        setElapsedSeconds(event.elapsedSeconds);
        setResultPath(event.outputPath);
      }),
      onDesktopEvent("download-log", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        setLogs((current) => [...current.slice(-199), event.line]);
      }),
      onDesktopEvent("download-done", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        setDownloadState("completed");
        setProgress(100);
        setPhase("finalizing");
        setResultPath(event.outputPath);
        jobIdRef.current = null;
        setJobId(null);
        notify("片段下載完成。", "success");
        void onStatusChange();
      }),
      onDesktopEvent("download-error", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        setDownloadState("error");
        setErrorMessage(event.message);
        jobIdRef.current = null;
        setJobId(null);
        notify(event.message, "error");
        void onStatusChange();
      }),
    ]).then((unlisteners) => {
      if (active) disposers.push(...unlisteners);
      else unlisteners.forEach((dispose) => dispose());
    });
    return () => {
      active = false;
      disposers.forEach((dispose) => dispose());
    };
  }, [notify, onStatusChange]);

  const startSeconds = parseTimecode(startTime);
  const endSeconds = parseTimecode(endTime);
  const duration =
    startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
      ? endSeconds - startSeconds
      : null;
  const resolvedFilename = useMemo(() => {
    if (!filenameMetadata) {
      return {
        outputName: sanitizeOutputName(outputName),
        unknownTags: [] as string[],
        hasMalformedTag: false,
      };
    }
    return resolveFilenameTemplate(outputName, {
      metadata: filenameMetadata,
      url,
      startSeconds: startSeconds ?? 0,
      endSeconds: endSeconds ?? 0,
    });
  }, [endSeconds, filenameMetadata, outputName, startSeconds, url]);
  const actualOutputName = resolvedFilename.outputName;
  const literalContainsTagSyntax = !filenameMetadata && /[<>]/.test(outputName);
  const toolsReady = Boolean(
    status.tools["yt-dlp"].selected &&
      !status.tools["yt-dlp"].requiresRepair &&
      status.tools.ffmpeg.selected &&
      !status.tools.ffmpeg.requiresRepair &&
      status.tools.deno.selected &&
      !status.tools.deno.requiresRepair,
  );
  const windowsYtdlpNeedsRepair = status.tools["yt-dlp"].requiresRepair;

  const formError = useMemo(() => {
    if (!url.trim()) return null;
    if (!isSupportedYouTubeUrl(url)) return "請輸入有效的 YouTube 影片網址";
    if (startSeconds === null || endSeconds === null) return "時間格式需為 HH:MM:SS";
    if (endSeconds <= startSeconds) return "結束時間必須晚於開始時間";
    if (duration && duration > 21_600) return "單一片段最長為 6 小時";
    if (resolvedFilename.unknownTags.length) {
      return `不支援的檔名標籤：${resolvedFilename.unknownTags.join("、")}`;
    }
    if (resolvedFilename.hasMalformedTag) return "檔名標籤格式不完整";
    if (literalContainsTagSyntax) return "檔名標籤需由歌回資料庫帶入資料後使用";
    if (!actualOutputName) return "請輸入輸出檔名";
    return null;
  }, [
    actualOutputName,
    duration,
    endSeconds,
    literalContainsTagSyntax,
    resolvedFilename,
    startSeconds,
    url,
  ]);

  const canSubmit =
    toolsReady &&
    Boolean(url.trim()) &&
    !formError &&
    downloadState !== "starting" &&
    downloadState !== "running";

  function persistTemplate(template: string) {
    if (!filenameMetadata) return;
    const resolved = resolveFilenameTemplate(template, {
      metadata: filenameMetadata,
      url,
      startSeconds: startSeconds ?? 0,
      endSeconds: endSeconds ?? 0,
    });
    if (
      template.trim() &&
      !resolved.unknownTags.length &&
      !resolved.hasMalformedTag
    ) {
      saveFilenameTemplate(template);
    }
  }

  function insertFilenameTag(token: string) {
    const input = filenameInputRef.current;
    const selectionStart = input?.selectionStart ?? outputName.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const next = `${outputName.slice(0, selectionStart)}${token}${outputName.slice(selectionEnd)}`
      .slice(0, FILENAME_TEMPLATE_MAX_LENGTH);
    const cursor = Math.min(
      selectionStart + token.length,
      FILENAME_TEMPLATE_MAX_LENGTH,
    );
    setOutputTouched(true);
    setOutputName(next);
    persistTemplate(next);
    window.requestAnimationFrame(() => {
      filenameInputRef.current?.focus();
      filenameInputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function resetFilenameTemplate() {
    setOutputTouched(true);
    setOutputName(DEFAULT_FILENAME_TEMPLATE);
    saveFilenameTemplate(DEFAULT_FILENAME_TEMPLATE);
    window.requestAnimationFrame(() => filenameInputRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || startSeconds === null || endSeconds === null) return;
    const spec: DownloadSpec = {
      url: url.trim(),
      startSeconds,
      endSeconds,
      outputName: actualOutputName,
      formatPreset,
    };
    setDownloadState("starting");
    setPhase("preparing");
    setProgress(null);
    setSpeed(null);
    setEta(null);
    setDownloadedBytes(0);
    setElapsedSeconds(0);
    setLogs([]);
    setResultPath(null);
    setErrorMessage(null);
    try {
      const job = await startDownload(spec);
      jobIdRef.current = job.jobId;
      setJobId(job.jobId);
      setResultPath(job.outputPath);
      setDownloadState("running");
      await onStatusChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDownloadState("error");
      setErrorMessage(message);
      notify(message, "error");
    }
  }

  async function handleCancel() {
    if (!jobId) return;
    try {
      await cancelDownload(jobId);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  const stateLabel = {
    idle: "等待開始",
    starting: "正在準備",
    running: downloadPhaseLabel(phase),
    completed: "片段已完成",
    error: "任務未完成",
  }[downloadState];
  const isWorking = downloadState === "running" || downloadState === "starting";
  const hasMeasuredProgress = progress !== null && progress > 0;
  const displayedProgress = progress ?? 0;
  const progressDescription =
    downloadState === "completed"
      ? "你的片段已經準備好了"
      : downloadState === "error"
        ? errorMessage
        : downloadState === "running"
          ? downloadPhaseDescription(phase)
          : downloadState === "starting"
            ? downloadPhaseDescription("preparing")
            : "下載與剪輯會在這裡顯示";

  return (
    <section className="download-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Scissors size={14} /> CLIP DOWNLOADER</p>
          <h1>剪下你想收藏的那一段。</h1>
          <p>貼上直播網址、選好時間，剩下的交給 OshiClip。</p>
        </div>
        <div className="heading-ornament" aria-hidden="true">
          <div className="ornament-disc"><Play size={24} fill="currentColor" /></div>
          <span className="wave wave-one" />
          <span className="wave wave-two" />
          <span className="wave wave-three" />
        </div>
      </div>

      {!toolsReady && (
        <div className="setup-banner">
          <div className="setup-icon"><WandSparkles size={21} /></div>
          <div>
            <strong>{windowsYtdlpNeedsRepair ? "修復 Windows 下載元件" : "第一次使用，先準備下載工具"}</strong>
            <span>
              {windowsYtdlpNeedsRepair
                ? "目前的單檔版 yt-dlp 可能無法啟動；修復後會換成官方完整套件。"
                : "安裝由應用程式管理的 yt-dlp、ffmpeg 與 Deno，全程不需要終端機。"}
            </span>
          </div>
          <button type="button" className="button light" onClick={onOpenTools}>
            {windowsYtdlpNeedsRepair ? "前往修復" : "開始設定"} <ArrowRight size={16} />
          </button>
        </div>
      )}

      <div className="download-grid">
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="card-heading compact">
            <div>
              <span className="step-number">01</span>
              <div><strong>片段資訊</strong><small>設定來源與精準區間</small></div>
            </div>
            {duration !== null && <span className="duration-badge"><Clock3 size={14} /> {formatDuration(duration)}</span>}
          </div>

          <label className="field full-width">
            <span>YouTube 網址</span>
            <div className={formError?.includes("YouTube") ? "input-shell invalid" : "input-shell"}>
              <Link2 size={18} />
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </label>

          <div className="time-row">
            <label className="field">
              <span>開始時間</span>
              <div className="input-shell time-input">
                <span className="time-dot start" />
                <input
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  onBlur={() => startSeconds !== null && setStartTime(formatTimecode(startSeconds))}
                  inputMode="numeric"
                  aria-label="開始時間，格式為時分秒"
                />
              </div>
            </label>
            <div className="time-connector" aria-hidden="true"><span /><ArrowRight size={16} /></div>
            <label className="field">
              <span>結束時間</span>
              <div className="input-shell time-input">
                <span className="time-dot end" />
                <input
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  onBlur={() => endSeconds !== null && setEndTime(formatTimecode(endSeconds))}
                  inputMode="numeric"
                  aria-label="結束時間，格式為時分秒"
                />
              </div>
            </label>
          </div>

          <label className="field full-width">
            <span>{filenameMetadata ? "輸出檔名格式" : "輸出檔名"}</span>
            <div className="input-shell filename-input">
              <FileVideo2 size={18} />
              <input
                ref={filenameInputRef}
                value={outputName}
                onChange={(event) => {
                  setOutputTouched(true);
                  setOutputName(event.target.value);
                }}
                onBlur={() => persistTemplate(outputName)}
                placeholder={
                  filenameMetadata
                    ? DEFAULT_FILENAME_TEMPLATE
                    : "oshiclip-videoId-start-end"
                }
                maxLength={
                  filenameMetadata ? FILENAME_TEMPLATE_MAX_LENGTH : 120
                }
              />
              <span className="extension">.mp4</span>
            </div>
          </label>

          {filenameMetadata && (
            <div className="filename-template-panel">
              <div className="filename-template-tags" aria-label="可用的檔名標籤">
                <span>插入標籤</span>
                {FILENAME_TEMPLATE_TAGS.map((tag) => (
                  <button
                    type="button"
                    key={tag.token}
                    title={`插入 ${tag.label}`}
                    onClick={() => insertFilenameTag(tag.token)}
                  >
                    {tag.token}
                  </button>
                ))}
                <button
                  type="button"
                  className="reset"
                  onClick={resetFilenameTemplate}
                >
                  <WandSparkles size={12} /> 預設格式
                </button>
              </div>
              <div
                className={
                  resolvedFilename.unknownTags.length ||
                  resolvedFilename.hasMalformedTag ||
                  !actualOutputName
                    ? "filename-template-preview invalid"
                    : "filename-template-preview"
                }
                aria-live="polite"
              >
                <span>實際檔名</span>
                <strong title={actualOutputName ? `${actualOutputName}.mp4` : undefined}>
                  {actualOutputName
                    ? `${actualOutputName}.mp4`
                    : "等待有效的檔名格式"}
                </strong>
              </div>
              <small>格式會保存在本機，從下一首歌帶入時自動沿用。</small>
            </div>
          )}

          <div className="format-picker">
            <label className="format-picker-label" htmlFor="format-preset">
              <Gauge size={16} /> 影片規格
            </label>
            <div className="format-select-input">
              <select
                id="format-preset"
                value={formatPreset}
                onChange={(event) =>
                  setFormatPreset(event.currentTarget.value as FormatPreset)
                }
              >
                {FORMAT_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} — {option.description}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </div>

          {formError && url.trim() && (
            <div className="inline-error"><AlertCircle size={15} /> {formError}</div>
          )}

          <button className="button primary submit-button" type="submit" disabled={!canSubmit}>
            {downloadState === "starting" ? (
              <><LoaderCircle className="spin" size={18} /> 正在準備…</>
            ) : (
              <><Scissors size={18} /> 開始下載片段 <ArrowRight size={17} /></>
            )}
          </button>
          <p className="form-footnote">開始後才會連線至 YouTube；不會覆蓋同名檔案。</p>
        </form>

        <aside className={`progress-card state-${downloadState}`}>
          <div className="card-heading compact">
            <div>
              <span className="step-number inverse">02</span>
              <div><strong>任務狀態</strong><small>即時進度與輸出結果</small></div>
            </div>
            <span className="status-pill"><span /> {stateLabel}</span>
          </div>

          <div className="progress-visual">
            <div
              className={isWorking && !hasMeasuredProgress ? "progress-ring indeterminate" : "progress-ring"}
              style={{ "--progress": `${displayedProgress * 3.6}deg` } as React.CSSProperties}
            >
              <div>
                {downloadState === "completed" ? (
                  <Check size={30} />
                ) : isWorking && !hasMeasuredProgress ? (
                  <LoaderCircle className="spin" size={28} />
                ) : (
                  <strong>{Math.round(displayedProgress)}<small>%</small></strong>
                )}
              </div>
            </div>
            <div className="progress-copy">
              <span>{downloadState === "idle" ? "準備好時，按下開始" : stateLabel}</span>
              <strong>{progressDescription}</strong>
              {isWorking && (
                <div className="transfer-stats">
                  <span>
                    <HardDrive size={14} />
                    {downloadedBytes > 0 ? `已寫入 ${formatHistoryBytes(downloadedBytes)}` : "正在建立連線"}
                  </span>
                  {speed && <span><Gauge size={14} /> {speed.endsWith("x") ? `處理速度 ${speed}` : speed}</span>}
                  <span><Clock3 size={14} /> {eta ? `約剩 ${eta}` : `已執行 ${formatElapsedTime(elapsedSeconds)}`}</span>
                </div>
              )}
            </div>
          </div>

          <div className={isWorking && !hasMeasuredProgress ? "progress-bar indeterminate" : "progress-bar"}>
            <span style={{ width: `${displayedProgress}%` }} />
          </div>

          {downloadState === "idle" && (
            <div className="empty-steps">
              <div><span>1</span><p><strong>下載來源串流</strong><small>由 yt-dlp 精準取得區間</small></p></div>
              <div><span>2</span><p><strong>合併成 MP4</strong><small>ffmpeg 無損 remux</small></p></div>
              <div><span>3</span><p><strong>儲存到資料夾</strong><small>{status.settings.outputDirectory || "尚未設定"}</small></p></div>
            </div>
          )}

          {(downloadState === "running" || downloadState === "starting") && (
            <button className="button danger full" type="button" onClick={handleCancel} disabled={!jobId}>
              <Square size={14} fill="currentColor" /> 取消下載
            </button>
          )}

          {downloadState === "completed" && resultPath && (
            <div className="completion-actions">
              <div className="result-file"><FileVideo2 size={19} /><span><strong>{resultPath.split(/[\\/]/).at(-1)}</strong><small>已安全儲存</small></span></div>
              <button className="button mint full" type="button" onClick={() => void revealOutput(resultPath)}>
                <FolderOpen size={17} /> 在檔案總管中顯示 <ExternalLink size={14} />
              </button>
            </div>
          )}

          {downloadState === "error" && (
            <button className="button light full" type="button" onClick={() => setDownloadState("idle")}>
              返回並重新檢查
            </button>
          )}

          <button
            className="log-toggle"
            type="button"
            onClick={() => setLogsOpen((open) => !open)}
            aria-expanded={logsOpen}
          >
            <span><TerminalSquare size={15} /> 執行日誌</span>
            <span>{logs.length} 行 {logsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
          </button>
          {logsOpen && (
            <pre className="log-panel">{logs.length ? logs.join("\n") : "尚無日誌。開始任務後，完整輸出會保留在這裡。"}</pre>
          )}

          <div className="progress-footer">
            <ListVideo size={14} /> 首版同一時間只執行一個下載任務
          </div>
        </aside>
      </div>
    </section>
  );
}
