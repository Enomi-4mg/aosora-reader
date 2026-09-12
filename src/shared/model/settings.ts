/**
 * 表示設定(要件 §4.7)とテーマ(§4.8)。
 *
 * Document Model は writingMode に依存しない(要件 §4.4)。設定は Renderer の
 * 描画パラメータでしかなく、本文の構造にも位置情報にも影響しない。
 */

export type WritingMode = 'vertical' | 'horizontal'
export type ReadingMode = 'pagination' | 'scroll'
export type ThemeName = 'light' | 'sepia' | 'dark' | 'system'
export type LibraryViewMode = 'grid' | 'list'
export type LibrarySortKey = 'recent' | 'title' | 'author' | 'added' | 'progress'
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
  columns: ColumnCount
  /** ページ送りのアニメーション(ms)。0 で無効。 */
  pageTransitionMs: number
  /** OS TTS の voiceURI。空文字は OS 既定。 */
  ttsVoice: string
  ttsRate: number
  ttsPitch: number
  ttsVolume: number
  /** 読了時間推定の初期値兼、実測値が無い場合の値。 */
  estimatedCharsPerMinute: number
}

export interface AppSettings {
  theme: ThemeName
  libraryView: LibraryViewMode
  librarySort: LibrarySortKey
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  libraryView: 'grid',
  librarySort: 'recent'
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
  columns: 1,
  pageTransitionMs: 180,
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  estimatedCharsPerMinute: 500
}

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 48
export const FONT_SIZE_STEP = 2

/**
 * 行間の下限。1.2 まで詰められると、ルビが隣の行に接触して読めなくなる
 * (本文18px + ルビ9px = 27px に対し、行送りが 21.6px しか無い)。
 */
export const LINE_HEIGHT_MIN = 1.5
export const LINE_HEIGHT_MAX = 3.2

/** 保存値が壊れていてもアプリを止めない(要件 §9)。 */
export function normalizeSettings(raw: Partial<ReaderSettings> | null): ReaderSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  return {
    ...s,
    fontFamily: str(s.fontFamily, DEFAULT_SETTINGS.fontFamily),
    fontSize: clamp(num(s.fontSize, DEFAULT_SETTINGS.fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX),
    fontWeight: clamp(num(s.fontWeight, 400), 100, 900),
    lineHeight: clamp(num(s.lineHeight, 1.9), LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
    letterSpacing: clamp(num(s.letterSpacing, 0.05), -0.1, 0.6),
    pageMargin: clamp(num(s.pageMargin, 56), 0, 200),
    paragraphSpacing: clamp(num(s.paragraphSpacing, 0), 0, 4),
    columns: s.columns === 2 ? 2 : 1,
    writingMode: s.writingMode === 'horizontal' ? 'horizontal' : 'vertical',
    readingMode: s.readingMode === 'scroll' ? 'scroll' : 'pagination',
    pageTransitionMs: clamp(num(s.pageTransitionMs, 180), 0, 600),
    ttsVoice: typeof s.ttsVoice === 'string' ? s.ttsVoice : '',
    ttsRate: clamp(num(s.ttsRate, 1), 0.5, 2),
    ttsPitch: clamp(num(s.ttsPitch, 1), 0.5, 2),
    ttsVolume: clamp(num(s.ttsVolume, 1), 0, 1),
    estimatedCharsPerMinute: clamp(num(s.estimatedCharsPerMinute, 500), 100, 2000)
  }
}

export function normalizeAppSettings(raw: Partial<AppSettings> | null): AppSettings {
  const s = { ...DEFAULT_APP_SETTINGS, ...(raw ?? {}) }
  return {
    theme: (['light', 'sepia', 'dark', 'system'] as const).includes(s.theme) ? s.theme : 'system',
    libraryView: s.libraryView === 'list' ? 'list' : 'grid',
    librarySort: (['recent', 'title', 'author', 'added', 'progress'] as const).includes(s.librarySort)
      ? s.librarySort
      : 'recent'
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
