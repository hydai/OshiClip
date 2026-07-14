import { describe, expect, it } from "vitest";
import { parseDownloadDeepLink } from "./deepLink";

const EXPECTED_PREFILL = {
  url: "https://www.youtube.com/watch?v=mLSIBfQWqB4",
  startSeconds: 4799,
  endSeconds: 4993,
  outputName: "nagi-favorite-clip",
};

describe("OshiClip deep links", () => {
  it("parses the primary oshiclip scheme", () => {
    expect(
      parseDownloadDeepLink(
        "oshiclip://download?v=mLSIBfQWqB4&start=4799&end=4993&name=nagi-favorite-clip",
      ),
    ).toEqual(EXPECTED_PREFILL);
  });

  it("keeps the legacy vods.oshi.tw scheme compatible", () => {
    expect(
      parseDownloadDeepLink(
        "oshi-vods://download?v=mLSIBfQWqB4&start=4799&end=4993&name=nagi-favorite-clip",
      ),
    ).toEqual(EXPECTED_PREFILL);
  });

  it("rejects unsupported or unsafe links", () => {
    expect(
      parseDownloadDeepLink(
        "https://download?v=mLSIBfQWqB4&start=4799&end=4993",
      ),
    ).toBeNull();
    expect(
      parseDownloadDeepLink(
        "oshiclip://download?v=mLSIBfQWqB4&start=4993&end=4799",
      ),
    ).toBeNull();
  });
});
