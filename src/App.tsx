import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  Download,
  FolderDown,
  History,
  Settings2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { DownloadView, type DownloadPrefill } from "./views/DownloadView";
import { ToolsView } from "./views/ToolsView";
import {
  getAppStatus,
  isDesktopRuntime,
  subscribeToDeepLinks,
} from "./lib/desktop";
import { sanitizeOutputName } from "./lib/time";
import type { AppStatus } from "./types";

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

function parseDeepLink(raw: string): DownloadPrefill | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "oshi-vods:" || url.hostname !== "download") return null;
    const videoId = url.searchParams.get("v") ?? "";
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    const name = sanitizeOutputName(url.searchParams.get("name") ?? "");
    if (!/^[\w-]{6,20}$/.test(videoId)) return null;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      return null;
    }
    return {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      startSeconds: start,
      endSeconds: end,
      outputName: name || undefined,
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [view, setView] = useState<ViewName>("download");
  const [status, setStatus] = useState<AppStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [prefill, setPrefill] = useState<DownloadPrefill | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

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

  useEffect(() => {
    let unlisten: () => void = () => {};
    void subscribeToDeepLinks((urls) => {
      const next = urls.map(parseDeepLink).find(Boolean);
      if (!next) {
        notify("無法讀取這個 VODS Oshi 連結，請確認參數是否完整。", "error");
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
  const navItems = useMemo(
    () => [
      { id: "download" as const, label: "下載片段", icon: Download },
      { id: "tools" as const, label: "工具管理", icon: Wrench },
      { id: "history" as const, label: "下載紀錄", icon: History, disabled: true },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block" aria-label="VODS Oshi">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>VODS</strong>
            <span>OSHI</span>
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
                onClick={() => !item.disabled && setView(item.id)}
                disabled={item.disabled}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.disabled && <small>即將推出</small>}
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
            <span>v0.1.2</span>
          </div>
          <CircleHelp size={17} />
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
        </div>
      </main>

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
