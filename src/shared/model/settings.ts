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

/**
 * 組み込みの書体。値はそのまま CSS の font-family に入る。
 *
 * Windows に Hiragino は無いので、游書体(Windows 8.1 以降は標準)と MS 書体まで
 * 並べて、どの OS でも明朝は明朝、ゴシックはゴシックに落ちるようにする。
 * 丸ゴシックだけは Windows に相当する標準書体が無く、ゴシックへ落ちる。
 */
export const FONT_STACKS = {
  mincho:
    '"Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "Noto Serif JP", "MS PMincho", serif',
  gothic: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif',
  maruGothic: '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif'
} as const

/**
 * 古い版が保存した書体を、今の組み込み書体へ読み替える。
 *
 * 設定画面の <select> は値を完全一致で照合する。組み込み書体に後からフォントを
 * 足すと、古い文字列を保存しているユーザーの選択がどの選択肢とも一致しなくなり、
 * 「現在の書体が選ばれていない」状態で開いてしまう。文字列を更新して拾い直す。
 */
const LEGACY_FONT_STACKS = new Map<string, string>([
  // 明朝体は "Yu Mincho" を足したときにも一度変わっている。
  ['"Hiragino Mincho ProN", "YuMincho", "Noto Serif JP", serif', FONT_STACKS.mincho],
  [
    '"Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "Noto Serif JP", serif',
    FONT_STACKS.mincho
  ],
  ['"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif', FONT_STACKS.gothic],
  ['"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif', FONT_STACKS.maruGothic]
])

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: FONT_STACKS.mincho,
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
    fontFamily: upgradeFontStack(str(s.fontFamily, DEFAULT_SETTINGS.fontFamily)),
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

function upgradeFontStack(family: string): string {
  return LEGACY_FONT_STACKS.get(family) ?? family
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : fallback
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
