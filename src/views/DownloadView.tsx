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
  buildDefaultOutputName,
  formatDuration,
  formatTimecode,
  isSupportedYouTubeUrl,
  parseTimecode,
  sanitizeOutputName,
} from "../lib/time";
import type { AppStatus, DownloadPrefill, DownloadSpec, FormatPreset } from "../types";

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
  outputName: "nagi-favorite-clip",
};

export function DownloadView({
  status,
  prefill,
  onOpenTools,
  onStatusChange,
  notify,
}: DownloadViewProps) {
  const initial = "__TAURI_INTERNALS__" in window ? null : PREVIEW_PREFILL;
  const [url, setUrl] = useState(initial?.url ?? "");
  const [startTime, setStartTime] = useState(formatTimecode(initial?.startSeconds ?? 0));
  const [endTime, setEndTime] = useState(formatTimecode(initial?.endSeconds ?? 90));
  const [outputName, setOutputName] = useState(initial?.outputName ?? "");
  const [formatPreset, setFormatPreset] = useState<FormatPreset>("avc1_mp4a");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [outputTouched, setOutputTouched] = useState(Boolean(initial?.outputName));
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [jobId, setJobId] = useState<string | null>(status.activeJobId);
  const jobIdRef = useRef<string | null>(status.activeJobId);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<string | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill) return;
    setUrl(prefill.url);
    setStartTime(formatTimecode(prefill.startSeconds));
    setEndTime(formatTimecode(prefill.endSeconds));
    setOutputName(
      prefill.outputName ??
        buildDefaultOutputName(prefill.url, prefill.startSeconds, prefill.endSeconds),
    );
    setOutputTouched(Boolean(prefill.outputName));
  }, [prefill]);

  useEffect(() => {
    const start = parseTimecode(startTime);
    const end = parseTimecode(endTime);
    if (!outputTouched && isSupportedYouTubeUrl(url) && start !== null && end !== null && end > start) {
      setOutputName(buildDefaultOutputName(url, start, end));
    }
  }, [url, startTime, endTime, outputTouched]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    void Promise.all([
      onDesktopEvent("download-progress", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        jobIdRef.current = event.jobId;
        setJobId(event.jobId);
        setDownloadState("running");
        setProgress(Math.max(0, Math.min(100, event.percent)));
        setSpeed(event.speed);
        setEta(event.eta);
      }),
      onDesktopEvent("download-log", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        setLogs((current) => [...current.slice(-199), event.line]);
      }),
      onDesktopEvent("download-done", (event) => {
        if (jobIdRef.current && event.jobId !== jobIdRef.current) return;
        setDownloadState("completed");
        setProgress(100);
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
    ]).then((unlisteners) => disposers.push(...unlisteners));
    return () => disposers.forEach((dispose) => dispose());
  }, [notify, onStatusChange]);

  const startSeconds = parseTimecode(startTime);
  const endSeconds = parseTimecode(endTime);
  const duration =
    startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
      ? endSeconds - startSeconds
      : null;
  const toolsReady = Boolean(
    status.tools["yt-dlp"].selected && status.tools.ffmpeg.selected && status.tools.deno.selected,
  );

  const formError = useMemo(() => {
    if (!url.trim()) return null;
    if (!isSupportedYouTubeUrl(url)) return "請輸入有效的 YouTube 影片網址";
    if (startSeconds === null || endSeconds === null) return "時間格式需為 HH:MM:SS";
    if (endSeconds <= startSeconds) return "結束時間必須晚於開始時間";
    if (duration && duration > 21_600) return "單一片段最長為 6 小時";
    if (!sanitizeOutputName(outputName)) return "請輸入輸出檔名";
    return null;
  }, [duration, endSeconds, outputName, startSeconds, url]);

  const canSubmit =
    toolsReady &&
    Boolean(url.trim()) &&
    !formError &&
    downloadState !== "starting" &&
    downloadState !== "running";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || startSeconds === null || endSeconds === null) return;
    const spec: DownloadSpec = {
      url: url.trim(),
      startSeconds,
      endSeconds,
      outputName: sanitizeOutputName(outputName),
      formatPreset,
    };
    setDownloadState("starting");
    setProgress(0);
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
    running: "正在下載片段",
    completed: "片段已完成",
    error: "任務未完成",
  }[downloadState];

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
            <strong>第一次使用，先準備下載工具</strong>
            <span>安裝由應用程式管理的 yt-dlp、ffmpeg 與 Deno，全程不需要終端機。</span>
          </div>
          <button type="button" className="button light" onClick={onOpenTools}>
            開始設定 <ArrowRight size={16} />
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

          <div className="timeline-preview" aria-label="片段區間預覽">
            <div className="timeline-track"><span className="timeline-selection" /></div>
            <div className="timeline-labels">
              <span>{startSeconds === null ? "--:--:--" : formatTimecode(startSeconds)}</span>
              <span>選取片段</span>
              <span>{endSeconds === null ? "--:--:--" : formatTimecode(endSeconds)}</span>
            </div>
          </div>

          <label className="field full-width">
            <span>輸出檔名</span>
            <div className="input-shell filename-input">
              <FileVideo2 size={18} />
              <input
                value={outputName}
                onChange={(event) => {
                  setOutputTouched(true);
                  setOutputName(event.target.value);
                }}
                placeholder="oshiclip-videoId-start-end"
                maxLength={120}
              />
              <span className="extension">.mp4</span>
            </div>
          </label>

          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            <span><Gauge size={16} /> 進階格式</span>
            <span>{formatPreset === "avc1_mp4a" ? "相容 MP4" : "最佳品質"} {advancedOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
          </button>

          {advancedOpen && (
            <div className="preset-options">
              <label className={formatPreset === "avc1_mp4a" ? "preset selected" : "preset"}>
                <input
                  type="radio"
                  name="preset"
                  value="avc1_mp4a"
                  checked={formatPreset === "avc1_mp4a"}
                  onChange={() => setFormatPreset("avc1_mp4a")}
                />
                <span><strong>相容 MP4</strong><small>avc1 + mp4a，適合大多數播放器</small></span>
                <Check size={15} />
              </label>
              <label className={formatPreset === "best" ? "preset selected" : "preset"}>
                <input
                  type="radio"
                  name="preset"
                  value="best"
                  checked={formatPreset === "best"}
                  onChange={() => setFormatPreset("best")}
                />
                <span><strong>最佳品質</strong><small>由 yt-dlp 選擇最高品質來源</small></span>
                <Check size={15} />
              </label>
            </div>
          )}

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
            <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
              <div>
                {downloadState === "completed" ? <Check size={30} /> : <strong>{Math.round(progress)}<small>%</small></strong>}
              </div>
            </div>
            <div className="progress-copy">
              <span>{downloadState === "idle" ? "準備好時，按下開始" : stateLabel}</span>
              <strong>{downloadState === "completed" ? "你的片段已經準備好了" : downloadState === "error" ? errorMessage : "下載與剪輯會在這裡顯示"}</strong>
              {downloadState === "running" && (
                <div className="transfer-stats">
                  <span><Gauge size={14} /> {speed ?? "計算中"}</span>
                  <span><Clock3 size={14} /> {eta ? `剩餘 ${eta}` : "計算中"}</span>
                </div>
              )}
            </div>
          </div>

          <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>

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
