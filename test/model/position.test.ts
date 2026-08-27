import { describe, expect, it } from 'vitest'
import {
  buildBookIndex,
  charOffsetToPosition,
  chapterEndPosition,
  chapterOf,
  chapterStartPosition,
  clampPosition,
  comparePositions,
  contextAround,
  extractRangeText,
  isPositionInRange,
  makePosition,
  normalizeRange,
  positionToCharOffset,
  positionToPercentage,
  rangesOverlap,
  startPosition
} from '@shared/model/position'
import { buildBook } from '../helpers'

// 第1章: "あいうえお"(5) + "かきくけこ"(5) = 10
// 第2章: "さしすせそ"(5) = 5
// 合計 15 文字
const book = buildBook([
  ['第一章', ['あいうえお', 'かきくけこ']],
  ['第二章', ['さしすせそ']]
])
const index = buildBookIndex(book)
const at = (blockId: string, offset: number) =>
  makePosition(book.id, blockId.startsWith('c0') ? 'c0' : 'c1', blockId, offset)

describe('buildBookIndex', () => {
  it('全 Block を通し順で索引する', () => {
    expect(index.blocks.map((b) => b.block.id)).toEqual([
      'c0_b0',
      'c0_b1',
      'c1_b0'
    ])
    expect(index.blocks.map((b) => b.charStart)).toEqual([0, 5, 10])
    expect(index.totalCharacters).toBe(15)
  })
})

describe('comparePositions', () => {
  it('同一 Block 内は offset で比較する', () => {
    expect(comparePositions(index, at('c0_b0', 1), at('c0_b0', 3))).toBeLessThan(0)
    expect(comparePositions(index, at('c0_b0', 3), at('c0_b0', 1))).toBeGreaterThan(0)
    expect(comparePositions(index, at('c0_b0', 2), at('c0_b0', 2))).toBe(0)
  })

  it('Block をまたぐ場合は通し順で比較する', () => {
    expect(comparePositions(index, at('c0_b0', 4), at('c0_b1', 0))).toBeLessThan(0)
    expect(comparePositions(index, at('c1_b0', 0), at('c0_b1', 4))).toBeGreaterThan(0)
  })

  it('未知の blockId でも例外を投げず安定した順序を返す', () => {
    const ghost = at('missing', 0)
    expect(() => comparePositions(index, ghost, at('c0_b0', 0))).not.toThrow()
    expect(comparePositions(index, at('c0_b0', 0), ghost)).toBeLessThan(0)
    expect(comparePositions(index, ghost, ghost)).toBe(0)
  })
})

describe('通算オフセットとの相互変換', () => {
  it('positionToCharOffset は章をまたいで累積する', () => {
    expect(positionToCharOffset(index, at('c0_b0', 0))).toBe(0)
    expect(positionToCharOffset(index, at('c0_b0', 3))).toBe(3)
    expect(positionToCharOffset(index, at('c0_b1', 2))).toBe(7)
    expect(positionToCharOffset(index, at('c1_b0', 4))).toBe(14)
  })

  it('charOffsetToPosition は逆変換になる', () => {
    for (let n = 0; n <= 14; n++) {
      const p = charOffsetToPosition(index, n)!
      expect(positionToCharOffset(index, p)).toBe(n)
    }
  })

  it('Block 境界は次の Block の先頭に解決する', () => {
    expect(charOffsetToPosition(index, 5)).toMatchObject({
      blockId: 'c0_b1',
      offset: 0
    })
    expect(charOffsetToPosition(index, 10)).toMatchObject({
      blockId: 'c1_b0',
      offset: 0
    })
  })

  it('範囲外の値は本文内に丸める', () => {
    expect(charOffsetToPosition(index, -100)).toMatchObject({
      blockId: 'c0_b0',
      offset: 0
    })
    expect(charOffsetToPosition(index, 9999)).toMatchObject({
      blockId: 'c1_b0',
      offset: 5
    })
  })
})

describe('positionToPercentage', () => {
  it('文字オフセットに比例する', () => {
    expect(positionToPercentage(index, at('c0_b0', 0))).toBe(0)
    expect(positionToPercentage(index, at('c1_b0', 5))).toBe(1)
    expect(positionToPercentage(index, at('c0_b1', 0))).toBeCloseTo(5 / 15)
  })
})

describe('clampPosition', () => {
  it('Block 長を超える offset を丸める', () => {
    expect(clampPosition(index, at('c0_b0', 99))).toMatchObject({ offset: 5 })
    expect(clampPosition(index, at('c0_b0', -3))).toMatchObject({ offset: 0 })
  })

  it('未知の Block には null を返す', () => {
    expect(clampPosition(index, at('missing', 0))).toBeNull()
  })
})

describe('TextRange', () => {
  const r = { start: at('c0_b0', 3), end: at('c0_b1', 2) }

  it('normalizeRange は逆転した範囲を入れ替える', () => {
    const rev = { start: r.end, end: r.start }
    expect(normalizeRange(index, rev)).toEqual(r)
    expect(normalizeRange(index, r)).toEqual(r)
  })

  it('isPositionInRange は [start, end) 半開区間', () => {
    expect(isPositionInRange(index, at('c0_b0', 3), r)).toBe(true)
    expect(isPositionInRange(index, at('c0_b0', 2), r)).toBe(false)
    expect(isPositionInRange(index, at('c0_b1', 1), r)).toBe(true)
    expect(isPositionInRange(index, at('c0_b1', 2), r)).toBe(false)
  })

  it('rangesOverlap は接するだけの範囲を重なりと見なさない', () => {
    const a = { start: at('c0_b0', 0), end: at('c0_b0', 3) }
    const b = { start: at('c0_b0', 3), end: at('c0_b0', 5) }
    const c = { start: at('c0_b0', 2), end: at('c0_b0', 4) }
    expect(rangesOverlap(index, a, b)).toBe(false)
    expect(rangesOverlap(index, a, c)).toBe(true)
  })

  it('extractRangeText は Block をまたぐと改行で連結する', () => {
    expect(
      extractRangeText(index, { start: at('c0_b0', 1), end: at('c0_b0', 4) })
    ).toBe('いうえ')
    expect(extractRangeText(index, r)).toBe('えお\nかき')
    expect(
      extractRangeText(index, { start: at('c0_b0', 4), end: at('c1_b0', 1) })
    ).toBe('お\nかきくけこ\nさ')
  })
})

describe('contextAround', () => {
  it('Block 端で切り詰める', () => {
    expect(contextAround(index, at('c0_b0', 2), 10, 10)).toBe('あいうえお')
    expect(contextAround(index, at('c0_b0', 2), 1, 2)).toBe('いうえ')
  })
})

describe('補助', () => {
  it('startPosition は最初の Block の先頭', () => {
    expect(startPosition(index)).toMatchObject({ blockId: 'c0_b0', offset: 0 })
  })

  it('chapterOf は所属章を返す', () => {
    expect(chapterOf(index, at('c1_b0', 0))?.title).toBe('第二章')
  })

  it('章境界の位置を先頭と末尾に解決する', () => {
    expect(chapterStartPosition(index, 'c1')).toEqual(at('c1_b0', 0))
    expect(chapterEndPosition(index, 'c0')).toEqual(at('c0_b1', 5))
  })

  it('存在しない章の境界は null を返す', () => {
    expect(chapterStartPosition(index, 'missing')).toBeNull()
    expect(chapterEndPosition(index, 'missing')).toBeNull()
  })
})
