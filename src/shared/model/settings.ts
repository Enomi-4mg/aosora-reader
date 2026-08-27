/**
 * 表示設定(要件 §4.7)とテーマ(§4.8)。
 *
 * Document Model は writingMode に依存しない(要件 §4.4)。設定は Renderer の
 * 描画パラメータでしかなく、本文の構造にも位置情報にも影響しない。
 */

export type WritingMode = 'vertical' | 'horizontal'
export type ReadingMode = 'pagination' | 'scroll'
export type ThemeName = 'light' | 'sepia' | 'dark' | 'system'
export type ColumnCount = 1 | 2

/** ハイライト色は固定の色名で管理し、実表示色はテーマ側で決める(要件 §5.2)。 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red'
export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red']

export interface ReaderSettings {
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  /** 本文の余白(px)。 */
  pageMargin: number
  /** 段落間の空き(em)。 */
  paragraphSpacing: number
  writingMode: WritingMode
  readingMode: ReadingMode
  theme: ThemeName
  columns: ColumnCount
  /** ページ送りのアニメーション(ms)。0 で無効。 */
  pageTransitionMs: number
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily:
    '"Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "Noto Serif JP", serif',
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1.9,
  letterSpacing: 0.05,
  pageMargin: 56,
  paragraphSpacing: 0,
  writingMode: 'vertical',
  readingMode: 'pagination',
  theme: 'system',
  columns: 1,
  pageTransitionMs: 180
}

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 48
export const FONT_SIZE_STEP = 2

/** 保存値が壊れていてもアプリを止めない(要件 §9)。 */
export function normalizeSettings(raw: Partial<ReaderSettings> | null): ReaderSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  return {
    ...s,
    fontSize: clamp(num(s.fontSize, DEFAULT_SETTINGS.fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX),
    fontWeight: clamp(num(s.fontWeight, 400), 100, 900),
    lineHeight: clamp(num(s.lineHeight, 1.9), 1.2, 3.2),
    letterSpacing: clamp(num(s.letterSpacing, 0.05), -0.1, 0.6),
    pageMargin: clamp(num(s.pageMargin, 56), 0, 200),
    paragraphSpacing: clamp(num(s.paragraphSpacing, 0), 0, 4),
    columns: s.columns === 2 ? 2 : 1,
    writingMode: s.writingMode === 'horizontal' ? 'horizontal' : 'vertical',
    readingMode: s.readingMode === 'scroll' ? 'scroll' : 'pagination',
    theme: (['light', 'sepia', 'dark', 'system'] as const).includes(s.theme)
      ? s.theme
      : 'system',
    pageTransitionMs: clamp(num(s.pageTransitionMs, 180), 0, 600)
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
