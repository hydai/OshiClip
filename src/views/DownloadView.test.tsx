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

describe("DownloadView form layout", () => {
  it("keeps format details inside the collapsed native select", () => {
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
    expect(markup.match(/<option/g)).toHaveLength(2);
    expect(markup).toContain(
      "相容 MP4 — avc1 + mp4a，適合大多數播放器",
    );
    expect(markup).toContain("最佳品質 — 由 yt-dlp 選擇最高品質來源");
    expect(markup).not.toContain("format-preset-description");
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).not.toContain('type="radio"');
  });

  it("does not repeat the time range in a non-interactive timeline", () => {
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

    expect(markup).not.toContain("timeline-preview");
    expect(markup).not.toContain("片段區間預覽");
    expect(markup).not.toContain("選取片段");
  });
});
