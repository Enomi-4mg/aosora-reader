/**
 * TextPosition / TextRange — 本文中の位置を表す唯一の正となる表現。
 *
 * 読書位置・ブックマーク・ハイライト・メモ・検索結果・履歴のすべてがこれを使う。
 * **表示上のページ番号を永続化の基準にしてはならない**(要件 §20-1)。
 * ページ番号はフォントサイズ・ウィンドウサイズ・writingMode で変わるが、
 * TextPosition はどれにも影響されない。
 *
 * ここにあるのは純粋関数のみ。DOM にも React にも DB にも依存しない。
 */

import type { Block, Book, Chapter } from './document'

export interface TextPosition {
  bookId: string
  chapterId: string
  blockId: string
  /** Block.plainText 内の UTF-16 オフセット。 */
  offset: number
}

export interface TextRange {
  start: TextPosition
  end: TextPosition
}

interface BlockEntry {
  block: Block
  chapter: Chapter
  /** 作品全体での通し順。位置比較を O(1) にするために持つ。 */
  order: number
  /** 作品先頭からの累積 UTF-16 オフセット。 */
  charStart: number
}

/**
 * Book から位置演算用の索引を作る。
 * Reader が本を開いたときに一度だけ構築し、以後の比較・変換に使い回す。
 */
export interface BookIndex {
  bookId: string
  totalCharacters: number
  blocks: BlockEntry[]
  byBlockId: Map<string, BlockEntry>
  chapterOrder: Map<string, number>
}

export function buildBookIndex(book: Book): BookIndex {
  const blocks: BlockEntry[] = []
  const byBlockId = new Map<string, BlockEntry>()
  const chapterOrder = new Map<string, number>()

  let order = 0
  for (const chapter of book.chapters) {
    chapterOrder.set(chapter.id, chapter.order)
    for (const block of chapter.blocks) {
      const entry: BlockEntry = {
        block,
        chapter,
        order: order++,
        charStart: chapter.charStart + block.charStart
      }
      blocks.push(entry)
      byBlockId.set(block.id, entry)
    }
  }

  return {
    bookId: book.id,
    totalCharacters: book.totalCharacters,
    blocks,
    byBlockId,
    chapterOrder
  }
}

export function makePosition(
  bookId: string,
  chapterId: string,
  blockId: string,
  offset: number
): TextPosition {
  return { bookId, chapterId, blockId, offset }
}

/** 作品先頭 (最初の Block の offset 0)。 */
export function startPosition(index: BookIndex): TextPosition | null {
  const first = index.blocks[0]
  if (!first) return null
  return makePosition(index.bookId, first.chapter.id, first.block.id, 0)
}

/**
 * 位置を比較する。a < b なら負、a === b なら 0、a > b なら正。
 * blockId が索引に無い場合は「不明な位置」として末尾側に寄せる。
 */
export function comparePositions(
  index: BookIndex,
  a: TextPosition,
  b: TextPosition
): number {
  const ea = index.byBlockId.get(a.blockId)
  const eb = index.byBlockId.get(b.blockId)
  if (!ea || !eb) {
    // 片方でも解決できないときは安定した順序だけ保証する
    if (ea === eb) return 0
    return ea ? -1 : 1
  }
  if (ea.order !== eb.order) return ea.order - eb.order
  return a.offset - b.offset
}

export function positionsEqual(a: TextPosition, b: TextPosition): boolean {
  return (
    a.bookId === b.bookId &&
    a.chapterId === b.chapterId &&
    a.blockId === b.blockId &&
    a.offset === b.offset
  )
}

/** 位置を作品先頭からの通算 UTF-16 オフセットに変換する。読了率の基礎。 */
export function positionToCharOffset(
  index: BookIndex,
  p: TextPosition
): number {
  const e = index.byBlockId.get(p.blockId)
  if (!e) return 0
  const clamped = clampOffset(e.block, p.offset)
  return e.charStart + clamped
}

