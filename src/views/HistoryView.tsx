import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock3,
  ExternalLink,
  FileQuestion,
  FileVideo2,
  FolderOpen,
  HardDrive,
  History,
  LoaderCircle,
  Link2,
  RefreshCw,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  clearDownloadHistory,
  getDownloadHistory,
  onDesktopEvent,
  removeDownloadHistory,
  revealHistoryOutput,
} from "../lib/desktop";
import {
  downloadPhaseDescription,
  downloadPhaseLabel,
  formatElapsedTime,
} from "../lib/downloadActivity";
import {
  formatHistoryBytes,
  formatHistoryDate,
  historyFileName,
} from "../lib/history";
import { formatDuration, formatTimecode } from "../lib/time";
import type { ActiveDownloadStatus, DownloadHistoryEntry } from "../types";

interface HistoryViewProps {
  activeDownload: ActiveDownloadStatus | null;
  onReuse: (entry: DownloadHistoryEntry) => void;
  onStartDownload: () => void;
  onViewActive: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}

export function HistoryView({
  activeDownload,
  onReuse,
  onStartDownload,
  onViewActive,
  notify,
}: HistoryViewProps) {
  const [entries, setEntries] = useState<DownloadHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await getDownloadHistory());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    let dispose: () => void = () => undefined;
    void onDesktopEvent("download-done", () => {
      void loadHistory();
    }).then((unlisten) => {
      if (active) dispose = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      dispose();
    };
  }, [loadHistory]);

  const availableCount = entries.filter((entry) => entry.fileExists).length;
  const totalBytes = useMemo(
    () => entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    [entries],
  );

  async function handleReveal(entry: DownloadHistoryEntry) {
    setPendingId(entry.id);
    try {
      await revealHistoryOutput(entry.id);
    } catch (revealError) {
      notify(
        revealError instanceof Error ? revealError.message : String(revealError),
        "error",
      );
      await loadHistory();
    } finally {
      setPendingId(null);
    }
  }

  async function handleRemove(entry: DownloadHistoryEntry) {
    setPendingId(entry.id);
    try {
      await removeDownloadHistory(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      notify("已移除下載紀錄；影片檔案仍保留在原處。", "success");
    } catch (removeError) {
      notify(
        removeError instanceof Error ? removeError.message : String(removeError),
        "error",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function handleClear() {
    if (
      !window.confirm(
        "確定要清除全部下載紀錄嗎？這不會刪除已下載的影片檔案。",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await clearDownloadHistory();
      setEntries([]);
      notify("下載紀錄已清空；影片檔案沒有被刪除。", "success");
    } catch (clearError) {
      notify(
        clearError instanceof Error ? clearError.message : String(clearError),
        "error",
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="history-view">
      <div className="page-heading history-heading">
        <div>
          <p className="eyebrow"><History size={14} /> DOWNLOAD HISTORY</p>
          <h1>收藏過的片段，都在這裡。</h1>
          <p>快速找到輸出檔案，或帶回原本的區間設定再剪一次。</p>
        </div>
        <div className="history-heading-mark" aria-hidden="true">
          <History size={31} />
          <span />
        </div>
      </div>

      <div className="history-summary">
        <div>
          <span className="summary-icon violet">
            {activeDownload ? <LoaderCircle className="spin" size={18} /> : <History size={18} />}
          </span>
          <p><small>進行中 / 完成</small><strong>{activeDownload ? 1 : 0} / {entries.length}</strong></p>
        </div>
        <div>
          <span className="summary-icon mint"><HardDrive size={18} /></span>
          <p><small>檔案仍在</small><strong>{availableCount}</strong></p>
        </div>
        <div>
          <span className="summary-icon coral"><FileVideo2 size={18} /></span>
          <p><small>紀錄總大小</small><strong>{formatHistoryBytes(totalBytes)}</strong></p>
        </div>
        <div className="history-toolbar">
          <button
            type="button"
            className="button light"
            onClick={() => void loadHistory()}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={15} /> 重新整理
          </button>
          <button
            type="button"
            className="button danger"
            onClick={() => void handleClear()}
            disabled={!entries.length || clearing}
          >
            {clearing ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            清空紀錄
          </button>
        </div>
      </div>

      {loading && entries.length === 0 && !activeDownload ? (
        <div className="history-state-card">
          <LoaderCircle className="spin" size={26} />
          <strong>正在讀取下載紀錄…</strong>
        </div>
      ) : error && !activeDownload ? (
        <div className="history-state-card error">
          <AlertCircle size={27} />
          <strong>無法讀取下載紀錄</strong>
          <p>{error}</p>
          <button className="button light" type="button" onClick={() => void loadHistory()}>
            再試一次
          </button>
        </div>
      ) : entries.length === 0 && !activeDownload ? (
        <div className="history-state-card empty">
          <span><Scissors size={29} /></span>
          <strong>還沒有完成的片段</strong>
          <p>成功下載的片段會自動出現在這裡。</p>
          <button className="button primary" type="button" onClick={onStartDownload}>
            開始下載第一段
          </button>
        </div>
      ) : (
        <div className="history-list" aria-busy={loading}>
          {activeDownload && (() => {
            const duration = Math.max(
              0,
              activeDownload.endSeconds - activeDownload.startSeconds,
            );
            const fileName = historyFileName(
              activeDownload.outputPath,
              activeDownload.outputName,
            );
            const hasMeasuredProgress =
              activeDownload.percent !== null && activeDownload.percent > 0;
            return (
              <article className="history-card active" key={activeDownload.jobId} aria-live="polite">
                <div className="history-file-mark active">
                  <LoaderCircle className="spin" size={24} />
                </div>
                <div className="history-card-main">
                  <div className="history-title-row">
                    <div>
                      <h2 title={fileName}>{fileName}</h2>
                      <span className="file-status active">
                        {downloadPhaseLabel(activeDownload.phase)}
                      </span>
                    </div>
                    <time dateTime={activeDownload.startedAt}>
                      {formatHistoryDate(activeDownload.startedAt)} 開始
                    </time>
                  </div>
                  <p className="history-active-description">
                    {downloadPhaseDescription(activeDownload.phase)}
                  </p>
                  <div className="history-metadata">
                    <span><Clock3 size={13} /> {formatTimecode(activeDownload.startSeconds)} → {formatTimecode(activeDownload.endSeconds)}</span>
                    <span><Scissors size={13} /> {formatDuration(duration)}</span>
                    <span><FileVideo2 size={13} /> {activeDownload.formatPreset === "avc1_mp4a" ? "相容 MP4" : "最佳品質"}</span>
                    <span><HardDrive size={13} /> {activeDownload.downloadedBytes > 0 ? `已寫入 ${formatHistoryBytes(activeDownload.downloadedBytes)}` : "正在建立檔案"}</span>
                    <span><Clock3 size={13} /> 已執行 {formatElapsedTime(activeDownload.elapsedSeconds)}</span>
                  </div>
                  <div className="history-active-progress">
                    <div className={hasMeasuredProgress ? "" : "indeterminate"}>
                      <span style={{ width: `${activeDownload.percent ?? 0}%` }} />
                    </div>
                    <strong>{hasMeasuredProgress ? `${Math.round(activeDownload.percent!)}%` : "處理中"}</strong>
                  </div>
                  <div className="history-source" title={activeDownload.url}>
                    <Link2 size={13} />
                    <span>{activeDownload.url}</span>
                  </div>
                  <p className="history-path" title={activeDownload.outputPath}>{activeDownload.outputPath}</p>
                </div>
                <div className="history-actions active">
                  <button className="button mint" type="button" onClick={onViewActive}>
                    查看任務
                  </button>
                </div>
              </article>
            );
          })()}
          {entries.map((entry) => {
            const duration = Math.max(0, entry.endSeconds - entry.startSeconds);
            const fileName = historyFileName(entry.outputPath, entry.outputName);
            const isPending = pendingId === entry.id;
            return (
              <article
                className={entry.fileExists ? "history-card" : "history-card missing"}
                key={entry.id}
              >
                <div className="history-file-mark">
                  {entry.fileExists ? <FileVideo2 size={24} /> : <FileQuestion size={24} />}
                </div>
                <div className="history-card-main">
                  <div className="history-title-row">
                    <div>
                      <h2 title={fileName}>{fileName}</h2>
                      <span className={entry.fileExists ? "file-status available" : "file-status missing"}>
                        {entry.fileExists ? "檔案可用" : "檔案已移動或刪除"}
                      </span>
                    </div>
                    <time dateTime={entry.completedAt}>{formatHistoryDate(entry.completedAt)}</time>
                  </div>
                  <div className="history-metadata">
                    <span><Clock3 size={13} /> {formatTimecode(entry.startSeconds)} → {formatTimecode(entry.endSeconds)}</span>
                    <span><Scissors size={13} /> {formatDuration(duration)}</span>
                    <span><FileVideo2 size={13} /> {entry.formatPreset === "avc1_mp4a" ? "相容 MP4" : "最佳品質"}</span>
                    <span><HardDrive size={13} /> {formatHistoryBytes(entry.sizeBytes)}</span>
                  </div>
                  <div className="history-source" title={entry.url}>
                    <Link2 size={13} />
                    <span>{entry.url}</span>
                  </div>
                  <p className="history-path" title={entry.outputPath}>{entry.outputPath}</p>
                </div>
                <div className="history-actions">
                  <button
                    className="button mint"
                    type="button"
                    disabled={!entry.fileExists || isPending}
                    onClick={() => void handleReveal(entry)}
                  >
                    <FolderOpen size={15} /> 顯示檔案 <ExternalLink size={12} />
                  </button>
                  <button
                    className="button light"
                    type="button"
                    disabled={isPending}
                    onClick={() => onReuse(entry)}
                  >
                    <RotateCcw size={15} /> 套用設定
                  </button>
                  <button
                    className="history-delete"
                    type="button"
                    disabled={isPending}
                    aria-label={`移除 ${fileName} 的下載紀錄`}
                    title="只移除紀錄，不刪除檔案"
                    onClick={() => void handleRemove(entry)}
                  >
                    {isPending ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
