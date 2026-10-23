/**
 * パーサー更新後の作り直しを、DB をまたいで通しで確かめる。
 *
 * 肝は「本文が作り直されること」ではなく「位置情報が同じ場所を指し続けること」。
 * 本文だけ入れ替えて位置を放置すると、栞も読書位置も静かに別の場所を指す。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/connection'
import { BookRepository } from '../../src/main/repositories/BookRepository'
import { AnnotationRepository } from '../../src/main/repositories/AnnotationRepository'
import { ProgressRepository } from '../../src/main/repositories/ProgressRepository'
import { ReparseService } from '../../src/main/services/ReparseService'
import { PARSER_VERSION, parseAozora } from '@shared/parser'
import type { Book } from '@shared/model/document'

const SOURCE = [
  '題名',
  '著者',
  '',
  '　前の文と後ろの文。',
  '　ふつうの段落。'
].join('\n')

/** 本文に紛れ込んだゴミ。古いパーサーが plainText へ漏らしていたものに相当する。 */
const JUNK = '」のキャプション付きの図（f.png）入る］'

let db: Db
let books: BookRepository
let annotations: AnnotationRepository
let progress: ProgressRepository
let reparse: ReparseService

/** いまのパーサーで解析した本。 */
function fresh(): Book {
  const parsed = parseAozora(SOURCE)
  return {
    id: 'book1', title: parsed.title, subtitle: parsed.subtitle, author: parsed.author,
    translator: parsed.translator, sourcePath: '/tmp/a.txt', sourceType: 'txt',
    encoding: 'UTF-8', sourceHash: 'hash1', metadata: parsed.metadata,
    chapters: parsed.chapters, totalCharacters: parsed.totalCharacters,
    importedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

/**
 * 「古いパーサーで取り込まれた本」を作る。
 * 本文の途中にゴミが入っていて、そのぶん後ろの offset がずれている状態。
 */
function stale(): { book: Book; blockId: string; chapterId: string } {
  const book = fresh()
  const chapter = book.chapters[0]!
  const target = chapter.blocks.find((b) => b.plainText.includes('前の文'))!
  const at = target.plainText.indexOf('後ろの文')
  target.plainText = target.plainText.slice(0, at) + JUNK + target.plainText.slice(at)
  return { book, blockId: target.id, chapterId: chapter.id }
}

/** 取り込み時点のパーサー版と原文を、古い状態に書き換える。 */
function markStale(bookId: string, sourceText: string | null): void {
  db.prepare('UPDATE books SET parser_version = 0, source_text = ? WHERE id = ?')
    .run(sourceText, bookId)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  books = new BookRepository(db)
  annotations = new AnnotationRepository(db)
  progress = new ProgressRepository(db)
  reparse = new ReparseService(books, annotations, progress)
})

describe('パーサー更新後の作り直し', () => {
  it('最新の版で取り込まれた本には何もしない', () => {
    books.insert(fresh(), SOURCE)
    expect(reparse.run('book1')).toEqual({ status: 'current' })
  })

  it('古い版なら本文を作り直す', () => {
    const { book } = stale()
    books.insert(book, SOURCE)
    markStale('book1', SOURCE)

    expect(reparse.run('book1').status).toBe('updated')

    const after = books.load('book1')!
    const text = after.chapters.flatMap((c) => c.blocks).map((b) => b.plainText).join('')
    expect(text).not.toContain(JUNK)
    expect(books.parseState('book1')!.version).toBe(PARSER_VERSION)
  })

  /** 作り直しの肝。ゴミの後ろに置いた栞が、同じ語を指し続けること。 */
  it('栞がゴミの前後関係を保って同じ語を指す', () => {
    const { book, blockId, chapterId } = stale()
    books.insert(book, SOURCE)
    markStale('book1', SOURCE)

    const before = book.chapters[0]!.blocks.find((b) => b.id === blockId)!
    const offset = before.plainText.indexOf('後ろの文')
    annotations.addBookmark(
      'book1',
      { bookId: 'book1', chapterId, blockId, offset },
      '目印'
    )

    expect(reparse.run('book1').status).toBe('updated')

    const bookmark = annotations.list('book1').bookmarks[0]!
    const after = books.load('book1')!
    const block = after.chapters
      .flatMap((c) => c.blocks)
      .find((b) => b.id === bookmark.position.blockId)!
    expect(block.plainText.slice(bookmark.position.offset)).toBe('後ろの文。')
  })

  it('読書位置も付け替える', () => {
    const { book, blockId, chapterId } = stale()
    books.insert(book, SOURCE)
    markStale('book1', SOURCE)

    const before = book.chapters[0]!.blocks.find((b) => b.id === blockId)!
    const offset = before.plainText.indexOf('後ろの文')
    progress.save({
      bookId: 'book1',
      position: { bookId: 'book1', chapterId, blockId, offset },
      percentage: 0.5,
      lastOpenedAt: '2026-01-02T00:00:00.000Z',
      completed: false
    })

    reparse.run('book1')

    const saved = progress.get('book1')!
    const after = books.load('book1')!
    const block = after.chapters
      .flatMap((c) => c.blocks)
      .find((b) => b.id === saved.position.blockId)!
    expect(block.plainText.slice(saved.position.offset)).toBe('後ろの文。')
    expect(saved.percentage).toBe(0.5)
  })

  /*
   * ハイライトも必ず付け替える。resolveRange の探し直しが走るのは
   * blockId ごと消えたときだけで、blockId が残ったまま offset だけずれると
   * 素通りして静かに別の場所を指したままになる。
   */
  it('ハイライトが同じ語を指し続ける', () => {
    const { book, blockId, chapterId } = stale()
    books.insert(book, SOURCE)
    markStale('book1', SOURCE)

    const before = book.chapters[0]!.blocks.find((b) => b.id === blockId)!
    const start = before.plainText.indexOf('後ろの文')
    annotations.addHighlight(
      'book1',
      {
        start: { bookId: 'book1', chapterId, blockId, offset: start },
        end: { bookId: 'book1', chapterId, blockId, offset: start + 4 }
      },
      '後ろの文',
      'yellow'
    )

    reparse.run('book1')

    const highlight = annotations.list('book1').highlights[0]!
    expect(highlight.orphaned).toBe(false)
    const after = books.load('book1')!
    const block = after.chapters
      .flatMap((c) => c.blocks)
      .find((b) => b.id === highlight.range.start.blockId)!
    expect(
      block.plainText.slice(highlight.range.start.offset, highlight.range.end.offset)
    ).toBe('後ろの文')
  })

  it('原文が無ければ作り直せないことを伝える', () => {
    books.insert(fresh(), SOURCE)
    markStale('book1', null)
    expect(reparse.run('book1')).toEqual({ status: 'unavailable' })
    expect(reparse.needsReimport('book1')).toBe(true)
    // 本文はそのまま残り、読めなくはならない
    expect(books.load('book1')!.chapters.length).toBeGreaterThan(0)
  })

  it('取り込み直せば原文ごと最新になる', () => {
    books.insert(fresh(), SOURCE)
    markStale('book1', null)
    expect(reparse.needsReimport('book1')).toBe(true)

    books.delete('book1', false)
    books.insert(fresh(), SOURCE)
    expect(reparse.needsReimport('book1')).toBe(false)
    expect(reparse.run('book1')).toEqual({ status: 'current' })
  })
})
