import type { DownloadFilenameMetadata } from "../types";
import { extractVideoId, formatTimecode, sanitizeOutputName } from "./time";

export const DEFAULT_FILENAME_TEMPLATE =
  "<Streamer>-<歌曲名>-<歌手>-<歌回名稱>";
export const FILENAME_TEMPLATE_STORAGE_KEY =
  "oshiclip.filename-template.v1";
export const FILENAME_TEMPLATE_MAX_LENGTH = 240;

export const FILENAME_TEMPLATE_TAGS = [
  { token: "<Streamer>", label: "Streamer" },
  { token: "<歌曲名>", label: "歌曲名" },
  { token: "<歌手>", label: "歌手" },
  { token: "<歌回名稱>", label: "歌回名稱" },
  { token: "<歌回日期>", label: "歌回日期" },
  { token: "<VideoID>", label: "Video ID" },
  { token: "<開始時間>", label: "開始時間" },
  { token: "<結束時間>", label: "結束時間" },
] as const;

export interface FilenameTemplateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FilenameTemplateContext {
  metadata: DownloadFilenameMetadata;
  url: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ResolvedFilenameTemplate {
  outputName: string;
  unknownTags: string[];
  hasMalformedTag: boolean;
}

const SUPPORTED_FILENAME_TAGS = new Set<string>(
  FILENAME_TEMPLATE_TAGS.map((tag) => tag.token),
);

function inspectTemplateSyntax(template: string) {
  const tags = template.match(/<[^<>\r\n]{1,40}>/g) ?? [];
  const unknownTags = [
    ...new Set(tags.filter((tag) => !SUPPORTED_FILENAME_TAGS.has(tag))),
  ];
  const withoutCompleteTags = template.replace(/<[^<>\r\n]{1,40}>/g, "");
  return {
    unknownTags,
    hasMalformedTag: /[<>]/.test(withoutCompleteTags),
  };
}

function filenameTime(seconds: number): string {
  return formatTimecode(seconds).replaceAll(":", "-");
}

export function resolveFilenameTemplate(
  template: string,
  context: FilenameTemplateContext,
): ResolvedFilenameTemplate {
  const values = new Map<string, string>([
    ["<Streamer>", context.metadata.streamer],
    ["<歌曲名>", context.metadata.songTitle],
    ["<歌手>", context.metadata.artist ?? "未知歌手"],
    ["<歌回名稱>", context.metadata.vodTitle],
    ["<歌回日期>", context.metadata.vodDate],
    ["<VideoID>", extractVideoId(context.url) ?? "video"],
    ["<開始時間>", filenameTime(context.startSeconds)],
    ["<結束時間>", filenameTime(context.endSeconds)],
  ]);
  const { unknownTags, hasMalformedTag } = inspectTemplateSyntax(template);
  let expanded = template;
  for (const [tag, value] of values) {
    expanded = expanded.replaceAll(tag, value);
  }
  return {
    outputName: sanitizeOutputName(expanded),
    unknownTags,
    hasMalformedTag,
  };
}

export function loadFilenameTemplate(
  storage?: FilenameTemplateStorage,
): string {
  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    const saved = target?.getItem(FILENAME_TEMPLATE_STORAGE_KEY);
    if (!saved || !saved.trim() || saved.length > FILENAME_TEMPLATE_MAX_LENGTH) {
      return DEFAULT_FILENAME_TEMPLATE;
    }
    const { unknownTags, hasMalformedTag } = inspectTemplateSyntax(saved);
    return unknownTags.length || hasMalformedTag
      ? DEFAULT_FILENAME_TEMPLATE
      : saved;
  } catch {
    return DEFAULT_FILENAME_TEMPLATE;
  }
}

export function saveFilenameTemplate(
  template: string,
  storage?: FilenameTemplateStorage,
): boolean {
  if (!template.trim() || template.length > FILENAME_TEMPLATE_MAX_LENGTH) {
    return false;
  }
  const { unknownTags, hasMalformedTag } = inspectTemplateSyntax(template);
  if (unknownTags.length || hasMalformedTag) return false;
  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return false;
    target.setItem(FILENAME_TEMPLATE_STORAGE_KEY, template);
    return true;
  } catch {
    return false;
  }
}
