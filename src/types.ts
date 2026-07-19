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
  requiresRepair: boolean;
}

export interface AppSettings {
  outputDirectory: string;
}

export interface AppStatus {
  tools: Record<ToolName, ToolState>;
  settings: AppSettings;
  activeJobId: string | null;
  activeDownload: ActiveDownloadStatus | null;
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

export interface DownloadFilenameMetadata {
  streamer: string;
  songTitle: string;
  artist: string | null;
  vodTitle: string;
  vodDate: string;
}

export interface DownloadPrefill {
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName?: string;
  filenameMetadata?: DownloadFilenameMetadata;
}

export interface VodLibraryCounts {
  streamers: number;
  vods: number;
  performances: number;
}

export interface VodLibraryPerformance {
  performanceId: string;
  title: string;
  originalArtist: string | null;
  startSeconds: number;
  endSeconds: number;
}

export interface VodLibraryVod {
  title: string;
  date: string;
  videoId: string;
  performances: VodLibraryPerformance[];
}

export interface VodLibraryStreamer {
  slug: string;
  displayName: string;
  avatarUrl: string | null;
  group: string | null;
  vods: VodLibraryVod[];
}

export interface VodLibraryDataset {
  schemaVersion: string;
  publishedAt: string;
  syncedAt: string;
  sha256: string;
  counts: VodLibraryCounts;
  streamers: VodLibraryStreamer[];
}

export interface DownloadJob {
  jobId: string;
  outputPath: string;
}

export type DownloadPhase =
  | "preparing"
  | "downloading"
  | "finalizing"
  | "waiting";

export interface ActiveDownloadStatus extends DownloadSpec {
  jobId: string;
  outputPath: string;
  startedAt: string;
  phase: DownloadPhase;
  percent: number | null;
  speed: string | null;
  eta: string | null;
  downloadedBytes: number;
  elapsedSeconds: number;
}

export interface DownloadHistoryEntry {
  id: string;
  url: string;
  startSeconds: number;
  endSeconds: number;
  outputName: string;
  outputPath: string;
  formatPreset: FormatPreset;
  completedAt: string;
  sizeBytes: number;
  fileExists: boolean;
}

export type DownloadProgressEvent = ActiveDownloadStatus;

export interface DownloadLogEvent {
  jobId: string;
  line: string;
  stream: "stdout" | "stderr" | "diagnostic";
  timestamp: string;
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
