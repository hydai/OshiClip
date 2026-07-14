export type ToolName = "yt-dlp" | "ffmpeg" | "deno";
export type FormatPreset = "avc1_mp4a" | "best";

export interface InstalledVersion {
  version: string;
  path: string;
  sha256: string;
  sourceUrl: string;
  sizeBytes: number;
  installedAt: string;
}

export interface ToolState {
  selected: string | null;
  installed: InstalledVersion[];
}

export interface AppSettings {
  outputDirectory: string;
}

export interface AppStatus {
  tools: Record<ToolName, ToolState>;
  settings: AppSettings;
  activeJobId: string | null;
}

export interface AvailableRelease {
  tool: ToolName;
  version: string;
  assetName: string;
  sizeBytes: number;
  publishedAt: string | null;
}

export type AppUpdateStage = "downloading" | "installing";

export interface AppUpdateProgress {
  stage: AppUpdateStage;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface AvailableAppUpdate {
  currentVersion: string;
  version: string;
  date: string | null;
  body: string | null;
  downloadAndInstall: (
    onProgress: (progress: AppUpdateProgress) => void,
  ) => Promise<void>;
  close: () => Promise<void>;
}

export interface DownloadSpec {
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName: string;
  formatPreset: FormatPreset;
}

export interface DownloadPrefill {
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName?: string;
}

export interface DownloadJob {
  jobId: string;
  outputPath: string;
}

export interface DownloadProgressEvent {
  jobId: string;
  percent: number;
  speed: string | null;
  eta: string | null;
}

export interface DownloadLogEvent {
  jobId: string;
  line: string;
  stream: "stdout" | "stderr";
}

export interface DownloadDoneEvent {
  jobId: string;
  outputPath: string;
}

export interface DownloadErrorEvent {
  jobId: string;
  message: string;
  code: number | null;
}

export interface ToolInstallProgressEvent {
  tool: ToolName;
  version: string;
  percent: number;
  stage: "downloading" | "verifying" | "extracting" | "installing";
}

export type DesktopEventMap = {
  "download-progress": DownloadProgressEvent;
  "download-log": DownloadLogEvent;
  "download-done": DownloadDoneEvent;
  "download-error": DownloadErrorEvent;
  "tool-install-progress": ToolInstallProgressEvent;
};

export type DesktopEventName = keyof DesktopEventMap;
