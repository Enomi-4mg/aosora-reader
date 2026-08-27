import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/connection'
import { BookRepository } from '../../src/main/repositories/BookRepository'
import { AnnotationRepository } from '../../src/main/repositories/AnnotationRepository'
import { ReadingSessionRepository } from '../../src/main/repositories/ReadingSessionRepository'
import { parseAozora } from '@shared/parser'
import type { Book } from '@shared/model/document'

let db: Db
let book: Book

beforeEach(() => {
  db = openDatabase(':memory:')
  const parsed = parseAozora('題名\n著者\n\n第一章［＃「第一章」は大見出し］\n本文です。')
  book = {
    id: 'book-phase2', title: parsed.title, subtitle: parsed.subtitle, author: parsed.author,
    translator: parsed.translator, sourcePath: '/tmp/book.txt', sourceType: 'txt',
    encoding: 'UTF-8', sourceHash: 'phase2-hash', metadata: parsed.metadata,
    chapters: parsed.chapters, totalCharacters: parsed.totalCharacters,
    importedAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z'
  }
  new BookRepository(db).insert(book)
})

describe('Phase 2 migration', () => {
  it('範囲メモとセッション位置の列を追加する', () => {
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(v.user_version).toBe(2)
    const noteColumns = db.prepare('PRAGMA table_info(notes)').all() as unknown as Array<{ name: string }>
    expect(noteColumns.map((c) => c.name)).toContain('end_block_id')
    const sessionColumns = db.prepare('PRAGMA table_info(reading_sessions)').all() as unknown as Array<{ name: string }>
    expect(sessionColumns.map((c) => c.name)).toContain('start_block_id')
  })
})

describe('annotations', () => {
  it('bookmark, highlight, range note を往復・削除する', () => {
    const repo = new AnnotationRepository(db)
    const block = book.chapters[0]!.blocks.find((candidate) => candidate.plainText.length > 0)!
    const start = { bookId: book.id, chapterId: book.chapters[0]!.id, blockId: block.id, offset: 0 }
    const end = { ...start, offset: 2 }
    const bookmark = repo.addBookmark(book.id, start, '第一章 ― 本文')
    const highlight = repo.addHighlight(book.id, { start, end }, '本文', 'yellow')
    const note = repo.saveNote({ bookId: book.id, range: { start, end }, text: '重要' })

    // Repository を作り直しても同じ TextRange で復元される。
    const all = new AnnotationRepository(db).list(book.id)
    expect(all.bookmarks[0]).toEqual(bookmark)
    expect(all.highlights[0]).toMatchObject({ id: highlight.id, orphaned: false, selectedText: '本文' })
    expect(all.notes[0]).toMatchObject({ id: note.id, range: { start, end }, text: '重要' })

    repo.updateBookmark(bookmark.id, '変更')
    repo.saveNote({ id: note.id, bookId: book.id, text: '追記' })
    expect(repo.list(book.id).bookmarks[0]!.label).toBe('変更')
    expect(repo.list(book.id).notes[0]!.text).toBe('追記')

    repo.deleteBookmark(bookmark.id)
    repo.deleteHighlight(highlight.id)
    repo.deleteNote(note.id)
    expect(repo.list(book.id)).toEqual({ bookmarks: [], highlights: [], notes: [] })
  })

  it('保存 blockId が消えた場合は selectedText から範囲を復旧する', () => {
    const repo = new AnnotationRepository(db)
    const block = book.chapters[0]!.blocks.find((candidate) => candidate.plainText.includes('本文'))!
    const start = { bookId: book.id, chapterId: book.chapters[0]!.id, blockId: block.id, offset: block.plainText.indexOf('本文') }
    const highlight = repo.addHighlight(book.id, { start, end: { ...start, offset: start.offset + 2 } }, '本文', 'blue')
    db.prepare(`UPDATE highlights SET start_block_id = 'old-start', end_block_id = 'old-end' WHERE id = ?`).run(highlight.id)

    expect(repo.list(book.id).highlights[0]).toMatchObject({
      orphaned: false,
      range: { start: { blockId: block.id }, end: { blockId: block.id } }
    })
  })
})

describe('reading sessions', () => {
  it('TextPosition と実測速度を保存する', () => {
    const repo = new ReadingSessionRepository(db)
    const block = book.chapters[0]!.blocks[0]!
    const position = { bookId: book.id, chapterId: book.chapters[0]!.id, blockId: block.id, offset: 0 }
    const id = repo.start(book.id, position, 0)
    db.prepare('UPDATE reading_sessions SET opened_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 120_000).toISOString(), id)
    repo.close(id, { ...position, offset: 4 }, 0.5, 1000)
    const stats = repo.stats(book.id, 500)
    expect(stats.sessionCount).toBe(1)
    expect(stats.totalDurationMs).toBeGreaterThan(100_000)
    expect(stats.estimatedCharsPerMinute).toBeGreaterThan(400)
  })
})
