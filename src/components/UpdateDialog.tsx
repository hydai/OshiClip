import { useEffect, useState } from "react";
import {
  Download,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  INITIAL_APP_UPDATE_PROGRESS,
  formatUpdateBytes,
} from "../lib/appUpdate";
import { relaunchApplication } from "../lib/desktop";
import type { AppUpdateProgress, AvailableAppUpdate } from "../types";

type UpdatePhase =
  | "available"
  | "downloading"
  | "restarting"
  | "error"
  | "restart-error";

interface UpdateDialogProps {
  update: AvailableAppUpdate;
  onDismiss: () => void;
}

function formatReleaseDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function progressLabel(progress: AppUpdateProgress): string {
  if (progress.stage === "installing") return "正在驗證並安裝更新…";
  if (progress.totalBytes) {
    return `${formatUpdateBytes(progress.downloadedBytes)} / ${formatUpdateBytes(progress.totalBytes)}`;
  }
  if (progress.downloadedBytes) {
    return `已下載 ${formatUpdateBytes(progress.downloadedBytes)}`;
  }
  return "正在準備下載…";
}

export function UpdateDialog({ update, onDismiss }: UpdateDialogProps) {
  const [phase, setPhase] = useState<UpdatePhase>("available");
  const [progress, setProgress] = useState<AppUpdateProgress>(
    INITIAL_APP_UPDATE_PROGRESS,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canDismiss = phase === "available" || phase === "error";
  const releaseDate = formatReleaseDate(update.date);

  useEffect(() => {
    if (!canDismiss) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canDismiss, onDismiss]);

  const installUpdate = async () => {
    setPhase("downloading");
    setProgress(INITIAL_APP_UPDATE_PROGRESS);
    setErrorMessage(null);
    try {
      await update.downloadAndInstall(setProgress);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setPhase("error");
      return;
    }

    setPhase("restarting");
    try {
      await relaunchApplication();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setPhase("restart-error");
    }
  };

  const restartApplication = async () => {
    setPhase("restarting");
    setErrorMessage(null);
    try {
      await relaunchApplication();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setPhase("restart-error");
    }
  };

  const isWorking = phase === "downloading" || phase === "restarting";

  return (
    <div className="update-backdrop">
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={isWorking}
        aria-labelledby="update-title"
        aria-describedby="update-description"
      >
        {canDismiss && (
          <button
            type="button"
            className="update-close"
            aria-label="稍後再更新"
            onClick={onDismiss}
          >
            <X size={17} />
          </button>
        )}

        <div className="update-icon" aria-hidden="true">
          {phase === "error" || phase === "restart-error" ? (
            <TriangleAlert size={25} />
          ) : isWorking ? (
            <LoaderCircle className="spin" size={25} />
          ) : (
            <Download size={25} />
          )}
        </div>

        <div className="update-heading">
          <span>OSHIClip Update</span>
          <h2 id="update-title">
            {phase === "restarting" || phase === "restart-error"
              ? "更新已安裝"
              : `OshiClip ${update.version} 已推出`}
          </h2>
          <p id="update-description">
            {phase === "restarting"
              ? "正在重新啟動以套用新版本…"
              : phase === "restart-error"
                ? "更新已安裝，但應用程式無法自動重新啟動。"
                : `目前版本 ${update.currentVersion}${releaseDate ? `・發布於 ${releaseDate}` : ""}`}
          </p>
        </div>

        {phase === "downloading" ? (
          <div className="update-progress" aria-live="polite">
            <div>
              <strong>
                {progress.stage === "installing" ? "安裝中" : "下載更新"}
              </strong>
              <span>
                {progress.percent === null ? "—" : `${progress.percent}%`}
              </span>
            </div>
            <div
              className={`update-progress-track${progress.percent === null ? " indeterminate" : ""}`}
            >
              <span
                style={{
                  width:
                    progress.percent === null ? undefined : `${progress.percent}%`,
                }}
              />
            </div>
            <small>{progressLabel(progress)}</small>
          </div>
        ) : (
          phase !== "restarting" &&
          phase !== "restart-error" && (
            <div className="update-notes">
              <strong>版本說明</strong>
              <p>{update.body || "這個版本沒有提供更新說明。"}</p>
            </div>
          )
        )}

        {errorMessage && (
          <div className="update-error" role="alert">
            <TriangleAlert size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="update-trust">
          <ShieldCheck size={15} />
          <span>更新檔會先通過 OshiClip 簽章驗證才安裝。</span>
        </div>

        <div className="update-actions">
          {canDismiss && (
            <button type="button" className="button light" onClick={onDismiss}>
              稍後提醒
            </button>
          )}
          {phase === "available" || phase === "error" ? (
            <button
              type="button"
              className="button primary"
              autoFocus
              onClick={() => void installUpdate()}
            >
              {phase === "error" ? <RefreshCw size={15} /> : <Download size={15} />}
              {phase === "error" ? "重試更新" : "下載並安裝"}
            </button>
          ) : phase === "restart-error" ? (
            <button
              type="button"
              className="button primary"
              autoFocus
              onClick={() => void restartApplication()}
            >
              <RefreshCw size={15} />
              重新啟動
            </button>
          ) : (
            <button type="button" className="button primary" disabled>
              <LoaderCircle className="spin" size={15} />
              {phase === "restarting" ? "正在重新啟動" : "更新處理中"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
