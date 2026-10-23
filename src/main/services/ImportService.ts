/**
 * ファイルインポート(要件 §4.1)。
 *
 * TXT / ZIP → デコード → パース → Document Model → 永続化。
 * **パースはここで一度だけ行い、結果を保存する**。毎回再パースしないのは速度ではなく
 * blockId を固定してハイライトを守るため(要件 §5.3)。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Book, BookMetadata, SourceType } from '@shared/model/document'
import { parseAozora, type ParseIssue } from '@shared/parser'
import { decodeAozoraText, decodeWith, type SupportedEncoding } from '../import/decode'
import { readAozoraZip, ZipError, type ZipContents } from '../import/zip'
import { bookIdFromHash, hashText } from '../import/hash'
import type { BookRepository } from '../repositories/BookRepository'
import type { BookImageService } from './BookImageService'

export type ImportOutcome =
  | { status: 'imported'; bookId: string; title: string; issues: ParseIssue[] }
  | { status: 'restored'; bookId: string; title: string; issues: ParseIssue[] }
  | { status: 'duplicate'; bookId: string; title: string }
  | { status: 'needs-encoding'; path: string; candidates: SupportedEncoding[] }
  | { status: 'error'; path: string; message: string }

/**
 * 取り込み元の拡張子。
 *
 * ローカルパスを URL として解釈してはいけない。'?' や '#' を含むファイル名で
 * pathname が途中で切れ、ZIP をテキストとして読んでしまう。
 * URL なのは公式カタログから取得したときだけ。
 */
function extensionOf(sourcePath: string): string {
  if (/^https?:\/\//i.test(sourcePath)) {
    try {
      return extname(new URL(sourcePath).pathname).toLowerCase()
    } catch {
      return ''
    }
  }
  return extname(sourcePath).toLowerCase()
}

export class ImportService {
  /**
   * @param images 省略すると挿絵を保存しない。パーサーのテストのように
   *   本文だけを扱う経路では渡さなくてよい。
   */
  constructor(
    private readonly books: BookRepository,
    private readonly images?: BookImageService
  ) {}

  /**
   * 1ファイルを取り込む。
   * @param forcedEncoding ユーザーが文字コードを明示した場合に指定する。
   */
  async importFile(
    path: string,
    forcedEncoding?: SupportedEncoding
  ): Promise<ImportOutcome> {
    try {
      const raw = new Uint8Array(await readFile(path))
      return await this.importBytes(raw, path, basename(path, extname(path)), { forcedEncoding })
    } catch (e) {
      return this.error(path, e)
    }
  }

  /**
   * ダウンロード済みの公式作品を、ローカルファイルと同じ経路で取り込む。
   * @param options.metadata 本文からは読み取れない、取り込み元由来の情報
   *   (図書カード URL や読み仮名)。パース結果より優先する。
   */
  async importBytes(
    raw: Uint8Array,
    sourcePath: string,
    fallbackTitle: string,
    options: {
      forcedEncoding?: SupportedEncoding
      metadata?: Partial<BookMetadata>
    } = {}
  ): Promise<ImportOutcome> {
    const { forcedEncoding } = options
    try {
      const ext = extensionOf(sourcePath)

      let bytes: Uint8Array<ArrayBufferLike> = raw
      let sourceType: SourceType = 'txt'
      let archive: ZipContents | null = null
      if (ext === '.zip') {
        sourceType = 'zip'
        archive = readAozoraZip(raw)
        bytes = archive.main.bytes
      }

      let text: string
      let encoding: SupportedEncoding
      if (forcedEncoding) {
        text = decodeWith(bytes, forcedEncoding)
        encoding = forcedEncoding
      } else {
        const d = decodeAozoraText(bytes)
        if (d.ambiguous) {
          return {
            status: 'needs-encoding',
            path: sourcePath,
            candidates: ['Shift_JIS', 'UTF-8']
          }
        }
        text = d.text
        encoding = d.encoding
      }

      const sourceHash = hashText(text)
      const existing = this.books.findByHash(sourceHash)
      const bookId = existing?.id ?? bookIdFromHash(sourceHash)

      // 挿絵は本文より先に書き出す。ここで保存しておくと、挿絵対応より前に
      // 取り込んだ本を入れ直したときも(= 重複と判定される経路でも)画像が揃う。
      if (archive && this.images && !this.images.has(bookId)) {
        this.images.save(bookId, archive.images)
      }

      // 重複判定(要件 §4.1)
      if (existing && !existing.deleted) {
        return { status: 'duplicate', bookId: existing.id, title: existing.title }
      }

      const parsed = parseAozora(text)
      const now = new Date().toISOString()
      const book: Book = {
        id: bookId,
        title: parsed.title || fallbackTitle,
        subtitle: parsed.subtitle,
        author: parsed.author,
        translator: parsed.translator,
        sourcePath,
        sourceType,
        encoding,
        sourceHash,
        metadata: { ...parsed.metadata, ...options.metadata },
        chapters: parsed.chapters,
        totalCharacters: parsed.totalCharacters,
        importedAt: now,
        updatedAt: now
      }

      if (existing?.deleted) {
        // 本棚から外していた作品。blockId が一致するので注釈がそのまま繋がる。
        this.books.restore(book)
        return {
          status: 'restored',
          bookId: book.id,
          title: book.title,
          issues: parsed.issues
        }
      }

      this.books.insert(book)
      return {
        status: 'imported',
        bookId: book.id,
        title: book.title,
        issues: parsed.issues
      }
    } catch (e) {
      return this.error(sourcePath, e)
    }
  }

  async importMany(paths: string[]): Promise<ImportOutcome[]> {
    const out: ImportOutcome[] = []
    for (const p of paths) out.push(await this.importFile(p))
    return out
  }

  private error(path: string, e: unknown): ImportOutcome {
    // 壊れた ZIP や読めないファイルでアプリを落とさない(要件 §9)
    const message =
      e instanceof ZipError
        ? e.message
        : e instanceof Error
          ? `読み込みに失敗しました: ${e.message}`
          : '不明なエラーが発生しました。'
    return { status: 'error', path, message }
  }
}
