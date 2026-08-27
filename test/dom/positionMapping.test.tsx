// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockRenderer } from '@renderer/reader/BlockRenderer'
import {
  domPointToPosition,
  domRangeToTextRange,
  positionToDomPoint,
  textRangeToDomRange,
  runTextLength
} from '@renderer/reader/dom/positionMapping'
import { SELECTOR_RUN } from '@renderer/reader/dom/contract'
import { parseAozora } from '@shared/parser'
import type { Block } from '@shared/model/document'

const BOOK = 'b1'

/** 青空文庫記法から Block を作り、実際に DOM へ描画する。 */
function render(source: string): { block: Block; el: HTMLElement } {
  const r = parseAozora(`題\n著\n\n${source}\n`)
  const block = r.chapters
    .flatMap((c) => c.blocks)
    .find((b) => b.plainText !== '')!
  document.body.innerHTML = renderToStaticMarkup(
    <BlockRenderer block={block} chapterId="c0" />
  )
  return { block, el: document.body.firstElementChild as HTMLElement }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('DOM規約', () => {
  it('各 run の data-s と長さが plainText を隙間なく覆う', () => {
    const { block, el } = render(
      '　吾輩《わがはい》は※［＃ローマ数字1、1-13-21］猫である。'
    )
    const runs = Array.from(el.querySelectorAll(SELECTOR_RUN))
    let covered = 0
    for (const run of runs) {
      const s = Number(run.getAttribute('data-s'))
      const len = runTextLength(run)
      // run が担当する範囲は plainText のその位置と一致していなければならない
      expect(block.plainText.slice(s, s + len)).toHaveLength(len)
      covered += len
    }
    expect(covered).toBe(block.plainText.length)
  })

  it('ルビの読みは run の長さに数えない', () => {
    const { el } = render('吾輩《わがはい》')
    const ruby = el.querySelector('ruby')!
    expect(ruby.textContent).toContain('わがはい')
    expect(runTextLength(ruby)).toBe(2) // 「吾輩」のみ
  })
})

describe('全オフセットの往復', () => {
  const cases: Array<[string, string]> = [
    ['素のテキスト', '　吾輩は猫である。'],
    ['ルビ', '　吾輩《わがはい》は猫である。'],
    ['強制ルビ', '　｜精神的《メンタル》な問題だ。'],
    ['傍点', '　これは大事［＃「大事」に傍点］です。'],
    ['入れ子装飾', '　［＃傍点］外［＃太字］内［＃太字終わり］側［＃傍点終わり］だ。'],
    ['外字', '　※［＃ローマ数字1、1-13-21］の巻。'],
    ['サロゲートペア外字', '　※［＃「口＋七」、第3水準1-47-52］る。'],
    ['縦中横', '　明治４２［＃「４２」は縦中横］年。'],
    ['未対応注記', '　本文［＃地から３字上げ］の続き。'],
    [
      '複合',
      '　吾輩《わがはい》は※［＃ローマ数字2、1-13-22］の大事［＃「大事」に傍点］な４２［＃「４２」は縦中横］匹目。'
    ]
  ]

  for (const [label, src] of cases) {
    it(`${label}: すべての offset が DOM を経て元に戻る`, () => {
      const { block, el } = render(src)
      const root = el.parentNode as ParentNode
      for (let off = 0; off <= block.plainText.length; off++) {
        const p = { bookId: BOOK, chapterId: 'c0', blockId: block.id, offset: off }
        const dom = positionToDomPoint(p, root)
        expect(dom, `offset ${off} を DOM に解決できない`).not.toBeNull()
        const back = domPointToPosition(BOOK, dom!.node, dom!.offset)
        expect(back, `offset ${off} を戻せない`).not.toBeNull()
        expect(back!.offset, `offset ${off} が往復で変化した`).toBe(off)
        expect(back!.blockId).toBe(block.id)
      }
    })
  }
})

describe('TextRange と DOM Range', () => {
  it('選択範囲が本文の実文字列と一致する', () => {
    const { block, el } = render('　吾輩《わがはい》は猫である。')
    const root = el.parentNode as ParentNode
    const tr = {
      start: { bookId: BOOK, chapterId: 'c0', blockId: block.id, offset: 1 },
      end: { bookId: BOOK, chapterId: 'c0', blockId: block.id, offset: 5 }
    }
    // ルビの読みを含まないので「吾輩は猫」になる
    expect(block.plainText.slice(1, 5)).toBe('吾輩は猫')
    const dom = textRangeToDomRange(tr, root)
    expect(dom).not.toBeNull()
    const back = domRangeToTextRange(BOOK, dom!)!
    expect([back.start.offset, back.end.offset]).toEqual([1, 5])
  })

  it('装飾をまたぐあらゆる範囲が往復する', () => {
    const { block, el } = render('　［＃傍点］強調中［＃傍点終わり］の外側')
    const root = el.parentNode as ParentNode
    for (let a = 0; a < block.plainText.length; a++) {
      for (let b = a + 1; b <= block.plainText.length; b++) {
        const tr = {
          start: { bookId: BOOK, chapterId: 'c0', blockId: block.id, offset: a },
          end: { bookId: BOOK, chapterId: 'c0', blockId: block.id, offset: b }
        }
        const dom = textRangeToDomRange(tr, root)
        expect(dom, `[${a},${b}) を解決できない`).not.toBeNull()
        const back = domRangeToTextRange(BOOK, dom!)!
        expect([back.start.offset, back.end.offset]).toEqual([a, b])
      }
    }
  })

  it('描画されていない Block は null を返す', () => {
    render('　本文')
    const p = { bookId: BOOK, chapterId: 'c9', blockId: 'nope', offset: 0 }
    expect(positionToDomPoint(p, document)).toBeNull()
  })

  it('複数 Block にまたがる選択範囲を往復する', () => {
    const parsed = parseAozora('題\n著\n\n一行目\n二行目\n')
    const blocks = parsed.chapters.flatMap((chapter) => chapter.blocks)
      .filter((block) => block.plainText.length > 0)
    document.body.innerHTML = renderToStaticMarkup(<>
      {blocks.map((block) => <BlockRenderer key={block.id} block={block} chapterId="c0" />)}
    </>)
    const tr = {
      start: { bookId: BOOK, chapterId: 'c0', blockId: blocks[0]!.id, offset: 1 },
      end: { bookId: BOOK, chapterId: 'c0', blockId: blocks[1]!.id, offset: 2 }
    }
    const dom = textRangeToDomRange(tr, document)
    expect(dom).not.toBeNull()
    expect(domRangeToTextRange(BOOK, dom!)).toEqual(tr)
  })
})

describe('本文外の点', () => {
  it('段落要素そのものを指しても Block 内に解決する', () => {
    const { block, el } = render('　吾輩は猫である。')
    const p = domPointToPosition(BOOK, el, 0)
    expect(p).not.toBeNull()
    expect(p!.blockId).toBe(block.id)
    expect(p!.offset).toBeGreaterThanOrEqual(0)
  })

  it('本文の外は null を返す', () => {
    render('　本文')
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    expect(domPointToPosition(BOOK, outside, 0)).toBeNull()
  })
})
