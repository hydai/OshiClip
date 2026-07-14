import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FolderDown,
  History,
  RefreshCw,
  Settings2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { UpdateDialog } from "./components/UpdateDialog";
import { DownloadView } from "./views/DownloadView";
import { HistoryView } from "./views/HistoryView";
import { ToolsView } from "./views/ToolsView";
import {
  applicationVersion,
  canCheckForAppUpdate,
  checkForAppUpdate,
  getAppStatus,
  isDesktopRuntime,
  subscribeToDeepLinks,
} from "./lib/desktop";
import { parseDownloadDeepLink } from "./lib/deepLink";
import { historyEntryToPrefill } from "./lib/history";
import type {
  AppStatus,
  AvailableAppUpdate,
  DownloadHistoryEntry,
  DownloadPrefill,
} from "./types";

type ViewName = "download" | "tools" | "history";
type Toast = { id: number; tone: "success" | "error" | "info"; message: string };

const EMPTY_STATUS: AppStatus = {
  tools: {
    "yt-dlp": { selected: null, installed: [] },
    ffmpeg: { selected: null, installed: [] },
    deno: { selected: null, installed: [] },
  },
  settings: { outputDirectory: "" },
  activeJobId: null,
};

export default function App() {
  const [view, setView] = useState<ViewName>("download");
  const [status, setStatus] = useState<AppStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState<DownloadPrefill | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [availableAppUpdate, setAvailableAppUpdate] =
    useState<AvailableAppUpdate | null>(null);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const updateCheckStarted = useRef(false);
  const updateCheckInFlight = useRef(false);

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getAppStatus());
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const checkForUpdates = useCallback(
    async (manual: boolean) => {
      if (!canCheckForAppUpdate || updateCheckInFlight.current) return;
      updateCheckInFlight.current = true;
      setCheckingForUpdate(true);
      try {
        const update = await checkForAppUpdate();
        if (update) {
          setAvailableAppUpdate(update);
        } else if (manual) {
          notify(`目前已是最新版本（v${applicationVersion}）。`, "success");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (manual) notify(`無法檢查更新：${message}`, "error");
        else console.warn("Automatic update check failed", error);
      } finally {
        updateCheckInFlight.current = false;
        setCheckingForUpdate(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    if (updateCheckStarted.current || !canCheckForAppUpdate) return;
    updateCheckStarted.current = true;
    void checkForUpdates(false);
  }, [checkForUpdates]);

  useEffect(() => {
    let unlisten: () => void = () => {};
    void subscribeToDeepLinks((urls) => {
      const next = urls.map(parseDownloadDeepLink).find(Boolean);
      if (!next) {
        notify("無法讀取這個 OshiClip 連結，請確認參數是否完整。", "error");
        return;
      }
      setPrefill(next);
      setView("download");
      notify("已從 vods.oshi.tw 帶入片段，確認內容後即可開始。", "success");
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten();
  }, [notify]);

  const toolsReady = Boolean(
    status.tools["yt-dlp"].selected && status.tools.ffmpeg.selected && status.tools.deno.selected,
  );

  const dismissAppUpdate = useCallback(() => {
    if (availableAppUpdate) {
      void availableAppUpdate.close().catch(console.warn);
    }
    setAvailableAppUpdate(null);
  }, [availableAppUpdate]);

  const reuseHistoryEntry = useCallback(
    (entry: DownloadHistoryEntry) => {
      setPrefill(historyEntryToPrefill(entry));
      setView("download");
      notify("已帶入這筆紀錄的來源與時間區間，確認檔名後即可開始。", "success");
    },
    [notify],
  );

  const navItems = useMemo(
    () => [
      { id: "download" as const, label: "下載片段", icon: Download },
      { id: "tools" as const, label: "工具管理", icon: Wrench },
      { id: "history" as const, label: "下載紀錄", icon: History },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block" aria-label="OshiClip">
          <div className="brand-mark" aria-hidden="true">
            <img src="/oshiclip-logo.png" alt="" />
          </div>
          <div>
            <strong>OSHI</strong>
            <span>CLIP</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要導覽">
          <p className="nav-eyebrow">工作區</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setView(item.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <FolderDown size={17} />
          </div>
          <div>
            <span>輸出位置</span>
            <strong title={status.settings.outputDirectory}>
              {status.settings.outputDirectory
                ? status.settings.outputDirectory.split(/[\\/]/).filter(Boolean).at(-1)
                : "尚未設定"}
            </strong>
          </div>
          <button type="button" aria-label="設定輸出位置" onClick={() => setView("tools")}>
            <Settings2 size={16} />
          </button>
        </div>

        <div className="sidebar-footer">
          <span className="avatar">推</span>
          <div>
            <strong>本機模式</strong>
            <span>v{applicationVersion}</span>
          </div>
          <button
            type="button"
            aria-label="檢查 OshiClip 更新"
            title={canCheckForAppUpdate ? "檢查更新" : "桌面版才支援自動更新"}
            disabled={!canCheckForAppUpdate || checkingForUpdate}
            onClick={() => void checkForUpdates(true)}
          >
            <RefreshCw className={checkingForUpdate ? "spin" : undefined} size={16} />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="runtime-label">
            <span className="runtime-dot" />
            {isDesktopRuntime ? "Desktop App" : "互動預覽模式"}
          </div>
          <div className={toolsReady ? "readiness ready" : "readiness warning"}>
            {toolsReady ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}
            <span>{loading ? "正在檢查工具…" : toolsReady ? "下載工具已就緒" : "需要安裝下載工具"}</span>
          </div>
        </header>

        <div className="view-container">
          {view === "download" && (
            <DownloadView
              status={status}
              prefill={prefill}
              onOpenTools={() => setView("tools")}
              onStatusChange={refreshStatus}
              notify={notify}
            />
          )}
          {view === "tools" && (
            <ToolsView status={status} refreshStatus={refreshStatus} notify={notify} />
          )}
          {view === "history" && (
            <HistoryView
              onReuse={reuseHistoryEntry}
              onStartDownload={() => setView("download")}
              notify={notify}
            />
          )}
        </div>
      </main>

      {availableAppUpdate && (
        <UpdateDialog
          key={availableAppUpdate.version}
          update={availableAppUpdate}
          onDismiss={dismissAppUpdate}
        />
      )}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast ${toast.tone}`} key={toast.id}>
            <span />
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