/** 通算オフセットから位置を復元する。 */
export function charOffsetToPosition(
  index: BookIndex,
  charOffset: number
): TextPosition | null {
  if (index.blocks.length === 0) return null
  const target = Math.max(0, Math.min(charOffset, index.totalCharacters))

  // charStart は単調増加なので二分探索できる
  let lo = 0
  let hi = index.blocks.length - 1
  let found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const e = index.blocks[mid]!
    if (e.charStart <= target) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  const e = index.blocks[found]!
  return makePosition(
    index.bookId,
    e.chapter.id,
    e.block.id,
    clampOffset(e.block, target - e.charStart)
  )
}

/**
 * 読了率(0..1)。ページ数ではなく文字オフセットから算出するため、
 * フォントサイズ・ウィンドウサイズ・writingMode を変えても値が動かない。
 */
export function positionToPercentage(
  index: BookIndex,
  p: TextPosition
): number {
  if (index.totalCharacters <= 0) return 0
  const n = positionToCharOffset(index, p)
  return Math.max(0, Math.min(1, n / index.totalCharacters))
}

/** 位置を実在する Block / offset の範囲に丸める。 */
export function clampPosition(
  index: BookIndex,
  p: TextPosition
): TextPosition | null {
  const e = index.byBlockId.get(p.blockId)
  if (!e) return null
  return makePosition(
    index.bookId,
    e.chapter.id,
    e.block.id,
    clampOffset(e.block, p.offset)
  )
}

function clampOffset(block: Block, offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0
  return Math.min(offset, block.plainText.length)
}

/** start > end なら入れ替えて正規化する。 */
export function normalizeRange(index: BookIndex, r: TextRange): TextRange {
  return comparePositions(index, r.start, r.end) <= 0
    ? r
    : { start: r.end, end: r.start }
}

export function isRangeCollapsed(r: TextRange): boolean {
  return positionsEqual(r.start, r.end)
}

/** p が [r.start, r.end) に含まれるか。 */
export function isPositionInRange(
  index: BookIndex,
  p: TextPosition,
  r: TextRange
): boolean {
  const n = normalizeRange(index, r)
  return (
    comparePositions(index, n.start, p) <= 0 &&
    comparePositions(index, p, n.end) < 0
  )
}

/** 2つの範囲が重なるか。ハイライトの重複検出に使う。 */
export function rangesOverlap(
  index: BookIndex,
  a: TextRange,
  b: TextRange
): boolean {
  const na = normalizeRange(index, a)
  const nb = normalizeRange(index, b)
  return (
    comparePositions(index, na.start, nb.end) < 0 &&
    comparePositions(index, nb.start, na.end) < 0
  )
}

/**
 * 範囲が覆う plainText を取り出す。Block をまたぐ場合は改行で連結する。
 * ハイライトの selectedText 保存(§5.3 の復旧ヒント)とコピー機能に使う。
 */
export function extractRangeText(index: BookIndex, r: TextRange): string {
  const n = normalizeRange(index, r)
  const se = index.byBlockId.get(n.start.blockId)
  const ee = index.byBlockId.get(n.end.blockId)
  if (!se || !ee) return ''

  if (se.order === ee.order) {
    return se.block.plainText.slice(n.start.offset, n.end.offset)
  }

  const parts: string[] = [se.block.plainText.slice(n.start.offset)]
  for (let i = se.order + 1; i < ee.order; i++) {
    parts.push(index.blocks[i]!.block.plainText)
  }
  parts.push(ee.block.plainText.slice(0, n.end.offset))
  return parts.join('\n')
}

/** 位置の前後の文脈を取り出す。検索結果とブックマークラベルに使う。 */
export function contextAround(
  index: BookIndex,
  p: TextPosition,
  before: number,
  after: number
): string {
  const e = index.byBlockId.get(p.blockId)
  if (!e) return ''
  const t = e.block.plainText
  const s = Math.max(0, p.offset - before)
  const en = Math.min(t.length, p.offset + after)
  return t.slice(s, en)
}

/** 位置が属する章を返す。 */
export function chapterOf(
  index: BookIndex,
  p: TextPosition
): Chapter | null {
  return index.byBlockId.get(p.blockId)?.chapter ?? null
}
