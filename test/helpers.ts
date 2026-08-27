import type { Block, Book, Chapter, InlineNode } from '@shared/model/document'

/** plainText だけのシンプルな Block を作るテスト用ヘルパー。 */
export function makeTextBlock(id: string, text: string, charStart: number): Block {
  const children: InlineNode[] = text
    ? [{ kind: 'text', start: 0, end: text.length, text }]
    : []
  return {
    id,
    type: 'paragraph',
    children,
    plainText: text,
    indentLevel: 0,
    charStart,
    sourceStart: 0,
    sourceEnd: text.length
  }
}

/**
 * 章ごとの本文配列から Book を組み立てる。
 * 例: buildBook([['第一章', ['あいう', 'かきく']], ['第二章', ['さしす']]])
 */
export function buildBook(
  spec: Array<[title: string, paragraphs: string[]]>,
  bookId = 'book1'
): Book {
  let bookChars = 0
  const chapters: Chapter[] = spec.map(([title, paragraphs], ci) => {
    let chapterChars = 0
    const blocks = paragraphs.map((text, bi) => {
      const b = makeTextBlock(`c${ci}_b${bi}`, text, chapterChars)
      chapterChars += text.length
      return b
    })
    const chapter: Chapter = {
      id: `c${ci}`,
      title,
      level: 1,
      order: ci,
      charStart: bookChars,
      characterCount: chapterChars,
      blocks
    }
    bookChars += chapterChars
    return chapter
  })

  return {
    id: bookId,
    title: 'テスト作品',
    subtitle: null,
    author: 'テスト著者',
    translator: null,
    sourcePath: '/tmp/test.txt',
    sourceType: 'txt',
    encoding: 'Shift_JIS',
    sourceHash: 'test-hash',
    metadata: {},
    chapters,
    totalCharacters: bookChars,
    importedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}
