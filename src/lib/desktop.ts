import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import packageInfo from "../../package.json";
import type {
  AppStatus,
  AvailableAppUpdate,
  AvailableRelease,
  DesktopEventMap,
  DesktopEventName,
  DownloadHistoryEntry,
  DownloadJob,
  DownloadSpec,
  InstalledVersion,
  ToolName,
  VodLibraryDataset,
} from "../types";
import {
  INITIAL_APP_UPDATE_PROGRESS,
  reduceAppUpdateProgress,
} from "./appUpdate";

export const isDesktopRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const applicationVersion = packageInfo.version;
const isAppUpdatePreview =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("preview-update");
export const canCheckForAppUpdate = isDesktopRuntime || isAppUpdatePreview;

export async function confirmExternalNavigation(
  serviceName: string,
  message: string,
): Promise<boolean> {
  if (!isDesktopRuntime) return window.confirm(message);

  const { confirm } = await import("@tauri-apps/plugin-dialog");
  return confirm(message, {
    title: `開啟 ${serviceName}`,
    kind: "info",
    okLabel: "開啟瀏覽器",
    cancelLabel: "取消",
  });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isDesktopRuntime) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  const openedWindow = window.open(url, "_blank");
  if (!openedWindow) {
    throw new Error("瀏覽器阻擋了新分頁");
  }
  openedWindow.opener = null;
}

const now = new Date().toISOString();
let browserStatus: AppStatus = {
  tools: {
    "yt-dlp": {
      selected: "2026.07.11",
      requiresRepair: false,
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
      requiresRepair: false,
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
      requiresRepair: false,
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
    outputDirectory: "~/Downloads/OshiClip",
  },
  activeJobId: null,
  activeDownload: null,
};

const browserEvents = new EventTarget();
let simulationTimer: number | null = null;
const vodAvatarRequests = new Map<string, Promise<string | null>>();
let browserHistory: DownloadHistoryEntry[] = [
  {
    id: "preview-history-1",
    url: "https://www.youtube.com/watch?v=mLSIBfQWqB4",
    startSeconds: 4799,
    endSeconds: 4993,
    outputName: "nagi-favorite-clip",
    outputPath: "~/Downloads/OshiClip/nagi-favorite-clip.mp4",
    formatPreset: "avc1_mp4a",
    completedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    sizeBytes: 86_507_328,
    fileExists: true,
  },
  {
    id: "preview-history-2",
    url: "https://youtu.be/dQw4w9WgXcQ",
    startSeconds: 42,
    endSeconds: 132,
    outputName: "favorite-moment",
    outputPath: "~/Downloads/OshiClip/favorite-moment.mp4",
    formatPreset: "best",
    completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    sizeBytes: 41_943_040,
    fileExists: false,
  },
];

let browserVodLibrary: VodLibraryDataset = {
  schemaVersion: "1.0.0",
  publishedAt: "2026-07-11T20:04:22.682Z",
  syncedAt: now,
  sha256: "preview",
  counts: { streamers: 2, vods: 3, performances: 7 },
  streamers: [
    {
      slug: "earendel",
      displayName: "Earendel ch. 厄倫蒂兒",
      avatarUrl: null,
      group: "春魚創意",
      vods: [
        {
          title: "【伴睡歌回】有些話不是不想說，只是選擇不說了。",
          date: "2026-06-15",
          videoId: "ZsObrmIQLGk",
          performances: [
            { performanceId: "preview-p1", title: "她說", originalArtist: "林俊傑", startSeconds: 1702, endSeconds: 2000 },
            { performanceId: "preview-p2", title: "慢冷", originalArtist: "梁靜茹", startSeconds: 2140, endSeconds: 2416 },
            { performanceId: "preview-p3", title: "小幸運", originalArtist: "田馥甄", startSeconds: 2870, endSeconds: 3134 },
          ],
        },
        {
          title: "深夜治癒歌回｜一起唱到睡著",
          date: "2026-05-18",
          videoId: "mLSIBfQWqB4",
          performances: [
            { performanceId: "preview-p4", title: "如果可以", originalArtist: "韋禮安", startSeconds: 4799, endSeconds: 4993 },
            { performanceId: "preview-p5", title: "刻在我心底的名字", originalArtist: "盧廣仲", startSeconds: 5210, endSeconds: 5488 },
          ],
        },
      ],
    },
    {
      slug: "nagi",
      displayName: "涅默 Nemesis",
      avatarUrl: null,
      group: "極深空計畫",
      vods: [
        {
          title: "週末歌回：把喜歡的歌都唱一遍",
          date: "2026-04-26",
          videoId: "dQw4w9WgXcQ",
          performances: [
            { performanceId: "preview-p6", title: "群青", originalArtist: "YOASOBI", startSeconds: 612, endSeconds: 868 },
            { performanceId: "preview-p7", title: "花に亡霊", originalArtist: "ヨルシカ", startSeconds: 1040, endSeconds: 1298 },
          ],
        },
      ],
    },
  ],
};

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

export async function checkForAppUpdate(): Promise<AvailableAppUpdate | null> {
  if (!isDesktopRuntime) {
    if (!isAppUpdatePreview) return null;

    return {
      currentVersion: applicationVersion,
      version: "0.3.0",
      date: new Date().toISOString(),
      body: "改善 GitHub Release 更新流程\n\n・加入下載進度與簽章驗證\n・安裝完成後自動重新啟動",
      downloadAndInstall: async (onProgress) => {
        let progress = reduceAppUpdateProgress(INITIAL_APP_UPDATE_PROGRESS, {
          type: "started",
          contentLength: 5 * 1024 * 1024,
        });
        onProgress(progress);
        for (let index = 0; index < 5; index += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 240));
          progress = reduceAppUpdateProgress(progress, {
            type: "progress",
            chunkLength: 1024 * 1024,
          });
          onProgress(progress);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 320));
        onProgress(
          reduceAppUpdateProgress(progress, { type: "finished" }),
        );
      },
      close: async () => undefined,
    };
  }

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15_000 });
  if (!update) return null;

  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    body: update.body?.trim() || null,
    downloadAndInstall: async (onProgress) => {
      let progress = { ...INITIAL_APP_UPDATE_PROGRESS };
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            progress = reduceAppUpdateProgress(progress, {
              type: "started",
              contentLength: event.data.contentLength,
            });
            break;
          case "Progress":
            progress = reduceAppUpdateProgress(progress, {
              type: "progress",
              chunkLength: event.data.chunkLength,
            });
            break;
          case "Finished":
            progress = reduceAppUpdateProgress(progress, { type: "finished" });
            break;
        }
        onProgress(progress);
      });
    },
    close: () => update.close(),
  };
}

