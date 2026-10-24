/**
 * Electron main プロセス。fs / SQLite / パーサーはすべてこちら側に閉じる。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { appSettingsFromRaw, appSettingsToRaw, DEFAULT_APP_SETTINGS, DEFAULT_SETTINGS, normalizeAppSettings, normalizeSettings, type AppSettings, type ReaderSettings } from '@shared/model/settings'
import type { AozoraIpcApi, ImportOutcome, OpenBookResult } from '@shared/ipc'
import { openDatabase, SchemaTooNewError, type Db } from './db/connection'
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
import { CustomFontService } from './services/CustomFontService'
import { BookImageService } from './services/BookImageService'
import { ReparseService } from './services/ReparseService'
import { UpdateService, textFetcher } from './services/UpdateService'
import { IMAGE_SCHEME } from '@shared/ipc'

/**
 * ユーザーデータの置き場。本棚(library.db)・挿絵・追加フォントが全部ここに入る。
 *
 * 既定値は `app.getName()` 由来で、それは package.json の `productName` があれば
 * そちらを、無ければ `name` を返す。つまり package.json に `productName: 青空Reader`
 * を足した瞬間に、保存先が `aosora-reader` から `青空Reader` へ黙って移る。
 * ユーザーから見れば本棚が消えたのと同じなので、名前のほうを固定しておく。
 *
 * 値は現行の実測値に合わせてある(mac のパッケージ版も dev も `aosora-reader`)。
 * electron-builder.yml の productName はバンドルの表示名にしか効かない。
 * Windows でも `%APPDATA%\aosora-reader` となり、ASCII で収まる。
 *
 * ここを変えると既存ユーザーの本棚が見えなくなる。変えるなら移行処理とセットで。
 */
const USER_DATA_DIR = 'aosora-reader'
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR))

const IS_MAC = process.platform === 'darwin'

/** renderer の --titlebar-height と対。操作系はこの1段に収まる。 */
const TITLEBAR_HEIGHT = 52

/**
 * Windows / Linux の最小化・最大化・閉じるは、アプリ側が色を決める。
 * ツールバーと地色が違うとそこだけ別の帯に見えるので、theme.css の
 * --bg / --fg と同じ値を渡す。mac の信号機には色の指定が無いので関係しない。
 */
const OVERLAY_COLORS: Record<'light' | 'sepia' | 'dark', { color: string; symbolColor: string }> = {
  light: { color: '#fbfbfa', symbolColor: '#1c1b19' },
  sepia: { color: '#f4ecd8', symbolColor: '#43382a' },
  dark: { color: '#16181c', symbolColor: '#d9d5cd' }
}

function overlayColors(theme: AppSettings['theme']): { color: string; symbolColor: string } {
  if (theme === 'system') return nativeTheme.shouldUseDarkColors ? OVERLAY_COLORS.dark : OVERLAY_COLORS.light
  return OVERLAY_COLORS[theme]
}

/** テーマが変わったらウィンドウ操作ボタンの地色も追従させる。 */
function applyTitleBarOverlay(theme: AppSettings['theme']): void {
  if (IS_MAC) return
  const overlay = { ...overlayColors(theme), height: TITLEBAR_HEIGHT }
  for (const win of BrowserWindow.getAllWindows()) win.setTitleBarOverlay(overlay)
}

/**
 * アプリメニュー。
 *
 * mac は既定メニューが無いと ⌘C も ⌘Q も効かなくなるので必ず要る。
 * Windows / Linux ではメニューバーを隠す(autoHideMenuBar)が、メニュー自体は残す。
 * Ctrl+C / Ctrl+V の割り当てはここから来ていて、setApplicationMenu(null) にすると
 * 検索欄でコピーも貼り付けもできなくなる。隠してあるので Alt で出せる。
 *
 * 表示に再読み込みと拡大縮小は入れない。ページ送りは multicolumn と transform の
 * 幾何に乗っているので、ブラウザ側の拡大が混ざると文字サイズの操作が二重になる。
 */
