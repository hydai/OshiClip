import type { AppUpdateProgress } from "../types";

export type AppUpdateTransferEvent =
  | { type: "started"; contentLength?: number }
  | { type: "progress"; chunkLength: number }
  | { type: "finished" };

export const INITIAL_APP_UPDATE_PROGRESS: AppUpdateProgress = {
  stage: "downloading",
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
};

export function reduceAppUpdateProgress(
  current: AppUpdateProgress,
  event: AppUpdateTransferEvent,
): AppUpdateProgress {
  if (event.type === "started") {
    const totalBytes =
      event.contentLength && event.contentLength > 0
        ? event.contentLength
        : null;
    return {
      stage: "downloading",
      downloadedBytes: 0,
      totalBytes,
      percent: totalBytes ? 0 : null,
    };
  }

  if (event.type === "finished") {
    return {
      ...current,
      stage: "installing",
      percent: 100,
    };
  }

  const downloadedBytes =
    current.downloadedBytes + Math.max(0, event.chunkLength);
  const percent = current.totalBytes
    ? Math.min(99, Math.round((downloadedBytes / current.totalBytes) * 100))
    : null;

  return {
    ...current,
    downloadedBytes,
    percent,
  };
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}
