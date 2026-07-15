import type { DownloadPhase } from "../types";

const PHASE_LABELS: Record<DownloadPhase, string> = {
  preparing: "正在解析影片",
  downloading: "正在下載片段",
  finalizing: "正在整理檔案",
  waiting: "等待工具回應",
};

const PHASE_DESCRIPTIONS: Record<DownloadPhase, string> = {
  preparing: "正在取得 YouTube 串流資訊，通常只需要幾秒鐘。",
  downloading: "正在接收來源串流並同步裁切選取區間。",
  finalizing: "片段已下載，正在完成 MP4 檔案。",
  waiting: "暫時沒有收到新資料；下載工具仍在執行。",
};

export function downloadPhaseLabel(phase: DownloadPhase): string {
  return PHASE_LABELS[phase];
}

export function downloadPhaseDescription(phase: DownloadPhase): string {
  return PHASE_DESCRIPTIONS[phase];
}

export function formatElapsedTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours} 小時 ${String(minutes).padStart(2, "0")} 分`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${String(remainder).padStart(2, "0")} 秒`;
  }
  return `${remainder} 秒`;
}
