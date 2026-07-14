import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppStatus,
  AvailableRelease,
  DesktopEventMap,
  DesktopEventName,
  DownloadJob,
  DownloadSpec,
  InstalledVersion,
  ToolName,
} from "../types";

export const isDesktopRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const now = new Date().toISOString();
let browserStatus: AppStatus = {
  tools: {
    "yt-dlp": {
      selected: "2026.07.11",
      installed: [
        {
          version: "2026.07.11",
          path: "bin/yt-dlp/2026.07.11/yt-dlp",
          sha256: "preview",
          sourceUrl: "preview://yt-dlp",
          sizeBytes: 12_648_420,
          installedAt: now,
        },
      ],
    },
    ffmpeg: {
      selected: "n8.0",
      installed: [
        {
          version: "n8.0",
          path: "bin/ffmpeg/n8.0/ffmpeg",
          sha256: "preview",
          sourceUrl: "preview://ffmpeg",
          sizeBytes: 79_214_592,
          installedAt: now,
        },
      ],
    },
    deno: {
      selected: "v2.9.2",
      installed: [
        {
          version: "v2.9.2",
          path: "bin/deno/v2.9.2/deno",
          sha256: "preview",
          sourceUrl: "preview://deno",
          sizeBytes: 104_857_600,
          installedAt: now,
        },
      ],
    },
  },
  settings: {
    outputDirectory: "~/Downloads/VODS Oshi",
  },
  activeJobId: null,
};

const browserEvents = new EventTarget();
let simulationTimer: number | null = null;

function emitBrowserEvent<Name extends DesktopEventName>(
  name: Name,
  payload: DesktopEventMap[Name],
) {
  browserEvents.dispatchEvent(new CustomEvent(name, { detail: payload }));
}

function cloneStatus(): AppStatus {
  return structuredClone(browserStatus);
}

export async function getAppStatus(): Promise<AppStatus> {
  if (isDesktopRuntime) return invoke<AppStatus>("get_app_status");
  return cloneStatus();
}

export async function listAvailableVersions(
  tool: ToolName,
): Promise<AvailableRelease[]> {
  if (isDesktopRuntime) {
    return invoke<AvailableRelease[]>("list_available_versions", { tool });
  }
  const version = tool === "yt-dlp" ? "2026.07.11" : tool === "ffmpeg" ? "n8.1" : "v2.9.2";
  return [
    {
      tool,
      version,
      assetName:
        tool === "yt-dlp"
          ? "yt-dlp_macos"
          : tool === "ffmpeg"
            ? "ffmpeg-darwin-arm64"
            : "deno-aarch64-apple-darwin.zip",
      sizeBytes: tool === "yt-dlp" ? 12_648_420 : tool === "ffmpeg" ? 45_568_216 : 104_857_600,
      publishedAt: now,
    },
  ];
}

export async function installTool(
  tool: ToolName,
  version?: string,
): Promise<InstalledVersion> {
  if (isDesktopRuntime) {
    return invoke<InstalledVersion>("install_tool", {
      tool,
      version: version ?? null,
    });
  }
  const nextVersion =
    version ?? (tool === "yt-dlp" ? "2026.07.11" : tool === "ffmpeg" ? "n8.1" : "v2.9.2");
  for (const [index, stage] of [
    "downloading",
    "verifying",
    "extracting",
    "installing",
  ].entries()) {
    await new Promise((resolve) => window.setTimeout(resolve, 320));
    emitBrowserEvent("tool-install-progress", {
      tool,
      version: nextVersion,
      percent: (index + 1) * 25,
      stage: stage as "downloading" | "verifying" | "extracting" | "installing",
    });
  }
  const installed: InstalledVersion = {
    version: nextVersion,
    path: `bin/${tool}/${nextVersion}/${tool === "yt-dlp" ? "yt-dlp" : tool}`,
    sha256: "preview",
    sourceUrl: `preview://${tool}`,
    sizeBytes: tool === "yt-dlp" ? 12_648_420 : tool === "ffmpeg" ? 45_568_216 : 104_857_600,
    installedAt: new Date().toISOString(),
  };
  browserStatus.tools[tool].installed = [installed];
  browserStatus.tools[tool].selected = nextVersion;
  return installed;
}

