import { describe, expect, it } from "vitest";
import {
  applyUiPreferences,
  DEFAULT_UI_PREFERENCES,
  loadUiPreferences,
  parseUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
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
  it("uses a readable medium font and light theme by default", () => {
    expect(parseUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences("not-json")).toEqual(DEFAULT_UI_PREFERENCES);
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
