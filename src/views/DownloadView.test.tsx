import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "../types";
import { DownloadView } from "./DownloadView";

const status: AppStatus = {
  tools: {
    "yt-dlp": { selected: "2026.07.15", installed: [], requiresRepair: false },
    ffmpeg: { selected: "7.1", installed: [], requiresRepair: false },
    deno: { selected: "2.4.0", installed: [], requiresRepair: false },
  },
  settings: { outputDirectory: "OshiClip" },
  activeJobId: null,
  activeDownload: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DownloadView format picker", () => {
  it("uses a collapsed native select instead of permanently expanded cards", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });

    const markup = renderToStaticMarkup(
      <DownloadView
        status={status}
        prefill={null}
        onOpenTools={() => undefined}
        onStatusChange={async () => undefined}
        notify={() => undefined}
      />,
    );

    expect(markup).toContain('for="format-preset"');
    expect(markup).toContain('<select id="format-preset"');
    expect(markup).toContain('aria-describedby="format-preset-description"');
    expect(markup.match(/<option/g)).toHaveLength(2);
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).not.toContain('type="radio"');
  });
});
