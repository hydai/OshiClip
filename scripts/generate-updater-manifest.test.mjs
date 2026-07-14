import { describe, expect, it } from "vitest";
import { createUpdaterManifest } from "./generate-updater-manifest.mjs";

describe("GitHub updater manifest", () => {
  it("maps signed release assets to Tauri platform targets", () => {
    expect(
      createUpdaterManifest({
        version: "0.2.0",
        repository: "hydai/OshiClip",
        tag: "v0.2.0",
        publishedAt: "2026-07-15T12:00:00.000Z",
        notes: "Release notes",
        macSignature: "mac-signature\n",
        windowsSignature: "windows-signature\n",
      }),
    ).toEqual({
      version: "0.2.0",
      notes: "Release notes",
      pub_date: "2026-07-15T12:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          signature: "mac-signature",
          url: "https://github.com/hydai/OshiClip/releases/download/v0.2.0/OshiClip_0.2.0_macos-arm64.app.tar.gz",
        },
        "windows-x86_64": {
          signature: "windows-signature",
          url: "https://github.com/hydai/OshiClip/releases/download/v0.2.0/OshiClip_0.2.0_windows-x64-setup.exe",
        },
      },
    });
  });

  it("rejects a release tag that does not match the application version", () => {
    expect(() =>
      createUpdaterManifest({
        version: "0.2.0",
        repository: "hydai/OshiClip",
        tag: "v0.2.1",
        publishedAt: "2026-07-15T12:00:00.000Z",
        notes: "Release notes",
        macSignature: "mac-signature",
        windowsSignature: "windows-signature",
      }),
    ).toThrow("Release tag v0.2.1 does not match v0.2.0.");
  });

  it("rejects missing updater signatures", () => {
    expect(() =>
      createUpdaterManifest({
        version: "0.2.0",
        repository: "hydai/OshiClip",
        tag: "v0.2.0",
        publishedAt: "2026-07-15T12:00:00.000Z",
        notes: "Release notes",
        macSignature: "",
        windowsSignature: "windows-signature",
      }),
    ).toThrow("Updater signatures must not be empty.");
  });
});
