import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TEMPLATE_STORAGE_KEY,
  loadFilenameTemplate,
  resolveFilenameTemplate,
  saveFilenameTemplate,
  type FilenameTemplateStorage,
} from "./filenameTemplate";

const context = {
  metadata: {
    streamer: "涅默 Nemesis",
    songTitle: "六等星の夜",
    artist: "Aimer",
    vodTitle: "深夜歌回：一起唱歌 / 聊天",
    vodDate: "2026-07-10",
  },
  url: "https://www.youtube.com/watch?v=mLSIBfQWqB4",
  startSeconds: 5050,
  endSeconds: 5380,
};

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  const storage: FilenameTemplateStorage = {
    getItem: (key) =>
      key === FILENAME_TEMPLATE_STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === FILENAME_TEMPLATE_STORAGE_KEY) value = nextValue;
    },
  };
  return { storage, read: () => value };
}

describe("filename templates", () => {
  it("replaces library tags and sanitizes the actual filename", () => {
    expect(resolveFilenameTemplate(DEFAULT_FILENAME_TEMPLATE, context)).toEqual({
      outputName:
        "涅默 Nemesis-六等星の夜-Aimer-深夜歌回-一起唱歌 - 聊天",
      unknownTags: [],
      hasMalformedTag: false,
    });
  });

  it("supports source and time tags with a missing artist fallback", () => {
    const result = resolveFilenameTemplate(
      "<歌回日期>-<VideoID>-<開始時間>-<結束時間>-<歌手>",
      { ...context, metadata: { ...context.metadata, artist: null } },
    );

    expect(result.outputName).toBe(
      "2026-07-10-mLSIBfQWqB4-01-24-10-01-29-40-未知歌手",
    );
  });

  it("reports unknown and incomplete tags before download", () => {
    expect(resolveFilenameTemplate("<歌曲名>-<未知>-<歌手", context)).toMatchObject({
      unknownTags: ["<未知>"],
      hasMalformedTag: true,
    });
  });

  it("persists a valid template and falls back from invalid storage", () => {
    const { storage, read } = createStorage();
    expect(saveFilenameTemplate("<Streamer>-<歌曲名>", storage)).toBe(true);
    expect(read()).toBe("<Streamer>-<歌曲名>");
    expect(loadFilenameTemplate(storage)).toBe("<Streamer>-<歌曲名>");

    const oversized = createStorage("x".repeat(241));
    expect(loadFilenameTemplate(oversized.storage)).toBe(
      DEFAULT_FILENAME_TEMPLATE,
    );
    const unknown = createStorage("<Streamer>-<unknown>");
    expect(loadFilenameTemplate(unknown.storage)).toBe(
      DEFAULT_FILENAME_TEMPLATE,
    );
    expect(saveFilenameTemplate("<Streamer", storage)).toBe(false);
  });
});
