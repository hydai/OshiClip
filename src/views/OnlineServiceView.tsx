import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  ListMusic,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { openExternalUrl } from "../lib/desktop";

export type OnlineServiceId = "nova" | "aurora" | "prism";

export interface OnlineService {
  id: OnlineServiceId;
  name: string;
  navDetail: string;
  statusLabel: string;
  title: string;
  description: string;
  loadingDescription: string;
  url: string;
  frameTitle: string;
  icon: LucideIcon;
}

export const ONLINE_SERVICES: readonly OnlineService[] = [
  {
    id: "nova",
    name: "Nova",
    navDetail: "提名",
    statusLabel: "Nova VTuber 提名",
    title: "Nova VTuber 提名",
    description: "提名尚未收錄的 VTuber，送出頻道資訊供資料庫審核。",
    loadingDescription: "載入完成後即可填寫 VTuber 與頻道資料並送出提名。",
    url: "https://nova.oshi.tw/",
    frameTitle: "Nova VTuber 提名工具",
    icon: UserPlus,
  },
  {
    id: "aurora",
    name: "Aurora",
    navDetail: "投稿",
    statusLabel: "Aurora VOD 投稿",
    title: "Aurora VOD 投稿",
    description: "加入新的歌回 VOD、標記歌曲時間並送出資料庫審核。",
    loadingDescription: "載入完成後即可選擇 VTuber、建立時間軸並提交 VOD。",
    url: "https://aurora.oshi.tw/",
    frameTitle: "Aurora VOD 投稿工具",
    icon: ListMusic,
  },
  {
    id: "prism",
    name: "Prism",
    navDetail: "播放",
    statusLabel: "Prism 歌回播放器",
    title: "Prism 歌回播放器",
    description: "瀏覽 VTuber 歌回、播放歌曲並管理收藏與播放清單。",
    loadingDescription: "載入完成後即可選擇 VTuber，開始探索與播放歌回歌曲。",
    url: "https://prism.oshi.tw/",
    frameTitle: "Prism VTuber 歌回播放器",
    icon: PlayCircle,
  },
];

export const ONLINE_SERVICE_FRAME_SANDBOX = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
].join(" ");

type FrameStatus = "loading" | "ready" | "error";

interface OnlineServiceViewProps {
  service: OnlineService;
  notify: (message: string, tone?: "info" | "success" | "error") => void;
}

export function OnlineServiceView({ service, notify }: OnlineServiceViewProps) {
  const [frameKey, setFrameKey] = useState(0);
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [openingInBrowser, setOpeningInBrowser] = useState(false);
  const Icon = service.icon;
  const titleId = `${service.id}-service-title`;

  const reload = useCallback(() => {
    setStatus("loading");
    setFrameKey((current) => current + 1);
  }, []);

  const openInBrowser = useCallback(async () => {
    if (openingInBrowser) return;
    setOpeningInBrowser(true);
    try {
      await openExternalUrl(service.url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notify(`無法在瀏覽器開啟 ${service.name}：${detail}`, "error");
    } finally {
      setOpeningInBrowser(false);
    }
  }, [notify, openingInBrowser, service.name, service.url]);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "error" : current));
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [frameKey, status]);

  return (
    <section
      className={`online-service-view service-${service.id}`}
      aria-labelledby={titleId}
    >
      <header className="online-service-toolbar">
        <div className="online-service-toolbar-copy">
          <span className="online-service-toolbar-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <div>
            <div className="online-service-title-row">
              <h1 id={titleId}>{service.title}</h1>
              <span className={`online-service-connection ${status}`}>
                <i />
                {status === "loading"
                  ? "正在連線"
                  : status === "ready"
                    ? "已連線"
                    : "載入失敗"}
              </span>
            </div>
            <p>{service.description}</p>
          </div>
        </div>

        <div className="online-service-toolbar-actions">
          <button type="button" onClick={reload}>
            <RefreshCw className={status === "loading" ? "spin" : undefined} size={16} />
            重新載入
          </button>
          <button type="button" onClick={openInBrowser} disabled={openingInBrowser}>
            {openingInBrowser ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ExternalLink size={16} />
            )}
            {openingInBrowser ? "正在開啟" : "瀏覽器開啟"}
          </button>
        </div>
      </header>

      <div className="online-service-frame-shell">
        {status !== "ready" && (
          <div
            className={`online-service-frame-state ${status}`}
            role="status"
            aria-live="polite"
          >
            {status === "loading" ? (
              <LoaderCircle className="spin" size={24} />
            ) : (
              <Icon size={24} />
            )}
            <strong>
              {status === "loading"
                ? `正在載入 ${service.name}…`
                : `無法載入 ${service.name}`}
            </strong>
            <span>
              {status === "loading"
                ? service.loadingDescription
                : "請確認網路連線，或使用上方按鈕在瀏覽器開啟。"}
            </span>
          </div>
        )}
        <iframe
          key={frameKey}
          className="online-service-frame"
          src={service.url}
          title={service.frameTitle}
          sandbox={ONLINE_SERVICE_FRAME_SANDBOX}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      </div>
    </section>
  );
}
