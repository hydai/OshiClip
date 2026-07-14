import { describe, expect, it } from "vitest";
import {
  INITIAL_APP_UPDATE_PROGRESS,
  formatUpdateBytes,
  reduceAppUpdateProgress,
} from "./appUpdate";

describe("application update progress", () => {
  it("accumulates download chunks and reserves completion for installation", () => {
    let progress = reduceAppUpdateProgress(INITIAL_APP_UPDATE_PROGRESS, {
      type: "started",
      contentLength: 1_000,
    });
    progress = reduceAppUpdateProgress(progress, {
      type: "progress",
      chunkLength: 400,
    });
    progress = reduceAppUpdateProgress(progress, {
      type: "progress",
      chunkLength: 600,
    });

    expect(progress).toEqual({
      stage: "downloading",
      downloadedBytes: 1_000,
      totalBytes: 1_000,
      percent: 99,
    });

    expect(
      reduceAppUpdateProgress(progress, { type: "finished" }),
    ).toEqual({
      stage: "installing",
      downloadedBytes: 1_000,
      totalBytes: 1_000,
      percent: 100,
    });
  });

  it("supports downloads without a content length", () => {
    const started = reduceAppUpdateProgress(INITIAL_APP_UPDATE_PROGRESS, {
      type: "started",
    });
    const progress = reduceAppUpdateProgress(started, {
      type: "progress",
      chunkLength: 512,
    });

    expect(progress.totalBytes).toBeNull();
    expect(progress.percent).toBeNull();
    expect(progress.downloadedBytes).toBe(512);
  });

  it("formats updater transfer sizes for the UI", () => {
    expect(formatUpdateBytes(0)).toBe("0 MB");
    expect(formatUpdateBytes(1_572_864)).toBe("1.5 MB");
    expect(formatUpdateBytes(15_728_640)).toBe("15 MB");
  });
});
