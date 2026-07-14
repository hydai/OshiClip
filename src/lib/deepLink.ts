import { sanitizeOutputName } from "./time";
import type { DownloadPrefill } from "../types";

const SUPPORTED_PROTOCOLS = new Set(["oshiclip:", "oshi-vods:"]);

export function parseDownloadDeepLink(raw: string): DownloadPrefill | null {
  try {
    const url = new URL(raw);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol) || url.hostname !== "download") {
      return null;
    }

    const videoId = url.searchParams.get("v") ?? "";
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    const outputName = sanitizeOutputName(url.searchParams.get("name") ?? "");

    if (!/^[\w-]{6,20}$/.test(videoId)) return null;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < 0
      || end <= start
    ) {
      return null;
    }

    return {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      startSeconds: start,
      endSeconds: end,
      outputName: outputName || undefined,
    };
  } catch {
    return null;
  }
}
