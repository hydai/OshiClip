import { useEffect, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle2,
  ChevronRight,
  DownloadCloud,
  FolderCog,
  FolderOpen,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  chooseOutputDirectory,
  installTool,
  listAvailableVersions,
  onDesktopEvent,
  removeToolVersion,
  setOutputDirectory,
  switchToolVersion,
} from "../lib/desktop";
import type {
  AppStatus,
  AvailableRelease,
  ToolInstallProgressEvent,
  ToolName,
  ToolState,
} from "../types";

interface ToolsViewProps {
  status: AppStatus;
  refreshStatus: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}

const TOOL_INFO: Record<ToolName, { title: string; description: string; mark: string }> = {
  "yt-dlp": {
    title: "yt-dlp",
    description: "負責取得 YouTube 影片與片段資料",
    mark: "YT",
  },
  ffmpeg: {
    title: "ffmpeg",
    description: "負責合併影像與音訊為 MP4",
    mark: "FF",
  },
  deno: {
    title: "Deno",
    description: "安全執行 YouTube 必要的 JavaScript challenge",
    mark: "DN",
  },
};

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
}

function ToolCard({
  tool,
  state,
  available,
  checking,
  installing,
  installProgress,
  onCheck,
  onInstall,
  onSwitch,
  onRemove,
}: {
  tool: ToolName;
  state: ToolState;
  available: AvailableRelease | null;
  checking: boolean;
  installing: boolean;
  installProgress: ToolInstallProgressEvent | null;
  onCheck: () => void;
  onInstall: () => void;
  onSwitch: (version: string) => void;
  onRemove: (version: string) => void;
}) {
  const info = TOOL_INFO[tool];
  const current = state.installed.find((item) => item.version === state.selected);
  const hasUpdate = Boolean(available && available.version !== state.selected);
  const stageLabel = {
    downloading: "正在下載",
    verifying: "正在驗證 SHA256",
    extracting: "正在解壓縮",
    installing: "正在完成安裝",
  }[installProgress?.stage ?? "downloading"];

  return (
    <article className="tool-card">
      <div className={`tool-mark ${tool === "ffmpeg" ? "violet" : tool === "deno" ? "mint" : "coral"}`}>{info.mark}</div>
      <div className="tool-main">
        <div className="tool-title-row">
          <div><h3>{info.title}</h3><p>{info.description}</p></div>
          {current ? (
            <span className="installed-badge"><CheckCircle2 size={14} /> 已就緒</span>
          ) : (
            <span className="missing-badge">尚未安裝</span>
          )}
        </div>

        <div className="tool-current">
          <span>目前使用版本</span>
          <strong>{state.selected ?? "—"}</strong>
          {current && <small>{formatBytes(current.sizeBytes)} · {new Date(current.installedAt).toLocaleDateString("zh-TW")}</small>}
        </div>

        {installing && installProgress && (
          <div className="install-progress">
            <div><span>{stageLabel}</span><strong>{installProgress.percent}%</strong></div>
            <div className="progress-bar slim"><span style={{ width: `${installProgress.percent}%` }} /></div>
          </div>
        )}

        <div className="tool-actions">
          <button className="button light" type="button" onClick={onCheck} disabled={checking || installing}>
            {checking ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            檢查更新
          </button>
          {(!current || hasUpdate) && (
            <button className="button primary small" type="button" onClick={onInstall} disabled={installing}>
              {installing ? <LoaderCircle className="spin" size={16} /> : <DownloadCloud size={16} />}
              {current ? `安裝 ${available?.version ?? "最新版"}` : "安裝最新版"}
            </button>
          )}
          {current && !hasUpdate && available && <span className="up-to-date"><Check size={14} /> 已是最新版本</span>}
        </div>

        {state.installed.length > 0 && (
          <details className="version-list">
            <summary>已安裝版本 <span>{state.installed.length}</span><ChevronRight size={15} /></summary>
            <div>
              {state.installed.map((version) => (
                <div className="version-row" key={version.version}>
                  <span><strong>{version.version}</strong><small>{formatBytes(version.sizeBytes)}</small></span>
                  {state.selected === version.version ? (
                    <span className="current-label"><Check size={13} /> 使用中</span>
                  ) : (
                    <>
                      <button type="button" onClick={() => onSwitch(version.version)}><RotateCcw size={14} /> 切換</button>
                      <button className="delete" type="button" onClick={() => onRemove(version.version)} aria-label={`移除 ${version.version}`}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

export function ToolsView({ status, refreshStatus, notify }: ToolsViewProps) {
  const [available, setAvailable] = useState<Partial<Record<ToolName, AvailableRelease>>>({});
  const [checking, setChecking] = useState<ToolName | null>(null);
  const [installing, setInstalling] = useState<ToolName | null>(null);
  const [progress, setProgress] = useState<Partial<Record<ToolName, ToolInstallProgressEvent>>>({});

  useEffect(() => {
    let unlisten: () => void = () => {};
    void onDesktopEvent("tool-install-progress", (event) => {
      setProgress((current) => ({ ...current, [event.tool]: event }));
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => unlisten();
  }, []);

  async function check(tool: ToolName) {
    setChecking(tool);
    try {
      const releases = await listAvailableVersions(tool);
      const latest = releases[0];
      if (!latest) throw new Error(`找不到 ${tool} 可用版本`);
      setAvailable((current) => ({ ...current, [tool]: latest }));
      const isLatest = status.tools[tool].selected === latest.version;
      notify(isLatest ? `${tool} 已是最新版本。` : `找到 ${tool} ${latest.version}。`, isLatest ? "success" : "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setChecking(null);
    }
  }

  async function install(tool: ToolName) {
    setInstalling(tool);
    try {
      await installTool(tool, available[tool]?.version);
      await refreshStatus();
      notify(`${tool} 已通過驗證並安裝完成。`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setInstalling(null);
      setProgress((current) => ({ ...current, [tool]: undefined }));
    }
  }

  async function switchVersion(tool: ToolName, version: string) {
    try {
      await switchToolVersion(tool, version);
      await refreshStatus();
      notify(`${tool} 已切換至 ${version}。`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function removeVersion(tool: ToolName, version: string) {
    try {
      await removeToolVersion(tool, version);
      await refreshStatus();
      notify(`已移除 ${tool} ${version}。`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function changeOutputDirectory() {
    try {
      const selected = await chooseOutputDirectory(status.settings.outputDirectory);
      if (!selected) return;
      await setOutputDirectory(selected);
      await refreshStatus();
      notify("輸出資料夾已更新。", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return (
    <section className="tools-view">
      <div className="page-heading tools-heading">
        <div>
          <p className="eyebrow"><Wrench size={14} /> TOOL MANAGER</p>
          <h1>工具與儲存空間</h1>
          <p>版本、完整性驗證與輸出位置，都集中在這裡管理。</p>
        </div>
        <div className="security-seal"><ShieldCheck size={24} /><span><strong>SHA256</strong><small>每次安裝必驗證</small></span></div>
      </div>

      <div className="tool-overview">
        <div><HardDriveDownload size={18} /><span><strong>{Object.values(status.tools).filter((tool) => tool.selected).length} / 3</strong><small>必要工具已就緒</small></span></div>
        <div><Archive size={18} /><span><strong>{Object.values(status.tools).reduce((sum, tool) => sum + tool.installed.length, 0)}</strong><small>本機已安裝版本</small></span></div>
        <div><ShieldCheck size={18} /><span><strong>強制</strong><small>SHA256 完整性驗證</small></span></div>
      </div>

      <div className="tools-list">
        {(["yt-dlp", "ffmpeg", "deno"] as ToolName[]).map((tool) => (
          <ToolCard
            key={tool}
            tool={tool}
            state={status.tools[tool]}
            available={available[tool] ?? null}
            checking={checking === tool}
            installing={installing === tool}
            installProgress={progress[tool] ?? null}
            onCheck={() => void check(tool)}
            onInstall={() => void install(tool)}
            onSwitch={(version) => void switchVersion(tool, version)}
            onRemove={(version) => void removeVersion(tool, version)}
          />
        ))}
      </div>

      <article className="output-card">
        <div className="output-icon"><FolderCog size={22} /></div>
        <div className="output-copy">
          <span>片段輸出資料夾</span>
          <strong>{status.settings.outputDirectory || "尚未設定"}</strong>
          <small>完成後可直接從任務狀態開啟所在位置</small>
        </div>
        <button className="button light" type="button" onClick={() => void changeOutputDirectory()}>
          <FolderOpen size={16} /> 選擇資料夾
        </button>
      </article>

      <div className="integrity-note">
        <ShieldCheck size={18} />
        <p><strong>下載的工具不會直接執行。</strong><span>應用程式會先在暫存區完成下載與雜湊驗證，通過後才以原子操作安裝；失敗時既有版本不受影響。</span></p>
      </div>
    </section>
  );
}