function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(IS_MAC ? [{ role: 'appMenu' as const }] : []),
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す' },
        { role: 'redo', label: 'やり直す' },
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        { role: 'selectAll', label: 'すべて選択' }
      ]
    },
    {
      label: '表示',
      submenu: [
        { role: 'togglefullscreen', label: '全画面表示' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '開発者ツール' }
      ]
    },
    {
      label: 'ウィンドウ',
      submenu: IS_MAC
        ? [
            { role: 'minimize', label: '最小化' },
            { role: 'zoom', label: '拡大/縮小' },
            { type: 'separator' },
            { role: 'front', label: 'すべてを手前に移動' }
          ]
        : [
            { role: 'minimize', label: '最小化' },
            { role: 'close', label: '閉じる' }
          ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

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
let customFonts: CustomFontService
let bookImages: BookImageService
let reparse: ReparseService
let updates: UpdateService

function initServices(): void {
  db = openDatabase(join(app.getPath('userData'), 'library.db'))
  books = new BookRepository(db)
  progress = new ProgressRepository(db)
  settings = new SettingsRepository(db)
  bookImages = new BookImageService(join(app.getPath('userData'), 'images'))
  importer = new ImportService(books, bookImages)
  search = new SearchService(db)
  catalog = new AozoraCatalogService(importer, async (url) => {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`青空文庫から取得できませんでした (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  })
  annotations = new AnnotationRepository(db)
  sessions = new ReadingSessionRepository(db)
  reparse = new ReparseService(books, annotations, progress)
  dictionary = new WiktionaryProvider(async (url) => {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`辞書を検索できませんでした (${response.status})`)
    return response.json()
  })
  customFonts = new CustomFontService(join(app.getPath('userData'), 'fonts'))
  updates = new UpdateService(app.getVersion(), settings, textFetcher(net.fetch))
}

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    // 操作系は 52px のツールバー1段に収める(renderer の --titlebar-height)。
    // mac は信号機ボタンをその中央に置き、タイトルバーと別の段にしない。
    // Windows / Linux に hiddenInset は無く、指定しても枠が消えるだけで
    // 最小化・最大化・閉じるがどこにも出ない。titleBarOverlay で同じ帯に重ねる。
    // 空ける側が左右で逆になるので、余白は renderer の --titlebar-inset-end で持つ。
    ...(IS_MAC
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 19, y: 18 }
        }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            ...(dark ? OVERLAY_COLORS.dark : OVERLAY_COLORS.light),
            height: TITLEBAR_HEIGHT
          },
          autoHideMenuBar: true
        }),
    backgroundColor: dark ? '#16181c' : '#fbfbfa',
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
    // keepUserData でも本文は消える(注釈だけを残す)ので、挿絵も一緒に消す。
    // 取り込み直せば blockId ごと復元されるのと同じく、画像も入り直す。
    bookImages.remove(bookId)
  },

  async openBook(bookId: string): Promise<OpenBookResult | null> {
    // パーサーを更新していれば、本文をここで一度だけ作り直す。
    // 位置情報の付け替えも ReparseService の中で終わっているので、
    // このあと読むのは常に新しい本文と新しい位置。
    const outcome = reparse.run(bookId)
    if (outcome.status === 'updated') {
      console.info(
        `[reparse] ${bookId}: 本文を作り直した ` +
          `(位置の付け替え ${outcome.movedPositions}件 / 付け替えられず ${outcome.droppedPositions}件)`
      )
    }
    const book = books.load(bookId)
    if (!book) return null
    return {
      book,
      progress: progress.get(bookId),
      needsReimport: outcome.status === 'unavailable',
      reparsed:
        outcome.status === 'updated'
          ? {
              movedPositions: outcome.movedPositions,
              droppedPositions: outcome.droppedPositions
            }
          : null
    }
  },

  async willReparse(bookId) {
    return reparse.pending(bookId)
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

  async getAppSettings(): Promise<AppSettings> {
    return appSettingsFromRaw(settings.getAll())
  },

  async saveAppSettings(patch): Promise<AppSettings> {
    const current = await handlers.getAppSettings()
    const merged = normalizeAppSettings({ ...current, ...patch })
    settings.setMany(appSettingsToRaw(merged))
    applyTitleBarOverlay(merged.theme)
    return merged
  },

  async resetAppSettings(): Promise<AppSettings> {
    settings.setMany(appSettingsToRaw(DEFAULT_APP_SETTINGS))
    applyTitleBarOverlay(DEFAULT_APP_SETTINGS.theme)
    return DEFAULT_APP_SETTINGS
  },

  async getReaderSettings(): Promise<ReaderSettings> {
    const raw = settings.getAll()
    const prefixed = Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith('reader.')).map(([key, value]) => [key.slice(7), value]))
    return normalizeSettings(Object.keys(prefixed).length ? prefixed : raw as Partial<ReaderSettings>)
  },

  async saveReaderSettings(patch): Promise<ReaderSettings> {
    const current = await handlers.getReaderSettings()
    const merged = normalizeSettings({
      ...current,
      ...patch
    })
    settings.setMany(Object.fromEntries(Object.entries(merged).map(([key, value]) => [`reader.${key}`, value])))
    return merged
  },

  async resetReaderSettings(): Promise<ReaderSettings> {
    settings.setMany(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [`reader.${key}`, value])))
    return DEFAULT_SETTINGS
  },

  async importFonts() {
    const result = await dialog.showOpenDialog({
      title: 'フォントを追加',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'フォント', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    })
    return result.canceled ? customFonts.list() : customFonts.import(result.filePaths)
  },

  async listFonts() { return customFonts.list() },
  async renameFont(id, displayName) { return customFonts.rename(id, displayName) },
  async deleteFont(id) { return customFonts.delete(id) },
  async getFontData(id) { return customFonts.data(id) },

  async getAppVersion() { return app.getVersion() },

  async checkForUpdate() {
    const { updateCheck } = await handlers.getAppSettings()
    return updates.check(updateCheck === 'on')
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

/**
 * 挿絵の配信スキーム。
 *
 * IPC で Uint8Array を返す作りにすると、47 枚ある作品で 47 往復することになる。
 * <img src> から直接引けるようにして、遅延読み込みとキャッシュをブラウザに任せる。
 * standard にするのはホスト名(= bookId)とパスを URL として解釈させるため。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (request) => {
    const notFound = new Response(null, { status: 404 })
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound
    }
    const name = decodeURIComponent(url.pathname).replace(/^\//, '')
    const found = bookImages.read(url.hostname, name)
    if (!found) return notFound
    // bookId は原本ハッシュ由来で、同じ URL の中身が変わることはない。
    return new Response(found.bytes, {
      headers: {
        'content-type': found.mime,
        'cache-control': 'public, max-age=31536000, immutable'
      }
    })
  })
}

/**
 * 本棚を開けないまま起動すると、空の本棚を見せたうえに上書きしかねない。
 * 理由を見せて終わるほうが安全なので、ここで止める。
 */
function reportFatal(e: unknown): void {
  const detail =
    e instanceof SchemaTooNewError
      ? e.message
      : `本棚を開けませんでした。\n\n${e instanceof Error ? e.message : String(e)}\n\n` +
        `データの場所: ${app.getPath('userData')}`
  dialog.showErrorBox('青空Readerを起動できません', detail)
}

app.whenReady().then(() => {
  try {
    initServices()
  } catch (e) {
    reportFatal(e)
    app.quit()
    return
  }
  registerImageProtocol()
  registerIpc()
  Menu.setApplicationMenu(buildAppMenu())
  createWindow()

  // 保存されたテーマはここで初めて読める。ウィンドウはもう出ているので、
  // 既定色で作ってから本来の色へ直す。
  void handlers.getAppSettings().then((s) => applyTitleBarOverlay(s.theme))

  // theme が system のときだけ、OS の明暗にウィンドウ操作ボタンも追従させる。
  nativeTheme.on('updated', () => {
    void handlers.getAppSettings().then((s) => {
      if (s.theme === 'system') applyTitleBarOverlay(s.theme)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
