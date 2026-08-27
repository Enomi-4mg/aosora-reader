import { describe, expect, it, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/connection'
import { BookRepository } from '../../src/main/repositories/BookRepository'
import { ProgressRepository } from '../../src/main/repositories/ProgressRepository'
import { SettingsRepository } from '../../src/main/repositories/SettingsRepository'
import { SearchService } from '../../src/main/services/SearchService'
import { parseAozora } from '@shared/parser'
import { hashText, bookIdFromHash } from '../../src/main/import/hash'
import {
  buildBookIndex,
  positionToPercentage,
  charOffsetToPosition,
  positionToCharOffset
} from '@shared/model/position'
import type { Book } from '@shared/model/document'

const SOURCE = [
  'こころ',
  '夏目漱石',
  '',
  '-------------------------------------------------------',
  '【テキスト中に現れる記号について】',
  '《》：ルビ',
  '-------------------------------------------------------',
  '',
  '上　先生と私［＃「上　先生と私」は大見出し］',
  '',
  '一［＃「一」は中見出し］',
  '',
  '　私《わたくし》はその人を常に先生と呼んでいた。',
  '　だからここでもただ先生と書くだけで本名は打ち明けない。',
  '',
  '二［＃「二」は中見出し］',
  '',
  '　私が先生と知り合いになったのは鎌倉《かまくら》である。',
  '',
  '底本：「こころ」新潮文庫、新潮社'
].join('\n')

function makeBook(): Book {
  const parsed = parseAozora(SOURCE)
  const hash = hashText(SOURCE)
  const now = '2026-08-27T00:00:00.000Z'
  return {
    id: bookIdFromHash(hash),
    title: parsed.title,
    subtitle: parsed.subtitle,
    author: parsed.author,
    translator: parsed.translator,
    sourcePath: '/tmp/kokoro.txt',
    sourceType: 'txt',
    encoding: 'Shift_JIS',
    sourceHash: hash,
    metadata: parsed.metadata,
    chapters: parsed.chapters,
    totalCharacters: parsed.totalCharacters,
    importedAt: now,
    updatedAt: now
  }
}

let db: Db
let books: BookRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  books = new BookRepository(db)
})

describe('マイグレーション', () => {
  it('user_version が進む', () => {
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(v.user_version).toBe(1)
  })

  it('再実行しても壊れない', () => {
    expect(() => openDatabase(':memory:')).not.toThrow()
  })
})

describe('Book の保存と読み出し', () => {
  it('Document Model が完全に往復する', () => {
    const book = makeBook()
    books.insert(book)
    const loaded = books.load(book.id)!

    expect(loaded.title).toBe('こころ')
    expect(loaded.author).toBe('夏目漱石')
    expect(loaded.totalCharacters).toBe(book.totalCharacters)
    expect(loaded.chapters.map((c) => c.title)).toEqual(book.chapters.map((c) => c.title))
    // InlineNode(ルビ含む)まで欠けずに戻る
    expect(JSON.stringify(loaded.chapters)).toBe(JSON.stringify(book.chapters))
  })

  it('目次が見出しから構成されている', () => {
    const book = makeBook()
    books.insert(book)
    const loaded = books.load(book.id)!
    expect(loaded.chapters.map((c) => c.title)).toEqual(['上　先生と私', '一', '二'])
  })

  it('本棚一覧を返す', () => {
    const book = makeBook()
    books.insert(book)
    const list = books.listSummaries()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: 'こころ', author: '夏目漱石', percentage: 0 })
  })

  it('source_hash で重複を検出する', () => {
    const book = makeBook()
    books.insert(book)
    expect(books.findByHash(book.sourceHash)).toMatchObject({
      id: book.id,
      deleted: false
    })
  })
})

