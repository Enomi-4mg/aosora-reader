/**
 * main ↔ renderer の契約。
 * renderer は fs にも SQLite にも直接触らず、必ずこの型付き API を経由する。
 */
import type { Book, BookSummary } from './model/document'
import type { TextPosition } from './model/position'
import type { AppSettings, ReaderSettings } from './model/settings'
import type {
  AnnotationBundle,
  Bookmark,
  DictionaryResult,
  Highlight,
  Note,
  ReadingStats
} from './model/annotations'
import type { TextRange } from './model/position'
import type { HighlightColor } from './model/settings'

/**
 * 挿絵を配信するカスタムスキーム。
 *
 * 画像は IPC ではなくこのスキーム経由で渡す。URL の組み立てを main と renderer で
 * 二重に書くと片方だけ直して壊れるので、両者ともこの定数と関数だけを使う。
 */
export const IMAGE_SCHEME = 'aozora-img'

/** 挿絵の URL。実在するかは問わない(無ければ renderer 側が代替表示に落とす)。 */
export function bookImageUrl(bookId: string, fileName: string): string {
  return `${IMAGE_SCHEME}://${bookId}/${encodeURIComponent(fileName)}`
}

export interface ImportIssueSummary {
  kind: string
  message: string
}

export type ImportOutcome =
  | { status: 'imported'; bookId: string; title: string; issueCount: number }
  | { status: 'restored'; bookId: string; title: string; issueCount: number }
  | { status: 'duplicate'; bookId: string; title: string }
  | { status: 'needs-encoding'; path: string; candidates: string[] }
  | { status: 'error'; path: string; message: string }

export interface ReadingProgressDto {
  bookId: string
  position: TextPosition
  percentage: number
  lastOpenedAt: string
  completed: boolean
}

export interface SearchMatchDto {
  position: TextPosition
  range: { start: TextPosition; end: TextPosition }
  context: string
  contextOffset: number
  chapterId: string
}

export interface SearchResultDto {
  query: string
  count: number
  truncated: boolean
  matches: SearchMatchDto[]
}

/**
 * 本文を作り直したときに、位置情報をどれだけ動かしたか。
 *
 * 黙って動かすと「栞が別の場所を指している」としか見えないので、
 * 読み手に見せるために外へ出す。
 */
export interface ReparseReport {
  /** 新しい本文に合わせて位置をずらした件数(栞・ハイライト・メモ・読書位置)。 */
  movedPositions: number
  /** 対応する場所が見つからず、付け替えられなかった件数。 */
  droppedPositions: number
}

export interface OpenBookResult {
  book: Book
  progress: ReadingProgressDto | null
  /**
   * パーサーが更新されているのに本文を作り直せない本。
   * 原文を保存していなかった(この仕組みより前に取り込んだ)ので、
   * 取り込み直すまで古い解析結果のまま表示される。
   */
  needsReimport: boolean
  /** 今回の open で本文を作り直したときだけ入る。 */
  reparsed: ReparseReport | null
}

export interface AozoraCatalogWork {
  id: string
  title: string
  titleKana: string
  author: string
  publishedAt: string
  cardUrl: string
}

export interface CustomFontDto {
  id: string
  displayName: string
  fileName: string
  format: 'ttf' | 'otf' | 'woff' | 'woff2'
  error?: string
}

export interface AozoraIpcApi {
  listBooks(): Promise<BookSummary[]>
  importDialog(): Promise<ImportOutcome[]>
  importPaths(paths: string[]): Promise<ImportOutcome[]>
  importWithEncoding(path: string, encoding: string): Promise<ImportOutcome>
  searchAozoraCatalog(query: string): Promise<AozoraCatalogWork[]>
  downloadAozoraWork(workId: string): Promise<ImportOutcome>
  deleteBook(bookId: string, keepUserData: boolean): Promise<void>

  openBook(bookId: string): Promise<OpenBookResult | null>
  saveProgress(p: ReadingProgressDto): Promise<void>
  searchBook(bookId: string, query: string): Promise<SearchResultDto>

  listAnnotations(bookId: string): Promise<AnnotationBundle>
  addBookmark(bookId: string, position: TextPosition, label: string): Promise<Bookmark>
  updateBookmark(id: string, label: string): Promise<void>
  deleteBookmark(id: string): Promise<void>
  addHighlight(bookId: string, range: TextRange, selectedText: string, color: HighlightColor): Promise<Highlight>
  deleteHighlight(id: string): Promise<void>
  saveNote(input: {
    id?: string
    bookId: string
    highlightId?: string | null
    range?: TextRange | null
    position?: TextPosition | null
    text: string
  }): Promise<Note>
  deleteNote(id: string): Promise<void>

