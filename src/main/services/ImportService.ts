/**
 * ファイルインポート(要件 §4.1)。
 *
 * TXT / ZIP → デコード → パース → Document Model → 永続化。
 * **パースはここで一度だけ行い、結果を保存する**。毎回再パースしないのは速度ではなく
 * blockId を固定してハイライトを守るため(要件 §5.3)。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Book, SourceType } from '@shared/model/document'
import { parseAozora, type ParseIssue } from '@shared/parser'
import { decodeAozoraText, decodeWith, type SupportedEncoding } from '../import/decode'
import { readAozoraZip, ZipError } from '../import/zip'
import { bookIdFromHash, hashText } from '../import/hash'
import type { BookRepository } from '../repositories/BookRepository'

export type ImportOutcome =
  | { status: 'imported'; bookId: string; title: string; issues: ParseIssue[] }
  | { status: 'restored'; bookId: string; title: string; issues: ParseIssue[] }
  | { status: 'duplicate'; bookId: string; title: string }
  | { status: 'needs-encoding'; path: string; candidates: SupportedEncoding[] }
  | { status: 'error'; path: string; message: string }

export class ImportService {
  constructor(private readonly books: BookRepository) {}

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
      const ext = extname(path).toLowerCase()

      let bytes: Uint8Array<ArrayBufferLike> = raw
      let sourceType: SourceType = 'txt'
      if (ext === '.zip') {
        sourceType = 'zip'
        bytes = readAozoraZip(raw).main.bytes
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
            path,
            candidates: ['Shift_JIS', 'UTF-8']
          }
        }
        text = d.text
        encoding = d.encoding
      }

      const sourceHash = hashText(text)

      // 重複判定(要件 §4.1)
      const existing = this.books.findByHash(sourceHash)
      if (existing && !existing.deleted) {
        return { status: 'duplicate', bookId: existing.id, title: existing.title }
      }

      const parsed = parseAozora(text)
      const now = new Date().toISOString()
      const book: Book = {
        id: existing?.id ?? bookIdFromHash(sourceHash),
        title: parsed.title || basename(path, ext),
        subtitle: parsed.subtitle,
        author: parsed.author,
        translator: parsed.translator,
        sourcePath: path,
        sourceType,
        encoding,
        sourceHash,
        metadata: parsed.metadata,
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

  async importMany(paths: string[]): Promise<ImportOutcome[]> {
    const out: ImportOutcome[] = []
    for (const p of paths) out.push(await this.importFile(p))
    return out
  }
}
