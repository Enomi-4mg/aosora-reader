import { randomUUID } from 'node:crypto'
import type { ReadingStats } from '@shared/model/annotations'
import type { TextPosition } from '@shared/model/position'
import type { Db } from '../db/connection'

export class ReadingSessionRepository {
  constructor(private readonly db: Db) {}

  start(bookId: string, position: TextPosition, percentage: number): string {
    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO reading_sessions (id, book_id, opened_at, start_percentage, end_percentage,
        start_chapter_id, start_block_id, start_offset)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, bookId, new Date().toISOString(), percentage, percentage,
      position.chapterId, position.blockId, position.offset)
    return id
  }

  close(id: string, position: TextPosition, percentage: number, charactersRead: number): void {
    const row = this.db.prepare('SELECT opened_at FROM reading_sessions WHERE id = ?').get(id) as
      | { opened_at: string } | undefined
    if (!row) return
    const now = new Date()
    const duration = Math.max(0, now.getTime() - new Date(row.opened_at).getTime())
    this.db.prepare(
      `UPDATE reading_sessions SET closed_at = ?, duration_ms = ?, end_percentage = ?,
        characters_read = ?, end_chapter_id = ?, end_block_id = ?, end_offset = ? WHERE id = ?`
    ).run(now.toISOString(), duration, percentage, Math.max(0, charactersRead),
      position.chapterId, position.blockId, position.offset, id)
  }

  stats(bookId: string, fallbackCpm: number): ReadingStats {
    const row = this.db.prepare(
      `SELECT ifnull(sum(duration_ms), 0) total, count(*) count,
        ifnull(sum(characters_read), 0) chars FROM reading_sessions
       WHERE book_id = ? AND closed_at IS NOT NULL`
    ).get(bookId) as { total: number; count: number; chars: number }
    const activeMinutes = row.total / 60_000
    const measured = activeMinutes >= 1 && row.chars > 0 ? row.chars / activeMinutes : fallbackCpm
    return {
      totalDurationMs: row.total,
      sessionCount: row.count,
      estimatedCharsPerMinute: Math.max(100, Math.min(2000, Math.round(measured)))
    }
  }
}
