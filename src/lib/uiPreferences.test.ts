import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyUiPreferences,
  BASE_UI_FONT_PX,
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  parseUiPreferences,
  saveUiPreferences,
  UI_FONT_SIZES,
  UI_FONT_SIZE_SCALES,
  UI_PREFERENCES_STORAGE_KEY,
  uiFontRootPixels,
  type UiPreferenceStorage,
} from "./uiPreferences";

function createStorage(initialValue: string | null = null) {
  let value = initialValue;
  const storage: UiPreferenceStorage = {
    getItem: (key) =>
      key === UI_PREFERENCES_STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === UI_PREFERENCES_STORAGE_KEY) value = nextValue;
    },
  };
  return { storage, read: () => value };
}

describe("UI preferences", () => {
  it("uses the readable medium font and light theme by default", () => {
    expect(parseUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences("not-json")).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("restores the previous five font presets and scales them proportionally", () => {
    expect(BASE_UI_FONT_PX).toBe(16);
    expect(DEFAULT_UI_PREFERENCES.fontSize).toBe("md");
    expect(UI_FONT_SIZES.map(uiFontRootPixels)).toEqual([16, 18, 20, 22, 24]);
    for (const fontSize of UI_FONT_SIZES) {
      expect(uiFontRootPixels(fontSize)).toBe(
        BASE_UI_FONT_PX * UI_FONT_SIZE_SCALES[fontSize],
      );
    }
  });

  it("keeps the stylesheet on the shared readable type scale", () => {
    const stylesheet = readFileSync(
      new URL("../styles.css", import.meta.url),
      "utf8",
    );
    const directSubRemSizes = [
      ...stylesheet.matchAll(
        /(?:font-size|font)\s*:[^;{}]*?\b(0(?:\.\d+)?)rem\b/g,
      ),
    ].map((match) => match[0]);
    const typeScaleRemSizes = [
      ...stylesheet.matchAll(/--font-[a-z-]+:\s*([\d.]+)rem;/g),
    ].map((match) => Number(match[1]));
    const clampedLegacyRoles = [
      "meta",
      "caption",
      "label",
      "body",
      "body-strong",
      "subtitle",
      "title",
      "heading",
    ];

    expect(directSubRemSizes).toEqual([]);
    expect(typeScaleRemSizes.length).toBeGreaterThan(0);
    expect(typeScaleRemSizes.every((size) => size >= 1)).toBe(true);
    for (const role of clampedLegacyRoles) {
      const token = new RegExp(`--font-${role}:\\s*([\\d.]+)rem;`);
      expect(Number(stylesheet.match(token)?.[1])).toBe(1);
    }
    for (const fontSize of UI_FONT_SIZES) {
      const selector = new RegExp(
        `html\\[data-font-size="${fontSize}"\\] \\{ font-size: ([\\d.]+)px; \\}`,
      );
      const configuredPixels = stylesheet.match(selector)?.[1];

      expect(Number(configuredPixels)).toBe(uiFontRootPixels(fontSize));
    }
  });

  it("restores a saved theme and font size", () => {
    const { storage } = createStorage(
      JSON.stringify({ theme: "dark", fontSize: "xl" }),
    );

    expect(loadUiPreferences(storage)).toEqual({
      theme: "dark",
      fontSize: "xl",
    });
  });

  it("falls back only invalid preference fields", () => {
    expect(
      parseUiPreferences(JSON.stringify({ theme: "system", fontSize: "lg" })),
    ).toEqual({ theme: "light", fontSize: "lg" });
    expect(
      parseUiPreferences(JSON.stringify({ theme: "dark", fontSize: "huge" })),
    ).toEqual({ theme: "dark", fontSize: "md" });
  });

  it("persists the canonical preference object", () => {
    const { storage, read } = createStorage();

    expect(saveUiPreferences({ theme: "dark", fontSize: "sm" }, storage)).toBe(
      true,
    );
    expect(read()).toBe(JSON.stringify({ theme: "dark", fontSize: "sm" }));
  });

  it("applies the preferences before the React UI renders", () => {
    let themeColor = "";
    const root = {
      dataset: {},
      style: {},
      ownerDocument: {
        querySelector: () => ({
          setAttribute: (_name: string, value: string) => {
            themeColor = value;
          },
        }),
      },
    } as unknown as HTMLElement;

    applyUiPreferences({ theme: "dark", fontSize: "xl" }, root);

    expect(root.dataset).toEqual({ theme: "dark", fontSize: "xl" });
    expect(root.style.colorScheme).toBe("dark");
    expect(themeColor).toBe("#0c1222");
  });

  it("keeps running when browser storage is unavailable", () => {
    const storage: UiPreferenceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(loadUiPreferences(storage)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(saveUiPreferences(DEFAULT_UI_PREFERENCES, storage)).toBe(false);
  });
});
