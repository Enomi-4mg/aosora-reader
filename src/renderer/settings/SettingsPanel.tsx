/** 表示設定(要件 §4.7 / §14 Appearance・Reading)。変更は即座に本文へ反映される。 */
import { type JSX } from 'react'
import { useSettingsStore } from '../state/useSettingsStore'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  type ReaderSettings,
  type ThemeName
} from '@shared/model/settings'

const FONTS: Array<[string, string]> = [
  ['"Hiragino Mincho ProN", "YuMincho", "Noto Serif JP", serif', '明朝体'],
  ['"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif', 'ゴシック体'],
  ['"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif', '丸ゴシック']
]

const THEMES: Array<[ThemeName, string]> = [
  ['system', 'システムに合わせる'],
  ['light', 'ライト'],
  ['sepia', 'セピア'],
  ['dark', 'ダーク']
]

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, patch } = useSettingsStore()
  const set = <K extends keyof ReaderSettings>(k: K, v: ReaderSettings[K]) =>
    void patch({ [k]: v } as Partial<ReaderSettings>)

  return (
    <div className="settings-overlay" role="dialog" aria-label="表示設定">
      <div className="settings-head">
        <h2>表示設定</h2>
        <button className="ghost" onClick={onClose} aria-label="設定を閉じる">×</button>
      </div>

      <section>
        <h3>組み方</h3>
        <div className="seg" role="group" aria-label="書字方向">
          <button
            className={settings.writingMode === 'vertical' ? 'on' : ''}
            aria-pressed={settings.writingMode === 'vertical'}
            onClick={() => set('writingMode', 'vertical')}
          >
            縦書き
          </button>
          <button
            className={settings.writingMode === 'horizontal' ? 'on' : ''}
            aria-pressed={settings.writingMode === 'horizontal'}
            onClick={() => set('writingMode', 'horizontal')}
          >
            横書き
          </button>
        </div>
        <div className="seg" role="group" aria-label="表示モード">
          <button
            className={settings.readingMode === 'pagination' ? 'on' : ''}
            aria-pressed={settings.readingMode === 'pagination'}
            onClick={() => set('readingMode', 'pagination')}
          >
            ページ送り
          </button>
          <button
            className={settings.readingMode === 'scroll' ? 'on' : ''}
            aria-pressed={settings.readingMode === 'scroll'}
            onClick={() => set('readingMode', 'scroll')}
          >
            スクロール
          </button>
        </div>
        <div className="seg" role="group" aria-label="段組み">
          <button
            className={settings.columns === 1 ? 'on' : ''}
            aria-pressed={settings.columns === 1}
            onClick={() => set('columns', 1)}
          >
            1段
          </button>
          <button
            className={settings.columns === 2 ? 'on' : ''}
            aria-pressed={settings.columns === 2}
            onClick={() => set('columns', 2)}
          >
            2段
          </button>
        </div>
      </section>

      <section>
        <h3>文字</h3>
        <label>
          書体
          <select
            value={settings.fontFamily}
            onChange={(e) => set('fontFamily', e.target.value)}
          >
            {FONTS.map(([v, label]) => (
              <option key={label} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <Range
          label="文字サイズ"
          value={settings.fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          suffix="px"
          onChange={(v) => set('fontSize', v)}
        />
        <Range
          label="行間"
          value={settings.lineHeight}
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.05}
          onChange={(v) => set('lineHeight', v)}
        />
        <Range
          label="字間"
          value={settings.letterSpacing}
          min={-0.05}
          max={0.5}
          step={0.01}
          suffix="em"
          onChange={(v) => set('letterSpacing', v)}
        />
        <Range
          label="余白"
          value={settings.pageMargin}
          min={0}
          max={160}
          step={4}
          suffix="px"
          onChange={(v) => set('pageMargin', v)}
        />
      </section>

      <section>
        <h3>テーマ</h3>
        <div className="theme-row" role="group" aria-label="テーマ">
          {THEMES.map(([v, label]) => (
            <button
              key={v}
              className={settings.theme === v ? 'on' : ''}
              aria-pressed={settings.theme === v}
              onClick={() => set('theme', v)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Range({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{step < 1 ? value.toFixed(2) : value}{suffix}</output>
    </label>
  )
}
