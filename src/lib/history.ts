import type { DownloadHistoryEntry, DownloadPrefill } from "../types";

export function historyEntryToPrefill(
  entry: DownloadHistoryEntry,
): DownloadPrefill {
  return {
    url: entry.url,
    startSeconds: entry.startSeconds,
    endSeconds: entry.endSeconds,
    outputName: entry.outputName,
  };
}

export function historyFileName(path: string, outputName: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? `${outputName}.mp4`;
}

export function formatHistoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間未知";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
