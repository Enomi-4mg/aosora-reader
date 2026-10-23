// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAozora } from '@shared/parser'
import { bookImageUrl, IMAGE_SCHEME } from '@shared/ipc'
import type { Block } from '@shared/model/document'
import { BlockRenderer } from '@renderer/reader/BlockRenderer'
import { ATTR_BLOCK, SELECTOR_RUN } from '@renderer/reader/dom/contract'

const BOOK = '0123456789abcdef'

function blocksOf(body: string): Block[] {
  return parseAozora(`題\n著\n\n${body}\n`).chapters.flatMap((c) => c.blocks)
}

function render(blocks: Block[]): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(
    <>
      {blocks.map((b) => (
        <BlockRenderer key={b.id} block={b} chapterId="c0" bookId={BOOK} />
      ))}
    </>
  )
  return document.body
}

describe('挿絵の描画', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('画像ブロックを img として描き、aozora-img の URL を指す', () => {
    const blocks = blocksOf('［＃挿絵（fig1_01.png、横479×縦252）入る］')
    const img = render(blocks).querySelector('img')!
    expect(img.getAttribute('src')).toBe(`${IMAGE_SCHEME}://${BOOK}/fig1_01.png`)
    expect(img.getAttribute('alt')).toBe('挿絵')
    expect(img.getAttribute('width')).toBe('479')
    expect(img.getAttribute('height')).toBe('252')
  })

  /*
   * ページ送りは transform なので、遅れて読み込むと読んでいる最中に
   * ページ数が変わる。DOM に載るのは1章ぶんだけなので遅延読み込みはしない。
   */
  it('遅延読み込みはしない', () => {
    const img = render(blocksOf('［＃挿絵（fig1_01.png、横10×縦20）入る］')).querySelector('img')!
    expect(img.hasAttribute('loading')).toBe(false)
  })

  /*
   * width/height 属性は縦横比を伝えるだけで箱は確保しないので、
   * 寸法が判っていても読み込み後に測り直す必要がある。
   */
  it('寸法が判っていても読み込み完了を知らせる', () => {
    const onImageLoad = vi.fn()
    const figure = blocksOf('［＃挿絵（fig1_01.png、横10×縦20）入る］')
      .find((b) => b.type === 'image')!
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(
        <BlockRenderer
          block={figure}
          chapterId="c0"
          bookId={BOOK}
          onImageLoad={onImageLoad}
        />
      )
    })
    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('load', { bubbles: false }))
    })
    expect(onImageLoad).toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('読み込みに失敗した図は代替表示に切り替わる', () => {
    const figure = blocksOf('［＃「空」のキャプション付きの挿絵（fig1_01.png、横10×縦20）入る］')
      .find((b) => b.type === 'image')!
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<BlockRenderer block={figure} chapterId="c0" bookId={BOOK} />)
    })
    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error', { bubbles: false }))
    })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.image-placeholder')!.textContent).toBe('空')
    act(() => root.unmount())
  })

  it('寸法が注記に無ければ width/height を付けない', () => {
    const img = render(blocksOf('［＃挿絵（fig1_01.png）入る］')).querySelector('img')!
    expect(img.hasAttribute('width')).toBe(false)
    expect(img.hasAttribute('height')).toBe(false)
  })

  /**
   * 図は本文の座標を一切消費しない。run を持つと plainText との対応が崩れ、
   * ハイライトと読書位置がずれる(dom/contract.ts の規約)。
   */
  it('figure は run を持たず、ブロックとしては data-block-id を持つ', () => {
    const blocks = blocksOf('［＃挿絵（fig1_01.png、横10×縦20）入る］')
    const body = render(blocks)
    const figure = body.querySelector('figure')!
    expect(figure.hasAttribute(ATTR_BLOCK)).toBe(true)
    expect(figure.querySelectorAll(SELECTOR_RUN)).toHaveLength(0)
  })

  it('キャプション行は caption クラスの本文ブロックとして描かれる', () => {
    const blocks = blocksOf(
      '［＃挿絵（fig1_01.png、横10×縦20）入る］\n〈キャプ〉［＃「〈キャプ〉」はキャプション］'
    )
    const body = render(blocks)
    const caption = body.querySelector('.caption')!
    expect(caption.textContent).toBe('〈キャプ〉')
    // キャプションは本文なので、ハイライトできるよう run を持つ
    expect(caption.querySelectorAll(SELECTOR_RUN).length).toBeGreaterThan(0)
  })

  it('画像が無いブロックは代替表示に落ちる', () => {
    const block: Block = {
      id: 'c0_b0',
      type: 'image',
      children: [],
      plainText: '',
      indentLevel: 0,
      charStart: 0,
      sourceStart: 0,
      sourceEnd: 0
    }
    const body = render([block])
    expect(body.querySelector('img')).toBeNull()
    expect(body.querySelector('.image-placeholder')!.textContent).toBe('挿絵')
  })

  it('画像で与えられた外字を img として描く', () => {
    const blocks = blocksOf('　※［＃「册」の篆書（fig_01.png）、70-3］の字。')
    const body = render(blocks)
    const img = body.querySelector('img.image-gaiji')!
    expect(img.getAttribute('src')).toBe(`${IMAGE_SCHEME}://${BOOK}/fig_01.png`)
    // 読み上げにファイル名と面区点を載せない
    expect(img.getAttribute('alt')).toBe('「册」の篆書')
    // 代替文字は隠すだけで DOM からは消さない
    expect(body.querySelector('.gaiji-standin')!.textContent).toBe('□')
  })

  it('画像にできない外字はこれまでどおり文字で出す', () => {
    const body = render(blocksOf('　※［＃ローマ数字1、1-13-21］の巻。'))
    expect(body.querySelector('img.image-gaiji')).toBeNull()
    expect(body.querySelector('[data-gaiji]')!.textContent).toBe('Ⅰ')
  })

  it('外字の画像が読めなければ代替文字を見せる', () => {
    const glyph = blocksOf('　※［＃「册」の篆書（fig_01.png）、70-3］の字。')
      .find((b) => b.plainText !== '')!
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<BlockRenderer block={glyph} chapterId="c0" bookId={BOOK} />)
    })
    act(() => {
      container.querySelector('img.image-gaiji')!.dispatchEvent(new Event('error'))
    })
    expect(container.querySelector('img.image-gaiji')).toBeNull()
    expect(container.querySelector('[data-gaiji]')!.textContent).toBe('□')
    act(() => root.unmount())
  })

  it('URL の組み立てでファイル名をエスケープする', () => {
    expect(bookImageUrl(BOOK, 'fig 01.png')).toBe(
      `${IMAGE_SCHEME}://${BOOK}/fig%2001.png`
    )
  })
})
