import { describe, expect, it } from "vitest";
import {
  buildDefaultOutputName,
  extractVideoId,
  formatTimecode,
  isSupportedYouTubeUrl,
  parseTimecode,
  sanitizeOutputName,
} from "./time";

describe("timecode helpers", () => {
  it("parses supported time formats", () => {
    expect(parseTimecode("01:19:59")).toBe(4799);
    expect(parseTimecode("3:14")).toBe(194);
    expect(parseTimecode("42")).toBe(42);
  });

  it("rejects invalid timecodes", () => {
    expect(parseTimecode("1:60")).toBeNull();
    expect(parseTimecode("-1")).toBeNull();
    expect(parseTimecode("hello")).toBeNull();
  });

  it("formats timecodes consistently", () => {
    expect(formatTimecode(4799)).toBe("01:19:59");
  });
});

describe("YouTube and filename helpers", () => {
  it("recognizes canonical and shortened URLs", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=mLSIBfQWqB4")).toBe(
      "mLSIBfQWqB4",
    );
    expect(extractVideoId("https://youtu.be/mLSIBfQWqB4")).toBe("mLSIBfQWqB4");
    expect(isSupportedYouTubeUrl("https://example.com/watch?v=mLSIBfQWqB4")).toBe(false);
  });

  it("builds and sanitizes output names", () => {
    expect(
      buildDefaultOutputName("https://youtu.be/mLSIBfQWqB4", 4799, 4993),
    ).toBe("oshi-mLSIBfQWqB4-4799-4993");
    expect(sanitizeOutputName('  Nagi: "favorite" / clip  ')).toBe(
      "Nagi- -favorite- - clip",
    );
  });
});
