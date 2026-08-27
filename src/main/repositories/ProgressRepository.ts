/** 読書位置の永続化(要件 §4.9)。位置は TextPosition のまま保存し、ページ番号は保存しない。 */
import type { TextPosition } from '@shared/model/position'
import type { Db } from '../db/connection'

export interface ReadingProgress {
  bookId: string
  position: TextPosition
  percentage: number
  lastOpenedAt: string
  completed: boolean
}

interface Row {
  book_id: string
  chapter_id: string
  block_id: string
  offset: number
  percentage: number
  last_opened_at: string
  completed: number
}

export class ProgressRepository {
  constructor(private readonly db: Db) {}

  get(bookId: string): ReadingProgress | null {
    const r = this.db
      .prepare('SELECT * FROM reading_progress WHERE book_id = ?')
      .get(bookId) as Row | undefined
    if (!r) return null
    return {
      bookId: r.book_id,
      position: {
        bookId: r.book_id,
        chapterId: r.chapter_id,
        blockId: r.block_id,
        offset: r.offset
      },
      percentage: r.percentage,
      lastOpenedAt: r.last_opened_at,
      completed: r.completed === 1
    }
  }

  save(p: ReadingProgress): void {
    this.db
      .prepare(
        `INSERT INTO reading_progress
           (book_id, chapter_id, block_id, offset, percentage, last_opened_at, completed)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(book_id) DO UPDATE SET
           chapter_id = excluded.chapter_id,
           block_id   = excluded.block_id,
           offset     = excluded.offset,
           percentage = excluded.percentage,
           last_opened_at = excluded.last_opened_at,
           completed  = excluded.completed`
      )
      .run(
        p.bookId,
        p.position.chapterId,
        p.position.blockId,
        p.position.offset,
        p.percentage,
        p.lastOpenedAt,
        p.completed ? 1 : 0
      )
  }
}