  startReadingSession(bookId: string, position: TextPosition, percentage: number): Promise<string>
  closeReadingSession(id: string, position: TextPosition, percentage: number, charactersRead: number): Promise<void>
  getReadingStats(bookId: string, fallbackCpm: number): Promise<ReadingStats>
  searchDictionary(term: string): Promise<DictionaryResult>
  copyText(text: string): Promise<void>
  setFullscreen(enabled: boolean): Promise<boolean>
  getFullscreen(): Promise<boolean>
  getDataLocation(): Promise<string>
  revealDataLocation(): Promise<void>

  getAppSettings(): Promise<AppSettings>
  saveAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  resetAppSettings(): Promise<AppSettings>
  getReaderSettings(): Promise<ReaderSettings>
  saveReaderSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings>
  resetReaderSettings(): Promise<ReaderSettings>
  importFonts(): Promise<CustomFontDto[]>
  listFonts(): Promise<CustomFontDto[]>
  renameFont(id: string, displayName: string): Promise<CustomFontDto[]>
  deleteFont(id: string): Promise<CustomFontDto[]>
  getFontData(id: string): Promise<Uint8Array>

  /**
   * 開いたときに本文の作り直しが走るか。
   * 待たせる理由を先に出すためだけのもので、開く処理には影響しない。
   */
  willReparse(bookId: string): Promise<boolean>

  /** 動いているアプリの版。 */
  getAppVersion(): Promise<string>
  /**
   * 更新の有無。設定が 'on' のときだけ外へ出る。
   * 前回の確認から間が空いていなければ、覚えている結果をそのまま返す。
   */
  checkForUpdate(): Promise<UpdateStatus>
}

/**
 * 更新確認の結果。
 * 'unavailable' は「確認できなかった」で、失敗ではない。圏外でも、
 * まだ一度もリリースを公開していなくても、ここに落ちる。
 */
export type UpdateStatus =
  | { state: 'disabled' }
  | { state: 'unavailable' }
  | { state: 'current'; version: string }
  | { state: 'available'; version: string; url: string }

export interface AozoraApi extends AozoraIpcApi {
  /** Electron が保持する File の実パスを preload 内で安全に解決する。 */
  getPathForFile(file: File): string
  /**
   * 動作中の OS。ショートカットの表記とタイトルバーの余白が OS で変わる。
   * IPC ではなく preload が同期で渡すので、最初の描画から確定している。
   */
  platform: NodeJS.Platform
}

/** ipcRenderer.invoke のチャネル名。AozoraIpcApi のキーと一対一。 */
export const IPC_CHANNELS = [
  'listBooks',
  'importDialog',
  'importPaths',
  'importWithEncoding',
  'searchAozoraCatalog',
  'downloadAozoraWork',
  'deleteBook',
  'openBook',
  'saveProgress',
  'searchBook',
  'listAnnotations',
  'addBookmark',
  'updateBookmark',
  'deleteBookmark',
  'addHighlight',
  'deleteHighlight',
  'saveNote',
  'deleteNote',
  'startReadingSession',
  'closeReadingSession',
  'getReadingStats',
  'searchDictionary',
  'copyText',
  'setFullscreen',
  'getFullscreen',
  'getDataLocation',
  'revealDataLocation',
  'getAppSettings',
  'saveAppSettings',
  'resetAppSettings',
  'getReaderSettings',
  'saveReaderSettings',
  'resetReaderSettings',
  'importFonts',
  'listFonts',
  'renameFont',
  'deleteFont',
  'getFontData',
  'willReparse',
  'getAppVersion',
  'checkForUpdate'
] as const satisfies ReadonlyArray<keyof AozoraIpcApi>

export type IpcChannel = (typeof IPC_CHANNELS)[number]

/**
 * API を足してチャネル一覧に書き忘れると、ここで型エラーになる。
 * satisfies だけでは「並んでいるものが有効なキーか」しか見ないため、
 * 逆向き(すべてのキーが並んでいるか)も押さえておく。
 * 書き忘れると preload が関数を生やさず、renderer 側で undefined になる。
 */
type AssertNever<T extends never> = T
export type _AllChannelsListed = AssertNever<Exclude<keyof AozoraIpcApi, IpcChannel>>