export async function switchToolVersion(tool: ToolName, version: string) {
  if (isDesktopRuntime) {
    await invoke("switch_tool_version", { tool, version });
    return;
  }
  browserStatus.tools[tool].selected = version;
}

export async function removeToolVersion(tool: ToolName, version: string) {
  if (isDesktopRuntime) {
    await invoke("remove_tool_version", { tool, version });
    return;
  }
  const state = browserStatus.tools[tool];
  state.installed = state.installed.filter((item) => item.version !== version);
  if (state.selected === version) state.selected = state.installed[0]?.version ?? null;
}

export async function chooseOutputDirectory(current: string): Promise<string | null> {
  if (!isDesktopRuntime) return "~/Movies/VODS Oshi";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: "選擇片段輸出資料夾",
    directory: true,
    multiple: false,
    defaultPath: current,
  });
  return typeof selected === "string" ? selected : null;
}

export async function setOutputDirectory(path: string) {
  if (isDesktopRuntime) {
    await invoke("set_output_directory", { path });
    return;
  }
  browserStatus.settings.outputDirectory = path;
}

export async function startDownload(spec: DownloadSpec): Promise<DownloadJob> {
  if (isDesktopRuntime) return invoke<DownloadJob>("start_download", { spec });
  if (browserStatus.activeJobId) throw new Error("已有下載任務進行中");

  const jobId = `preview-${Date.now()}`;
  const outputPath = `${browserStatus.settings.outputDirectory}/${spec.outputName}.mp4`;
  browserStatus.activeJobId = jobId;
  let percent = 0;
  emitBrowserEvent("download-log", {
    jobId,
    line: "[preview] 已建立安全的 argv 參數並啟動 yt-dlp",
    stream: "stdout",
  });
  simulationTimer = window.setInterval(() => {
    percent = Math.min(100, percent + 4 + Math.round(Math.random() * 7));
    emitBrowserEvent("download-progress", {
      jobId,
      percent,
      speed: `${(4.1 + Math.random() * 2).toFixed(2)} MiB/s`,
      eta: percent >= 100 ? "00:00" : `00:${String(Math.ceil((100 - percent) / 8)).padStart(2, "0")}`,
    });
    if (percent >= 100) {
      if (simulationTimer !== null) window.clearInterval(simulationTimer);
      simulationTimer = null;
      browserStatus.activeJobId = null;
      emitBrowserEvent("download-done", { jobId, outputPath });
    }
  }, 380);
  return { jobId, outputPath };
}

export async function cancelDownload(jobId: string) {
  if (isDesktopRuntime) {
    await invoke("cancel_download", { jobId });
    return;
  }
  if (simulationTimer !== null) window.clearInterval(simulationTimer);
  simulationTimer = null;
  browserStatus.activeJobId = null;
  emitBrowserEvent("download-error", {
    jobId,
    message: "下載已取消",
    code: null,
  });
}

export async function revealOutput(path: string) {
  if (isDesktopRuntime) await invoke("reveal_output", { path });
}

export async function onDesktopEvent<Name extends DesktopEventName>(
  name: Name,
  callback: (payload: DesktopEventMap[Name]) => void,
): Promise<UnlistenFn> {
  if (isDesktopRuntime) {
    return listen<DesktopEventMap[Name]>(name, (event) => callback(event.payload));
  }
  const listener = (event: Event) => callback((event as CustomEvent).detail);
  browserEvents.addEventListener(name, listener);
  return () => browserEvents.removeEventListener(name, listener);
}

export async function subscribeToDeepLinks(
  callback: (urls: string[]) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime) return () => undefined;
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const current = await getCurrent();
  if (current?.length) callback(current);
  return onOpenUrl(callback);
}
