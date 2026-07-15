import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AURORA_FRAME_SANDBOX,
  AURORA_URL,
  AuroraView,
} from "./AuroraView";

describe("AuroraView", () => {
  it("embeds only the canonical Aurora HTTPS origin", () => {
    const url = new URL(AURORA_URL);

    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("aurora.oshi.tw");
    expect(url.pathname).toBe("/");
  });

  it("allows Aurora submission features without allowing parent navigation", () => {
    expect(AURORA_FRAME_SANDBOX.split(" ")).toEqual(
      expect.arrayContaining([
        "allow-forms",
        "allow-modals",
        "allow-popups",
        "allow-same-origin",
        "allow-scripts",
      ]),
    );
    expect(AURORA_FRAME_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("renders the trusted frame and browser fallback", () => {
    const markup = renderToStaticMarkup(<AuroraView />);

    expect(markup).toContain(`src="${AURORA_URL}"`);
    expect(markup).toContain(`sandbox="${AURORA_FRAME_SANDBOX}"`);
    expect(markup).toContain("Aurora 社群時間戳工具");
    expect(markup).toContain("瀏覽器開啟");
  });
});
