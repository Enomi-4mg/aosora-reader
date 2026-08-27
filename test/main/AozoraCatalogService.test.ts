import { describe, expect, it } from 'vitest'
import { parseAozoraCatalog } from '../../src/main/services/AozoraCatalogService'

const HEADER = [
  '作品ID', '作品名', '作品名読み', '公開日', '図書カードURL',
  '姓', '名', '姓読み', '名読み', '役割フラグ', 'テキストファイルURL'
].join(',')

describe('青空文庫の公式カタログ', () => {
  it('同じ作品の著者と翻訳者を作品IDでまとめる', () => {
    const csv = [
      HEADER,
      '000001,テスト作品,てすとさくひん,2026-08-27,https://www.aozora.gr.jp/cards/1/card1.html,山田,太郎,やまだ,たろう,著者,https://www.aozora.gr.jp/cards/1/files/1.zip',
      '000001,テスト作品,てすとさくひん,2026-08-27,https://www.aozora.gr.jp/cards/1/card1.html,佐藤,花子,さとう,はなこ,翻訳者,https://www.aozora.gr.jp/cards/1/files/1.zip'
    ].join('\n')

    expect(parseAozoraCatalog(csv)).toMatchObject([
      {
        id: '000001',
        title: 'テスト作品',
        author: '山田 太郎 / 佐藤 花子 訳',
        publishedAt: '2026-08-27'
      }
    ])
  })

  it('図書カードURLと読み仮名を保持する(取り込み時に Book.metadata へ渡す)', () => {
    const csv = [
      HEADER,
      '000001,テスト作品,てすとさくひん,2026-08-27,https://www.aozora.gr.jp/cards/1/card1.html,山田,太郎,やまだ,たろう,著者,https://www.aozora.gr.jp/cards/1/files/1.zip'
    ].join('\n')

    expect(parseAozoraCatalog(csv)[0]).toMatchObject({
      cardUrl: 'https://www.aozora.gr.jp/cards/1/card1.html',
      titleKana: 'てすとさくひん',
      authorKana: 'やまだ たろう'
    })
  })

  it('引用符・改行を含む列を壊さず、公式外URLを除外する', () => {
    const csv = [
      HEADER,
      '000001,"カンマ,と\n改行",かな,2026-08-27,https://www.aozora.gr.jp/card1.html,山田,太郎,やまだ,たろう,著者,https://www.aozora.gr.jp/files/1.zip',
      '000002,対象外,たいしょうがい,2026-08-27,https://example.com/card2.html,佐藤,花子,さとう,はなこ,著者,https://example.com/2.zip'
    ].join('\n')

    const parsed = parseAozoraCatalog(csv)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.title).toBe('カンマ,と\n改行')
  })
})
