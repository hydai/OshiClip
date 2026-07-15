import { describe, expect, it } from "vitest";
import {
  downloadPhaseDescription,
  downloadPhaseLabel,
  formatElapsedTime,
} from "./downloadActivity";

describe("download activity helpers", () => {
  it("uses explicit labels for observable and waiting phases", () => {
    expect(downloadPhaseLabel("preparing")).toBe("正在解析影片");
    expect(downloadPhaseLabel("downloading")).toBe("正在下載片段");
    expect(downloadPhaseDescription("waiting")).toContain("仍在執行");
  });

  it("formats elapsed time without implying fake precision", () => {
    expect(formatElapsedTime(12.9)).toBe("12 秒");
    expect(formatElapsedTime(188)).toBe("3 分 08 秒");
    expect(formatElapsedTime(3725)).toBe("1 小時 02 分");
  });
});
