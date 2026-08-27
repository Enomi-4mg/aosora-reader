/** 表示設定(要件 §4.7 / §14 Appearance・Reading)。変更は即座に本文へ反映される。 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useSettingsStore } from '../state/useSettingsStore'
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  type ReaderSettings,
  type ThemeName
} from '@shared/model/settings'

// 先頭は必ず既定値と同一文字列にする。ずれると初回起動時に
// <select> がどの <option> とも一致せず、現在の書体を表示できない。
const FONTS: Array<[string, string]> = [
  [DEFAULT_SETTINGS.fontFamily, '明朝体'],
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
  const { settings, patch, reset, error } = useSettingsStore()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [dataLocation, setDataLocation] = useState('')
  const set = <K extends keyof ReaderSettings>(k: K, v: ReaderSettings[K]) =>
    void patch({ [k]: v } as Partial<ReaderSettings>)

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = (): void => setVoices(window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('ja')))
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => { void window.aozora.getDataLocation().then(setDataLocation) }, [])

  return (
    <div className="settings-overlay" role="dialog" aria-label="表示設定">
      <div className="settings-head">
        <h2>表示設定</h2>
        <button className="ghost" onClick={onClose} aria-label="設定を閉じる">×</button>
      </div>

      {error && <p className="panel-error" role="alert">{error}</p>}

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
        {/* 段組みは multicolumn を使う横書きのみ。縦書きは block progression で送る。 */}
        <div className="seg" role="group" aria-label="段組み">
          <button
            className={settings.columns === 1 ? 'on' : ''}
            aria-pressed={settings.columns === 1}
            disabled={settings.writingMode === 'vertical'}
            onClick={() => set('columns', 1)}
          >
            1段
          </button>
          <button
            className={settings.columns === 2 ? 'on' : ''}
            aria-pressed={settings.columns === 2}
            disabled={settings.writingMode === 'vertical'}
            onClick={() => set('columns', 2)}
          >
            2段
          </button>
        </div>
        {settings.writingMode === 'vertical' && (
          <p className="muted small">段組みは横書きのときだけ使えます。</p>
        )}
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
          label="文字の太さ"
          value={settings.fontWeight}
          min={300}
          max={700}
          step={100}
          onChange={(v) => set('fontWeight', v)}
        />
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
        <Range
          label="段落間隔"
          value={settings.paragraphSpacing}
          min={0}
          max={2}
          step={0.1}
          suffix="em"
          onChange={(v) => set('paragraphSpacing', v)}
        />
      </section>

      <section>
        <h3>テーマ</h3>
        <div className="theme-tabs" role="tablist" aria-label="テーマ">
          {THEMES.map(([v, label]) => (
            <button
              key={v}
              role="tab"
              className={settings.theme === v ? 'on' : ''}
              aria-selected={settings.theme === v}
              onClick={() => set('theme', v)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>読み上げ</h3>
        <label>
          声
          <select value={settings.ttsVoice} onChange={(event) => set('ttsVoice', event.target.value)}>
            <option value="">システム標準</option>
            {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
          </select>
        </label>
        <Range label="速さ" value={settings.ttsRate} min={0.5} max={2} step={0.1}
          onChange={(value) => set('ttsRate', value)} />
        <Range label="高さ" value={settings.ttsPitch} min={0.5} max={2} step={0.1}
          onChange={(value) => set('ttsPitch', value)} />
        <Range label="音量" value={settings.ttsVolume} min={0} max={1} step={0.1}
          onChange={(value) => set('ttsVolume', value)} />
      </section>

      <section>
        <h3>読了時間</h3>
        <Range label="文字/分" value={settings.estimatedCharsPerMinute} min={100} max={1200} step={50}
          onChange={(value) => set('estimatedCharsPerMinute', value)} />
      </section>

      <section>
        <h3>詳細</h3>
        <p className="data-location" title={dataLocation}>{dataLocation}</p>
        <div className="settings-actions">
          <button onClick={() => void window.aozora.revealDataLocation()}>保存場所を開く</button>
          <button onClick={() => {
            if (window.confirm('表示と読み上げの設定を初期値に戻しますか？')) void reset()
          }}>設定を初期化</button>
        </div>
      </section>
    </div>
  )
}

/**
 * スライダーのつまみは即座に動かしつつ、確定は間引く。
 *
 * range の onChange はドラッグ中ずっと発火する。そのまま設定を反映すると
 * 1ドラッグで数百回の永続化と再ページングが走るため、表示用の値は
 * ローカルに持ち、実際の反映だけを debounce する。
 */
const COMMIT_DELAY_MS = 120

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
  const [live, setLive] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef(false)

  // 外から値が変わったとき(初期化・設定の初期化・別経路のフォントサイズ変更)は追従する。
  // 自分の debounce 待ちのあいだは、確定前の値を巻き戻さない。
  useEffect(() => {
    if (!pending.current) setLive(value)
  }, [value])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const commit = (next: number): void => {
    setLive(next)
    pending.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      pending.current = false
      onChange(next)
    }, COMMIT_DELAY_MS)
  }

  return (
    <label className="range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={live}
        onChange={(e) => commit(Number(e.target.value))}
      />
      <output>{step < 1 ? live.toFixed(2) : live}{suffix}</output>
    </label>
  )
}
