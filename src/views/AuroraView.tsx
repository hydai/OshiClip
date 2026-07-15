import { useCallback, useState } from "react";
import {
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";

export const AURORA_URL = "https://aurora.oshi.tw/";

export const AURORA_FRAME_SANDBOX = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
].join(" ");

type FrameStatus = "loading" | "ready" | "error";

export function AuroraView() {
  const [frameKey, setFrameKey] = useState(0);
  const [status, setStatus] = useState<FrameStatus>("loading");

  const reload = useCallback(() => {
    setStatus("loading");
    setFrameKey((current) => current + 1);
  }, []);

  return (
    <section className="aurora-view" aria-labelledby="aurora-title">
      <header className="aurora-toolbar">
        <div className="aurora-toolbar-copy">
          <span className="aurora-toolbar-icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div>
            <div className="aurora-title-row">
              <h1 id="aurora-title">Aurora 時間軸投稿</h1>
              <span className={`aurora-connection ${status}`}>
                <i />
                {status === "loading"
                  ? "正在連線"
                  : status === "ready"
                    ? "已連線"
                    : "載入失敗"}
              </span>
            </div>
            <p>直接標記 VOD 歌曲時間，草稿會由 Aurora 保存在這台裝置。</p>
          </div>
        </div>

        <div className="aurora-toolbar-actions">
          <button type="button" onClick={reload} disabled={status === "loading"}>
            <RefreshCw className={status === "loading" ? "spin" : undefined} size={16} />
            重新載入
          </button>
          <a href={AURORA_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} />
            瀏覽器開啟
          </a>
        </div>
      </header>

      <div className="aurora-frame-shell">
        {status !== "ready" && (
          <div className={`aurora-frame-state ${status}`} role="status" aria-live="polite">
            {status === "loading" ? (
              <LoaderCircle className="spin" size={24} />
            ) : (
              <Sparkles size={24} />
            )}
            <strong>{status === "loading" ? "正在載入 Aurora…" : "無法載入 Aurora"}</strong>
            <span>
              {status === "loading"
                ? "載入完成後即可選擇 VTuber、建立時間軸並送出審核。"
                : "請確認網路連線，或使用上方按鈕在瀏覽器開啟。"}
            </span>
          </div>
        )}
        <iframe
          key={frameKey}
          className="aurora-frame"
          src={AURORA_URL}
          title="Aurora 社群時間戳工具"
          sandbox={AURORA_FRAME_SANDBOX}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      </div>
    </section>
  );
}
