/**
 * books / chapters / blocks の永続化。
 * DB アクセスはこの層に閉じ込め、Service より上に SQL を漏らさない(要件 §20-5)。
 */
import type { Block, Book, BookSummary, Chapter } from '@shared/model/document'
import { transaction, type Db } from '../db/connection'

interface BookRow {
  id: string
  title: string
  subtitle: string | null
  author: string | null
  translator: string | null
  source_path: string
  source_type: string
  encoding: string
  source_hash: string
  total_characters: number
  metadata_json: string
  imported_at: string
  updated_at: string
}

interface ChapterRow {
  id: string
  title: string
  level: number
  ord: number
  char_start: number
  char_count: number
  blocks_json: string
}

export class BookRepository {
  constructor(private readonly db: Db) {}

  findByHash(
    hash: string
  ): { id: string; title: string; deleted: boolean } | null {
    const r = this.db
      .prepare('SELECT id, title, deleted_at FROM books WHERE source_hash = ?')
      .get(hash) as
      | { id: string; title: string; deleted_at: string | null }
      | undefined
    return r ? { id: r.id, title: r.title, deleted: r.deleted_at !== null } : null
  }

  /**
   * 本棚から外していた作品を、本文を入れ直して復活させる。
   * blockId は同じ原本から決定的に再生成されるため、注釈がそのまま繋がる。
   */
  restore(book: Book): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM chapters WHERE book_id = ?').run(book.id)
      this.db.prepare('DELETE FROM blocks WHERE book_id = ?').run(book.id)
      this.db
        .prepare(
          `UPDATE books SET deleted_at = NULL, source_path = ?, encoding = ?,
             total_characters = ?, metadata_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          book.sourcePath,
          book.encoding,
          book.totalCharacters,
          JSON.stringify(book.metadata),
          book.updatedAt,
          book.id
        )
      this.writeContent(book.id, book.chapters)
    })
  }

  findByTitleAuthor(title: string, author: string | null): { id: string } | null {
    const r = this.db
      .prepare(
        `SELECT id FROM books
         WHERE title = ? AND ifnull(author, '') = ifnull(?, '')`
      )
      .get(title, author ?? '') as { id: string } | undefined
    return r ? { id: r.id } : null
  }

  insert(book: Book): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO books (id, title, subtitle, author, translator, source_path,
             source_type, encoding, source_hash, total_characters, metadata_json,
             imported_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          book.id,
          book.title,
          book.subtitle,
          book.author,
          book.translator,
          book.sourcePath,
          book.sourceType,
          book.encoding,
          book.sourceHash,
          book.totalCharacters,
          JSON.stringify(book.metadata),
          book.importedAt,
          book.updatedAt
        )

      this.writeContent(book.id, book.chapters)
    })
  }

  private writeContent(bookId: string, chapters: Chapter[]): void {
    const insChapter = this.db.prepare(
      `INSERT INTO chapters (id, book_id, title, level, ord, char_start, char_count, blocks_json)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    const insBlock = this.db.prepare(
      `INSERT INTO blocks (book_id, chapter_id, id, ord, char_start, plain_text)
       VALUES (?,?,?,?,?,?)`
    )

    let globalOrd = 0
    for (const c of chapters) {
      insChapter.run(
        c.id,
        bookId,
        c.title,
        c.level,
        c.order,
        c.charStart,
        c.characterCount,
        JSON.stringify(c.blocks)
      )
      for (const b of c.blocks) {
        // 空ブロックは検索対象にならないので索引に入れない
        if (b.plainText === '') {
          globalOrd++
          continue
        }
        insBlock.run(bookId, c.id, b.id, globalOrd++, c.charStart + b.charStart, b.plainText)
      }
    }
  }

  /** 本文込みで1冊を読み出す。Reader が開くときだけ呼ぶ。 */
  load(bookId: string): Book | null {
    const r = this.db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
      | BookRow
      | undefined
    if (!r) return null

    const rows = this.db
      .prepare(
        `SELECT id, title, level, ord, char_start, char_count, blocks_json
         FROM chapters WHERE book_id = ? ORDER BY ord`
      )
      .all(bookId) as unknown as ChapterRow[]

    const chapters: Chapter[] = rows.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
      order: c.ord,
      charStart: c.char_start,
      characterCount: c.char_count,
      blocks: JSON.parse(c.blocks_json) as Block[]
    }))

    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      author: r.author,
      translator: r.translator,
      sourcePath: r.source_path,
      sourceType: r.source_type as Book['sourceType'],
      encoding: r.encoding,
      sourceHash: r.source_hash,
      metadata: JSON.parse(r.metadata_json) as Book['metadata'],
      chapters,
      totalCharacters: r.total_characters,
      importedAt: r.imported_at,
      updatedAt: r.updated_at
    }
  }

  /** 本棚一覧。blocks を読まないので冊数が増えても軽い。 */
  listSummaries(): BookSummary[] {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.title, b.subtitle, b.author, b.translator, b.total_characters,
                b.imported_at, b.updated_at,
                ifnull(p.percentage, 0)  AS percentage,
                p.last_opened_at          AS last_opened_at,
                ifnull(p.completed, 0)   AS completed
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         WHERE b.deleted_at IS NULL
         ORDER BY b.imported_at DESC`
      )
      .all() as unknown as Array<
      BookRow & { percentage: number; last_opened_at: string | null; completed: number }
    >

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      author: r.author,
      translator: r.translator,
      totalCharacters: r.total_characters,
      importedAt: r.imported_at,
      updatedAt: r.updated_at,
      percentage: r.percentage,
      lastOpenedAt: r.last_opened_at,
      completed: r.completed === 1
    }))
  }

  /**
   * 本を削除する。keepUserData が true のときはハイライト等を残す。
   * (要件 §4.14「ユーザーデータも削除するかどうか選択可能」)
   */
  delete(bookId: string, keepUserData: boolean): void {
    transaction(this.db, () => {
      if (keepUserData) {
        // ON DELETE CASCADE で注釈まで消えないよう books 行は残し、
        // deleted_at を立てて本棚から隠す。本文だけを削除する。
        const now = new Date().toISOString()
        this.db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
        this.db.prepare('DELETE FROM blocks WHERE book_id = ?').run(bookId)
        this.db
          .prepare('UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, bookId)
        return
      }
      this.db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    })
  }
}
