import { describe, expect, it } from "vitest";
import type { DownloadHistoryEntry } from "../types";
import {
  formatHistoryBytes,
  historyEntryToPrefill,
  historyFileName,
} from "./history";

const entry: DownloadHistoryEntry = {
  id: "download-1",
  url: "https://www.youtube.com/watch?v=mLSIBfQWqB4",
  startSeconds: 4799,
  endSeconds: 4993,
  outputName: "nagi-favorite-clip",
  outputPath: "/Users/oshi/Downloads/nagi-favorite-clip.mp4",
  formatPreset: "avc1_mp4a",
  completedAt: "2026-07-15T12:00:00Z",
  sizeBytes: 1_572_864,
  fileExists: true,
};

describe("download history helpers", () => {
  it("converts a completed entry back into an editable download prefill", () => {
    expect(historyEntryToPrefill(entry)).toEqual({
      url: entry.url,
      startSeconds: 4799,
      endSeconds: 4993,
      outputName: "nagi-favorite-clip",
    });
  });

  it("extracts file names from POSIX and Windows paths", () => {
    expect(historyFileName(entry.outputPath, entry.outputName)).toBe(
      "nagi-favorite-clip.mp4",
    );
    expect(historyFileName("C:\\Clips\\oshi.mp4", "fallback")).toBe(
      "oshi.mp4",
    );
  });

  it("formats sizes and handles unavailable metadata", () => {
    expect(formatHistoryBytes(1_572_864)).toBe("1.5 MB");
    expect(formatHistoryBytes(0)).toBe("大小未知");
  });
});
