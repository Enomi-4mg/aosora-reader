/**
 * Electron main プロセス。fs / SQLite / パーサーはすべてこちら側に閉じる。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, shell } from 'electron'
import { join } from 'node:path'
import { normalizeSettings, type ReaderSettings } from '@shared/model/settings'
import type { AozoraIpcApi, ImportOutcome, OpenBookResult } from '@shared/ipc'
import { openDatabase, type Db } from './db/connection'
import { BookRepository } from './repositories/BookRepository'
import { ProgressRepository } from './repositories/ProgressRepository'
import { SettingsRepository } from './repositories/SettingsRepository'
import { AnnotationRepository } from './repositories/AnnotationRepository'
import { ReadingSessionRepository } from './repositories/ReadingSessionRepository'
import { ImportService, type ImportOutcome as ServiceOutcome } from './services/ImportService'
import { SearchService } from './services/SearchService'
import { AozoraCatalogService } from './services/AozoraCatalogService'
import type { SupportedEncoding } from './import/decode'
import { WiktionaryProvider } from './services/DictionaryService'

let db: Db
let books: BookRepository
let progress: ProgressRepository
let settings: SettingsRepository
let importer: ImportService
let search: SearchService
let catalog: AozoraCatalogService
let annotations: AnnotationRepository
let sessions: ReadingSessionRepository
let dictionary: WiktionaryProvider

function initServices(): void {
  db = openDatabase(join(app.getPath('userData'), 'library.db'))
  books = new BookRepository(db)
  progress = new ProgressRepository(db)
  settings = new SettingsRepository(db)
  importer = new ImportService(books)
  search = new SearchService(db)
  catalog = new AozoraCatalogService(importer, async (url) => {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`青空文庫から取得できませんでした (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  })
  annotations = new AnnotationRepository(db)
  sessions = new ReadingSessionRepository(db)
  dictionary = new WiktionaryProvider(async (url) => {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`辞書を検索できませんでした (${response.status})`)
    return response.json()
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#fbfbfa',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 外部リンクは既定ブラウザで開く(アプリ内で任意のページを開かせない)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // setWindowOpenHandler は window.open しか止めない。
  // ドロップされたファイルやリンクによるトップレベル遷移もここで塞ぐ。
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.ELECTRON_RENDERER_URL
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Service の結果を renderer 向けの DTO に落とす(ParseIssue は外に出さない)。 */
function toDto(o: ServiceOutcome): ImportOutcome {
  switch (o.status) {
    case 'imported':
    case 'restored':
      return {
        status: o.status,
        bookId: o.bookId,
        title: o.title,
        issueCount: o.issues.length
      }
    case 'needs-encoding':
      return { status: o.status, path: o.path, candidates: o.candidates }
    default:
      return o
  }
}

const handlers: AozoraIpcApi = {
  async listBooks() {
    return books.listSummaries()
  },

  async importDialog() {
    const r = await dialog.showOpenDialog({
      title: '青空文庫のファイルを選択',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '青空文庫テキスト', extensions: ['txt', 'zip'] },
        { name: 'すべてのファイル', extensions: ['*'] }
      ]
    })
    if (r.canceled) return []
    return (await importer.importMany(r.filePaths)).map(toDto)
  },

  async importPaths(paths: string[]) {
    return (await importer.importMany(paths)).map(toDto)
  },

  async importWithEncoding(path: string, encoding: string) {
    return toDto(await importer.importFile(path, encoding as SupportedEncoding))
  },

  async searchAozoraCatalog(query: string) {
    return catalog.search(query)
  },

  async downloadAozoraWork(workId: string) {
    return toDto(await catalog.download(workId))
  },

  async deleteBook(bookId: string, keepUserData: boolean) {
    books.delete(bookId, keepUserData)
  },

  async openBook(bookId: string): Promise<OpenBookResult | null> {
    const book = books.load(bookId)
    if (!book) return null
    return { book, progress: progress.get(bookId) }
  },

  async saveProgress(p) {
    progress.save({
      bookId: p.bookId,
      position: p.position,
      percentage: p.percentage,
      lastOpenedAt: p.lastOpenedAt,
      completed: p.completed
    })
  },

  async searchBook(bookId: string, query: string) {
    return search.searchBook(bookId, query)
  },

  async listAnnotations(bookId) {
    return annotations.list(bookId)
  },

  async addBookmark(bookId, position, label) {
    return annotations.addBookmark(bookId, position, label)
  },

  async updateBookmark(id, label) {
    annotations.updateBookmark(id, label)
  },

  async deleteBookmark(id) {
    annotations.deleteBookmark(id)
  },

  async addHighlight(bookId, range, selectedText, color) {
    return annotations.addHighlight(bookId, range, selectedText, color)
  },

  async deleteHighlight(id) {
    annotations.deleteHighlight(id)
  },

  async saveNote(input) {
    return annotations.saveNote(input)
  },

  async deleteNote(id) {
    annotations.deleteNote(id)
  },

  async startReadingSession(bookId, position, percentage) {
    return sessions.start(bookId, position, percentage)
  },

  async closeReadingSession(id, position, percentage, charactersRead) {
    sessions.close(id, position, percentage, charactersRead)
  },

  async getReadingStats(bookId, fallbackCpm) {
    return sessions.stats(bookId, fallbackCpm)
  },

  async searchDictionary(term) {
    try {
      return await dictionary.search(term)
    } catch (error) {
      console.error('[dictionary]', error)
      return { term, definitions: [], source: '日本語版Wiktionary' }
    }
  },

  async copyText(text) {
    clipboard.writeText(text)
  },

  async setFullscreen(enabled) {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    win.setFullScreen(enabled)
    return win.isFullScreen()
  },

  async getFullscreen() {
    return BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false
  },

  async getDataLocation() {
    return app.getPath('userData')
  },

  async revealDataLocation() {
    await shell.openPath(app.getPath('userData'))
  },

  async getSettings(): Promise<ReaderSettings> {
    return normalizeSettings(settings.getAll() as Partial<ReaderSettings>)
  },

  async saveSettings(patch): Promise<ReaderSettings> {
    const merged = normalizeSettings({
      ...(settings.getAll() as Partial<ReaderSettings>),
      ...patch
    })
    settings.setMany(merged as unknown as Record<string, unknown>)
    return merged
  }
}

function registerIpc(): void {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, async (_e, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args)
      } catch (e) {
        // DB 書き込み失敗などでアプリを落とさない(要件 §9)。
        // 詳細は開発ログへ、renderer には短いメッセージだけ返す。
        console.error(`[ipc:${name}]`, e)
        throw new Error(
          e instanceof Error ? e.message : '処理中にエラーが発生しました。'
        )
      }
    })
  }
}

app.whenReady().then(() => {
  initServices()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