export async function relaunchApplication(): Promise<void> {
  if (!isDesktopRuntime) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
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
  browserStatus.tools[tool].requiresRepair = false;
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
  if (!isDesktopRuntime) return "~/Movies/OshiClip";
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
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  browserStatus.activeJobId = jobId;
  browserStatus.activeDownload = {
    ...spec,
    jobId,
    outputPath,
    startedAt,
    phase: "preparing",
    percent: null,
    speed: null,
    eta: null,
    downloadedBytes: 0,
    elapsedSeconds: 0,
  };
  let percent = 0;
  emitBrowserEvent("download-log", {
    jobId,
    line: "[preview] 已建立安全的 argv 參數並啟動 yt-dlp",
    stream: "stdout",
  });
  simulationTimer = window.setInterval(() => {
    percent = Math.min(100, percent + 4 + Math.round(Math.random() * 7));
    const activeDownload = {
      ...browserStatus.activeDownload!,
      phase: percent >= 96 ? "finalizing" as const : "downloading" as const,
      percent: Math.min(99.9, percent),
      speed: `${(4.1 + Math.random() * 2).toFixed(2)} MiB/s`,
      eta: percent >= 100 ? "00:00" : `00:${String(Math.ceil((100 - percent) / 8)).padStart(2, "0")}`,
      downloadedBytes: Math.round((percent / 100) * 64 * 1024 * 1024),
      elapsedSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
    };
    browserStatus.activeDownload = activeDownload;
    emitBrowserEvent("download-progress", activeDownload);
    if (percent >= 100) {
      if (simulationTimer !== null) window.clearInterval(simulationTimer);
      simulationTimer = null;
      browserStatus.activeJobId = null;
      browserStatus.activeDownload = null;
      browserHistory = [
        {
          id: jobId,
          url: spec.url,
          startSeconds: spec.startSeconds,
          endSeconds: spec.endSeconds,
          outputName: spec.outputName,
          outputPath,
          formatPreset: spec.formatPreset,
          completedAt: new Date().toISOString(),
          sizeBytes: 64 * 1024 * 1024,
          fileExists: true,
        },
        ...browserHistory,
      ];
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
  browserStatus.activeDownload = null;
  emitBrowserEvent("download-error", {
    jobId,
    message: "下載已取消",
    code: null,
  });
}

export async function revealOutput(path: string) {
  if (isDesktopRuntime) await invoke("reveal_output", { path });
}

export async function getDownloadHistory(): Promise<DownloadHistoryEntry[]> {
  if (isDesktopRuntime) {
    return invoke<DownloadHistoryEntry[]>("list_download_history");
  }
  return structuredClone(browserHistory);
}

export async function removeDownloadHistory(id: string): Promise<void> {
  if (isDesktopRuntime) {
    await invoke("remove_download_history", { id });
    return;
  }
  browserHistory = browserHistory.filter((entry) => entry.id !== id);
}

export async function clearDownloadHistory(): Promise<void> {
  if (isDesktopRuntime) {
    await invoke("clear_download_history");
    return;
  }
  browserHistory = [];
}

export async function revealHistoryOutput(id: string): Promise<void> {
  if (isDesktopRuntime) {
    await invoke("reveal_history_output", { id });
    return;
  }
  const entry = browserHistory.find((item) => item.id === id);
  if (!entry?.fileExists) throw new Error("下載檔案已被移動或刪除");
}

export async function getVodLibrary(
  forceRefresh = false,
): Promise<VodLibraryDataset> {
  if (isDesktopRuntime) {
    return invoke<VodLibraryDataset>("get_vod_library", { forceRefresh });
  }
  await new Promise((resolve) => window.setTimeout(resolve, forceRefresh ? 420 : 180));
  if (forceRefresh) {
    browserVodLibrary = {
      ...browserVodLibrary,
      syncedAt: new Date().toISOString(),
    };
  }
  return structuredClone(browserVodLibrary);
}

export function getVodStreamerAvatar(
  streamerSlug: string,
  avatarUrl: string | null,
): Promise<string | null> {
  if (!avatarUrl) return Promise.resolve(null);
  if (!isDesktopRuntime) return Promise.resolve(avatarUrl);

  const key = `${streamerSlug}\u0000${avatarUrl}`;
  const existing = vodAvatarRequests.get(key);
  if (existing) return existing;

  const request = invoke<string | null>("get_vod_streamer_avatar", {
    streamerSlug,
  }).catch((error) => {
    vodAvatarRequests.delete(key);
    throw error;
  });
  vodAvatarRequests.set(key, request);
  return request;
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
