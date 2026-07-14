import {
  Check,
  Moon,
  Palette,
  RotateCcw,
  Settings2,
  Sun,
  Type,
} from "lucide-react";
import {
  DEFAULT_UI_PREFERENCES,
  type UiFontSize,
  type UiPreferences,
  type UiTheme,
} from "../lib/uiPreferences";

interface SettingsViewProps {
  preferences: UiPreferences;
  onChange: (preferences: UiPreferences) => void;
}

const THEME_OPTIONS: Array<{
  id: UiTheme;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    id: "light",
    label: "淺色",
    description: "明亮、清楚，適合日間環境",
    icon: Sun,
  },
  {
    id: "dark",
    label: "深色",
    description: "降低亮度，適合夜間使用",
    icon: Moon,
  },
];

const FONT_SIZE_OPTIONS: Array<{
  id: UiFontSize;
  label: string;
  percent: string;
}> = [
  { id: "xs", label: "最小", percent: "100%" },
  { id: "sm", label: "小", percent: "112.5%" },
  { id: "md", label: "中", percent: "125%" },
  { id: "lg", label: "大", percent: "137.5%" },
  { id: "xl", label: "最大", percent: "150%" },
];

export function SettingsView({
  preferences,
  onChange,
}: SettingsViewProps) {
  const isDefault =
    preferences.theme === DEFAULT_UI_PREFERENCES.theme &&
    preferences.fontSize === DEFAULT_UI_PREFERENCES.fontSize;

  return (
    <section className="settings-view">
      <div className="page-heading settings-heading">
        <div>
          <p className="eyebrow"><Settings2 size={14} /> APPEARANCE</p>
          <h1>閱讀起來，剛剛好。</h1>
          <p>選擇舒服的顏色與字級，變更會立即套用並保存在這台裝置。</p>
        </div>
        <div className="settings-heading-mark" aria-hidden="true">
          <Palette size={31} />
          <span>Aa</span>
        </div>
      </div>

      <div className="settings-stack">
        <article className="settings-card">
          <div className="settings-card-heading">
            <span><Palette size={19} /></span>
            <div>
              <h2>顯示模式</h2>
              <p>依照環境切換 OshiClip 介面的明暗外觀。</p>
            </div>
          </div>

          <div className="theme-options" role="group" aria-label="顯示模式">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = preferences.theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={selected ? "theme-option selected" : "theme-option"}
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({ ...preferences, theme: option.id })
                  }
                >
                  <span className={`theme-preview ${option.id}`} aria-hidden="true">
                    <i />
                    <b><em /><em /><em /></b>
                  </span>
                  <span className="theme-option-copy">
                    <Icon size={18} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  </span>
                  <span className="choice-check" aria-hidden="true">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <span><Type size={19} /></span>
            <div>
              <h2>字體大小</h2>
              <p>現有介面字級保留為「最小」，其他級距會等比例放大所有文字。</p>
            </div>
          </div>

          <div className="font-size-options" role="group" aria-label="字體大小">
            {FONT_SIZE_OPTIONS.map((option) => {
              const selected = preferences.fontSize === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-size={option.id}
                  className={selected ? "font-size-option selected" : "font-size-option"}
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({ ...preferences, fontSize: option.id })
                  }
                >
                  <span className="font-sample" aria-hidden="true">字</span>
                  <strong>{option.label}</strong>
                  <small>{option.percent}</small>
                  <span className="choice-check" aria-hidden="true">
                    {selected && <Check size={14} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="font-preview" aria-live="polite">
            <Type size={20} />
            <div>
              <span>目前預覽</span>
              <strong>把喜歡的直播片段，好好收藏起來。</strong>
              <small>繁體中文、English 與 00:42:18 都會一起調整。</small>
            </div>
          </div>
        </article>

        <div className="settings-footer">
          <p>設定只儲存在這台裝置，不會影響下載內容或檔案。</p>
          <button
            type="button"
            className="button light"
            disabled={isDefault}
            onClick={() => onChange({ ...DEFAULT_UI_PREFERENCES })}
          >
            <RotateCcw size={15} /> 恢復預設
          </button>
        </div>
      </div>
    </section>
  );
}