describe('削除', () => {
  it('ユーザーデータごと削除する', () => {
    const book = makeBook()
    books.insert(book)
    db.prepare(
      `INSERT INTO highlights VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      'h1', book.id, 'c1', 'c1_b0', 0, 'c1', 'c1_b0', 3, 'テスト', 'yellow',
      '2026-01-01', '2026-01-01'
    )
    books.delete(book.id, false)
    expect(books.listSummaries()).toHaveLength(0)
    const n = db.prepare('SELECT count(*) c FROM highlights').get() as { c: number }
    expect(n.c).toBe(0)
  })

  it('ユーザーデータを残すと再インポートで復活できる', () => {
    const book = makeBook()
    books.insert(book)
    db.prepare(`INSERT INTO highlights VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'h1', book.id, 'c1', 'c1_b0', 0, 'c1', 'c1_b0', 3, 'テスト', 'yellow',
      '2026-01-01', '2026-01-01'
    )
    books.delete(book.id, true)

    expect(books.listSummaries()).toHaveLength(0)
    const kept = db.prepare('SELECT count(*) c FROM highlights').get() as { c: number }
    expect(kept.c).toBe(1)
    expect(books.findByHash(book.sourceHash)).toMatchObject({ deleted: true })

    // 同じ原本を入れ直すと blockId が一致するのでハイライトがそのまま繋がる
    books.restore(makeBook())
    expect(books.listSummaries()).toHaveLength(1)
    const still = db.prepare('SELECT count(*) c FROM highlights').get() as { c: number }
    expect(still.c).toBe(1)
  })
})

describe('読書位置', () => {
  it('TextPosition のまま往復し、ページ番号を保存しない', () => {
    const book = makeBook()
    books.insert(book)
    const index = buildBookIndex(book)
    const progress = new ProgressRepository(db)

    const target = charOffsetToPosition(index, 30)!
    progress.save({
      bookId: book.id,
      position: target,
      percentage: positionToPercentage(index, target),
      lastOpenedAt: '2026-08-27T01:00:00.000Z',
      completed: false
    })

    const restored = progress.get(book.id)!
    expect(restored.position).toEqual(target)
    // 復元した位置は同じ文字オフセットを指す
    expect(positionToCharOffset(index, restored.position)).toBe(30)

    const cols = db.prepare('PRAGMA table_info(reading_progress)').all() as unknown as Array<{
      name: string
    }>
    expect(cols.map((c) => c.name)).not.toContain('page')
  })

  it('本棚一覧に進捗が反映される', () => {
    const book = makeBook()
    books.insert(book)
    new ProgressRepository(db).save({
      bookId: book.id,
      position: { bookId: book.id, chapterId: 'c1', blockId: 'c1_b0', offset: 0 },
      percentage: 0.42,
      lastOpenedAt: '2026-08-27T01:00:00.000Z',
      completed: false
    })
    expect(books.listSummaries()[0]!.percentage).toBeCloseTo(0.42)
  })
})

describe('本文検索', () => {
  it('部分一致して TextPosition を返す', () => {
    const book = makeBook()
    books.insert(book)
    const r = new SearchService(db).searchBook(book.id, '先生')

    expect(r.count).toBeGreaterThanOrEqual(3)
    const index = buildBookIndex(book)
    for (const m of r.matches) {
      const e = index.byBlockId.get(m.position.blockId)!
      expect(e.block.plainText.slice(m.range.start.offset, m.range.end.offset)).toBe('先生')
      expect(m.context).toContain('先生')
    }
  })

  it('ルビの読みは検索対象にならない', () => {
    const book = makeBook()
    books.insert(book)
    const svc = new SearchService(db)
    // 本文には「私」があるがルビ「わたくし」は plainText に無い
    expect(svc.searchBook(book.id, '私').count).toBeGreaterThan(0)
    expect(svc.searchBook(book.id, 'わたくし').count).toBe(0)
    expect(svc.searchBook(book.id, 'かまくら').count).toBe(0)
  })

  it('該当なしと空クエリを安全に扱う', () => {
    const book = makeBook()
    books.insert(book)
    const svc = new SearchService(db)
    expect(svc.searchBook(book.id, '存在しない語句').count).toBe(0)
    expect(svc.searchBook(book.id, '   ').count).toBe(0)
  })

  it('LIKE のワイルドカードをエスケープする', () => {
    const book = makeBook()
    books.insert(book)
    expect(new SearchService(db).searchBook(book.id, '%').count).toBe(0)
  })
})

describe('設定', () => {
  it('key-value で往復する', () => {
    const s = new SettingsRepository(db)
    s.setMany({ fontSize: 18, writingMode: 'vertical', theme: 'sepia' })
    expect(s.getAll()).toEqual({ fontSize: 18, writingMode: 'vertical', theme: 'sepia' })
    s.setMany({ fontSize: 22 })
    expect(s.getAll().fontSize).toBe(22)
  })

  it('壊れた値があってもクラッシュしない', () => {
    db.prepare('INSERT INTO settings VALUES (?,?)').run('broken', '{not json')
    expect(() => new SettingsRepository(db).getAll()).not.toThrow()
  })
})
