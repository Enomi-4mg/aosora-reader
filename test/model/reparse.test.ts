import { describe, expect, it } from 'vitest'
import {
  buildBlockMap,
  indexBlocks,
  remapOffset,
  remapPosition,
  type BlockShape
} from '@shared/model/reparse'

const shape = (
  id: string,
  plainText: string,
  sourceStart: number,
  chapterId = 'c0'
): BlockShape => ({ id, chapterId, plainText, sourceStart, sourceEnd: sourceStart + 1 })

describe('remapOffset', () => {
  it('本文が変わらなければ動かさない', () => {
    expect(remapOffset('あいうえお', 'あいうえお', 3)).toBe(3)
  })

  /*
   * 注記の入れ子を直したときに起きた形。
   * 本文へ漏れていた注記の生テキストが消え、その後ろが前へ詰まる。
   */
  it('途中が消えたぶんだけ後ろを詰める', () => {
    const before = '　前の文」のキャプション付きの図（f.png）入る］後ろの文'
    const after = '　前の文後ろの文'
    // 「後ろの文」の先頭を指していた位置は、詰まった先の「後ろの文」の先頭へ
    expect(remapOffset(before, after, before.indexOf('後ろの文'))).toBe(after.indexOf('後ろの文'))
    // 変わっていない先頭側は動かない
    expect(remapOffset(before, after, 2)).toBe(2)
    // 末尾はそれぞれの末尾
    expect(remapOffset(before, after, before.length)).toBe(after.length)
  })

  it('消えた区間の内側を指していた位置は、その入口で止める', () => {
    const before = '　前の文ゴミゴミ後ろの文'
    const after = '　前の文後ろの文'
    expect(remapOffset(before, after, '　前の文ゴ'.length)).toBe('　前の文'.length)
  })

  /*
   * 増えた場所がちょうど位置と重なると、前と後ろのどちらへ寄せるか決まらない。
   * 増えたぶんより前に寄せる(新しく出るようになった本文を飛び越さない)。
   */
  it('増えた場所と重なる位置は、増えたぶんより前に寄せる', () => {
    const before = '　前の文後ろの文'
    const after = '　前の文足した後ろの文'
    expect(remapOffset(before, after, before.indexOf('後ろの文'))).toBe('　前の文'.length)
  })

  it('増えた場所より後ろは、末尾からの距離を保つ', () => {
    const before = '　前の文後ろの文。'
    const after = '　前の文足した後ろの文。'
    expect(remapOffset(before, after, before.indexOf('。'))).toBe(after.indexOf('。'))
  })

  it('空文字や範囲外でも壊れない', () => {
    expect(remapOffset('', '', 0)).toBe(0)
    expect(remapOffset('あい', '', 2)).toBe(0)
    // 末尾に足された場合も、足されたぶんより前で止まる
    expect(remapOffset('あい', 'あいうえ', 99)).toBe(2)
    expect(remapOffset('あいうえ', 'あい', 4)).toBe(2)
  })
})

describe('buildBlockMap', () => {
  /*
   * sourceStart は元 TXT のオフセットなので、パーサーの解釈が変わっても動かない。
   * ブロックの数や種類が変わっても、同じ原文の位置どうしが結べる。
   */
  it('元 TXT の位置でブロックを突き合わせる', () => {
    const before = [shape('c0_b0', 'いち', 0), shape('c0_b1', 'に', 10), shape('c0_b2', 'さん', 20)]
    const after = [
      shape('c0_b0', 'いち', 0),
      shape('c0_b1', '', 5), // 新しく増えたブロック
      shape('c0_b2', 'に', 10),
      shape('c0_b3', 'さん', 20)
    ]
    const map = buildBlockMap(before, after)
    expect(map.get('c0_b1')!.id).toBe('c0_b2')
    expect(map.get('c0_b2')!.id).toBe('c0_b3')
  })

  it('対応する元 TXT 位置が無ければ結ばない', () => {
    const map = buildBlockMap([shape('c0_b0', 'いち', 99)], [shape('c0_b0', 'いち', 0)])
    expect(map.has('c0_b0')).toBe(false)
  })
})

describe('remapPosition', () => {
  const before = [shape('c0_b0', '　前の文ゴミ後ろの文', 0)]
  const after = [shape('c1_b7', '　前の文後ろの文', 0, 'c1')]

  it('ブロック id と章 id ごと付け替える', () => {
    const r = remapPosition(
      { bookId: 'b', chapterId: 'c0', blockId: 'c0_b0', offset: '　前の文ゴミ'.length },
      indexBlocks(before),
      buildBlockMap(before, after)
    )!
    expect(r.position).toEqual({
      bookId: 'b',
      chapterId: 'c1',
      blockId: 'c1_b7',
      offset: '　前の文'.length
    })
    expect(r.moved).toBe(true)
  })

  it('何も変わらなければ moved は false', () => {
    const same = [shape('c0_b0', 'あいうえお', 0)]
    const r = remapPosition(
      { bookId: 'b', chapterId: 'c0', blockId: 'c0_b0', offset: 2 },
      indexBlocks(same),
      buildBlockMap(same, same)
    )!
    expect(r.moved).toBe(false)
  })

  it('対応先が無ければ null', () => {
    expect(
      remapPosition(
        { bookId: 'b', chapterId: 'c0', blockId: 'missing', offset: 0 },
        indexBlocks(before),
        buildBlockMap(before, after)
      )
    ).toBeNull()
  })
})
