export const UI_THEMES = ["light", "dark"] as const;
export const UI_FONT_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

export type UiTheme = (typeof UI_THEMES)[number];
export type UiFontSize = (typeof UI_FONT_SIZES)[number];

export const BASE_UI_FONT_PX = 16;
export const MIN_UI_TEXT_SCALE = 0.9;
export const UI_FONT_SIZE_SCALES: Record<UiFontSize, number> = {
  xs: 0.75,
  sm: 0.875,
  md: 1,
  lg: 1.125,
  xl: 1.25,
};

export function uiFontRootPixels(fontSize: UiFontSize): number {
  return BASE_UI_FONT_PX * UI_FONT_SIZE_SCALES[fontSize];
}

export function uiMinimumTextPixels(fontSize: UiFontSize): number {
  return Math.round(uiFontRootPixels(fontSize) * MIN_UI_TEXT_SCALE * 10) / 10;
}

export interface UiPreferences {
  theme: UiTheme;
  fontSize: UiFontSize;
}

export interface UiPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const UI_PREFERENCES_STORAGE_KEY = "oshiclip.ui-preferences.v1";
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  theme: "light",
  fontSize: "md",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTheme(value: unknown): value is UiTheme {
  return typeof value === "string" && UI_THEMES.includes(value as UiTheme);
}

function isFontSize(value: unknown): value is UiFontSize {
  return (
    typeof value === "string" && UI_FONT_SIZES.includes(value as UiFontSize)
  );
}

export function parseUiPreferences(serialized: string | null): UiPreferences {
  if (!serialized) return { ...DEFAULT_UI_PREFERENCES };

  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return { ...DEFAULT_UI_PREFERENCES };

    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_UI_PREFERENCES.theme,
      fontSize: isFontSize(value.fontSize)
        ? value.fontSize
        : DEFAULT_UI_PREFERENCES.fontSize,
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

export function loadUiPreferences(
  storage?: UiPreferenceStorage,
): UiPreferences {
  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return parseUiPreferences(target?.getItem(UI_PREFERENCES_STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

export function saveUiPreferences(
  preferences: UiPreferences,
  storage?: UiPreferenceStorage,
): boolean {
  try {
    const target =
      storage ?? (typeof window === "undefined" ? null : window.localStorage);
    if (!target) return false;
    target.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function applyUiPreferences(
  preferences: UiPreferences,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = preferences.theme;
  root.dataset.fontSize = preferences.fontSize;
  root.style.colorScheme = preferences.theme;

  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      preferences.theme === "dark" ? "#0c1222" : "#f5f5f1",
    );
}
