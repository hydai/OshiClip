import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ONLINE_SERVICE_FRAME_SANDBOX,
  ONLINE_SERVICES,
  OnlineServiceView,
} from "./OnlineServiceView";

const EXPECTED_SERVICES = [
  ["nova", "https://nova.oshi.tw/"],
  ["aurora", "https://aurora.oshi.tw/"],
  ["prism", "https://prism.oshi.tw/"],
];
const notify = () => undefined;

describe("OnlineServiceView", () => {
  it("registers only the canonical HTTPS service origins", () => {
    expect(ONLINE_SERVICES.map(({ id, url }) => [id, url])).toEqual(
      EXPECTED_SERVICES,
    );

    for (const service of ONLINE_SERVICES) {
      const url = new URL(service.url);
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe("/");
    }
  });

  it("allows submission and playback features without parent navigation", () => {
    expect(ONLINE_SERVICE_FRAME_SANDBOX.split(" ")).toEqual(
      expect.arrayContaining([
        "allow-forms",
        "allow-modals",
        "allow-popups",
        "allow-same-origin",
        "allow-scripts",
      ]),
    );
    expect(ONLINE_SERVICE_FRAME_SANDBOX).not.toContain("allow-top-navigation");
  });

  it.each(ONLINE_SERVICES)("renders the trusted $name frame and fallback", (service) => {
    const markup = renderToStaticMarkup(
      <OnlineServiceView service={service} notify={notify} />,
    );

    expect(markup).toContain(`src="${service.url}"`);
    expect(markup).toContain(`sandbox="${ONLINE_SERVICE_FRAME_SANDBOX}"`);
    expect(markup).toContain(service.frameTitle);
    expect(markup).toContain("瀏覽器開啟");
    expect(markup).not.toContain('target="_blank"');
  });

  it("allows the opener command only for the canonical service URLs", () => {
    const capability = JSON.parse(
      readFileSync(
        new URL("../../src-tauri/capabilities/default.json", import.meta.url),
        "utf8",
      ),
    );
    const openerPermission = capability.permissions.find(
      (permission: unknown) =>
        typeof permission === "object" &&
        permission !== null &&
        "identifier" in permission &&
        permission.identifier === "opener:allow-open-url",
    );

    expect(openerPermission).toEqual({
      identifier: "opener:allow-open-url",
      allow: EXPECTED_SERVICES.map(([, url]) => ({ url })),
    });
  });

  it("keeps the desktop CSP restricted to the three service origins", () => {
    const config = JSON.parse(
      readFileSync(
        new URL("../../src-tauri/tauri.conf.json", import.meta.url),
        "utf8",
      ),
    );
    const csp = String(config.app.security.csp);
    const frameSources = csp
      .match(/(?:^|;\s*)frame-src\s+([^;]+)/)?.[1]
      .trim()
      .split(/\s+/);

    expect(frameSources).toEqual([
      "https://nova.oshi.tw",
      "https://aurora.oshi.tw",
      "https://prism.oshi.tw",
    ]);
    expect(config.app.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "main", create: false }),
      ]),
    );
  });
});
