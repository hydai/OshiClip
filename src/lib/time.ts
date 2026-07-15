const TIME_PARTS = /^\d{1,3}(?::\d{1,2}){0,2}$/;

export function parseTimecode(value: string): number | null {
  const trimmed = value.trim();
  if (!TIME_PARTS.test(trimmed)) return null;

  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length > 1 && parts.slice(1).some((part) => part > 59)) return null;

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function formatTimecode(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分鐘`;
}

export function extractVideoId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      return url.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

export function isSupportedYouTubeUrl(value: string): boolean {
  const id = extractVideoId(value);
  return Boolean(id && /^[\w-]{6,20}$/.test(id));
}

export function buildDefaultOutputName(
  url: string,
  startSeconds: number,
  endSeconds: number,
): string {
  const videoId = extractVideoId(url) ?? "clip";
  return `oshiclip-${videoId}-${startSeconds}-${endSeconds}`;
}

export function sanitizeOutputName(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return Array.from(sanitized).slice(0, 120).join("");
}
