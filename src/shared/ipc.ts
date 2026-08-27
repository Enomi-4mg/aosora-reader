/**
 * main ↔ renderer の契約。
 * renderer は fs にも SQLite にも直接触らず、必ずこの型付き API を経由する。
 */
import type { Book, BookSummary } from './model/document'
import type { TextPosition } from './model/position'
import type { ReaderSettings } from './model/settings'

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

export interface OpenBookResult {
  book: Book
  progress: ReadingProgressDto | null
}

export interface AozoraApi {
  listBooks(): Promise<BookSummary[]>
  importDialog(): Promise<ImportOutcome[]>
  importPaths(paths: string[]): Promise<ImportOutcome[]>
  importWithEncoding(path: string, encoding: string): Promise<ImportOutcome>
  deleteBook(bookId: string, keepUserData: boolean): Promise<void>

  openBook(bookId: string): Promise<OpenBookResult | null>
  saveProgress(p: ReadingProgressDto): Promise<void>
  searchBook(bookId: string, query: string): Promise<SearchResultDto>

  getSettings(): Promise<ReaderSettings>
  saveSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings>
}

/** ipcRenderer.invoke のチャネル名。AozoraApi のキーと一対一。 */
export const IPC_CHANNELS = [
  'listBooks',
  'importDialog',
  'importPaths',
  'importWithEncoding',
  'deleteBook',
  'openBook',
  'saveProgress',
  'searchBook',
  'getSettings',
  'saveSettings'
] as const satisfies ReadonlyArray<keyof AozoraApi>

export type IpcChannel = (typeof IPC_CHANNELS)[number]
