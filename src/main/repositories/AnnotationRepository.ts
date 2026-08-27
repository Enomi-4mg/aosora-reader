import { randomUUID } from 'node:crypto'
import type { AnnotationBundle, Bookmark, Highlight, Note } from '@shared/model/annotations'
import type { TextPosition, TextRange } from '@shared/model/position'
import type { HighlightColor } from '@shared/model/settings'
import type { Db } from '../db/connection'

export class AnnotationRepository {
  constructor(private readonly db: Db) {}

  list(bookId: string): AnnotationBundle {
    return {
      bookmarks: this.listBookmarks(bookId),
      highlights: this.listHighlights(bookId),
      notes: this.listNotes(bookId)
    }
  }

  addBookmark(bookId: string, position: TextPosition, label: string): Bookmark {
    const value: Bookmark = {
      id: randomUUID(), bookId, position, label: label.trim(), createdAt: new Date().toISOString()
    }
    this.db.prepare(
      `INSERT INTO bookmarks (id, book_id, chapter_id, block_id, offset, label, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(value.id, bookId, position.chapterId, position.blockId, position.offset, value.label, value.createdAt)
    return value
  }

  updateBookmark(id: string, label: string): void {
    this.db.prepare('UPDATE bookmarks SET label = ? WHERE id = ?').run(label.trim(), id)
  }

  deleteBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  }

  addHighlight(
    bookId: string,
    range: TextRange,
    selectedText: string,
    color: HighlightColor
  ): Highlight {
    const now = new Date().toISOString()
    const value: Highlight = {
      id: randomUUID(), bookId, range, selectedText, color, createdAt: now, updatedAt: now,
      orphaned: false
    }
    this.db.prepare(
      `INSERT INTO highlights (id, book_id, start_chapter_id, start_block_id, start_offset,
        end_chapter_id, end_block_id, end_offset, selected_text, color, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(value.id, bookId, range.start.chapterId, range.start.blockId, range.start.offset,
      range.end.chapterId, range.end.blockId, range.end.offset, selectedText, color, now, now)
    return value
  }

  deleteHighlight(id: string): void {
    this.db.prepare('DELETE FROM highlights WHERE id = ?').run(id)
  }

  saveNote(input: {
    id?: string
    bookId: string
    highlightId?: string | null
    range?: TextRange | null
    position?: TextPosition | null
    text: string
  }): Note {
    const now = new Date().toISOString()
    const start = input.range?.start ?? input.position ?? null
    const end = input.range?.end ?? null
    if (input.id) {
      this.db.prepare('UPDATE notes SET text = ?, updated_at = ? WHERE id = ?')
        .run(input.text, now, input.id)
      return this.listNotes(input.bookId).find((n) => n.id === input.id)!
    }
    const value: Note = {
      id: randomUUID(), bookId: input.bookId, highlightId: input.highlightId ?? null,
      range: input.range ?? null, position: input.range ? null : input.position ?? null,
      text: input.text, createdAt: now, updatedAt: now
    }
    this.db.prepare(
      `INSERT INTO notes (id, book_id, highlight_id, chapter_id, block_id, offset, text,
        created_at, updated_at, end_chapter_id, end_block_id, end_offset)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(value.id, input.bookId, value.highlightId, start?.chapterId ?? null,
      start?.blockId ?? null, start?.offset ?? null, value.text, now, now,
      end?.chapterId ?? null, end?.blockId ?? null, end?.offset ?? null)
    return value
  }

  deleteNote(id: string): void {
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
  }

  private listBookmarks(bookId: string): Bookmark[] {
    const rows = this.db.prepare(
      'SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at'
    ).all(bookId) as unknown as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: r.id as string, bookId, position: pos(bookId, r, ''),
      label: r.label as string, createdAt: r.created_at as string
    }))
  }

  private listHighlights(bookId: string): Highlight[] {
    const rows = this.db.prepare(
      'SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at'
    ).all(bookId) as unknown as Array<Record<string, unknown>>
    return rows.map((r) => {
      const storedRange = { start: pos(bookId, r, 'start_'), end: pos(bookId, r, 'end_') }
      const selectedText = r.selected_text as string
      const range = this.resolveRange(bookId, storedRange, selectedText)
      return {
        id: r.id as string, bookId, range: range ?? storedRange, selectedText,
        color: r.color as HighlightColor, createdAt: r.created_at as string,
        updatedAt: r.updated_at as string, orphaned: range === null
      }
    })
  }

  private listNotes(bookId: string): Note[] {
    const rows = this.db.prepare(
      'SELECT * FROM notes WHERE book_id = ? ORDER BY created_at'
    ).all(bookId) as unknown as Array<Record<string, unknown>>
    return rows.map((r) => {
      const start = r.block_id ? pos(bookId, r, '') : null
      const end = r.end_block_id ? pos(bookId, r, 'end_') : null
      return {
        id: r.id as string, bookId, highlightId: (r.highlight_id as string | null) ?? null,
        range: start && end ? { start, end } : null,
        position: start && !end ? start : null,
        text: r.text as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string
      }
    })
  }

  private rangeExists(range: TextRange): boolean {
    const row = this.db.prepare(
      `SELECT count(*) AS n FROM blocks WHERE book_id = ? AND id IN (?, ?)`
    ).get(range.start.bookId, range.start.blockId, range.end.blockId) as { n: number }
    const count = Number(row.n)
    return range.start.blockId === range.end.blockId ? count === 1 : count === 2
  }

  /** 保存範囲 → selectedText 近傍 → 作品全体の順で復旧する。 */
  private resolveRange(bookId: string, stored: TextRange, selectedText: string): TextRange | null {
    // blockId は同一原本から決定的に生成される。両端が実在すれば保存範囲を最優先する。
    if (this.rangeExists(stored)) return stored
    return this.findSelectedText(bookId, stored, selectedText)
  }

  private findSelectedText(bookId: string, stored: TextRange, selectedText: string): TextRange | null {
    if (!selectedText) return null
    const rows = this.blockRows(bookId)
    const joined = joinRows(rows)
    const approximate = globalOffset(rows, stored.start) ?? 0
    const hits: number[] = []
    let at = joined.text.indexOf(selectedText)
    while (at >= 0 && hits.length < 100) {
      hits.push(at)
      at = joined.text.indexOf(selectedText, at + 1)
    }
    if (hits.length === 0) return null
    hits.sort((a, b) => Math.abs(a - approximate) - Math.abs(b - approximate))
    const start = positionAt(bookId, rows, joined.starts, hits[0]!)
    const end = positionAt(bookId, rows, joined.starts, hits[0]! + selectedText.length)
    return start && end ? { start, end } : null
  }

  private blockRows(bookId: string): BlockRow[] {
    return this.db.prepare(
      'SELECT chapter_id, id, plain_text FROM blocks WHERE book_id = ? ORDER BY ord'
    ).all(bookId) as unknown as BlockRow[]
  }
}

interface BlockRow { chapter_id: string; id: string; plain_text: string }

function joinRows(rows: BlockRow[]): { text: string; starts: number[] } {
  const starts: number[] = []
  let text = ''
  for (const row of rows) {
    starts.push(text.length)
    text += (text ? '\n' : '') + row.plain_text
    if (starts.length > 1) starts[starts.length - 1]! += 1
  }
  return { text, starts }
}

function globalOffset(rows: BlockRow[], position: TextPosition): number | null {
  const joined = joinRows(rows)
  const index = rows.findIndex((row) => row.id === position.blockId)
  return index < 0 ? null : joined.starts[index]! + Math.min(position.offset, rows[index]!.plain_text.length)
}

function positionAt(bookId: string, rows: BlockRow[], starts: number[], offset: number): TextPosition | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!
    const start = starts[index]!
    if (offset >= start) return {
      bookId, chapterId: row.chapter_id, blockId: row.id,
      offset: Math.max(0, Math.min(row.plain_text.length, offset - start))
    }
  }
  return null
}

function pos(bookId: string, row: Record<string, unknown>, prefix: string): TextPosition {
  return {
    bookId,
    chapterId: row[`${prefix}chapter_id`] as string,
    blockId: row[`${prefix}block_id`] as string,
    offset: row[`${prefix}offset`] as number
  }
}
