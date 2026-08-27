import { describe, expect, it } from 'vitest'
import { parseAozora } from '@shared/parser'
import type { Block, InlineNode } from '@shared/model/document'

/** 本文だけを与えて最初の段落ブロックを取り出すヘルパー。 */
function firstBlock(body: string): Block {
  const r = parseAozora(`テスト作品\nテスト著者\n\n${body}\n`)
  const blocks = r.chapters.flatMap((c) => c.blocks)
  return blocks.find((b) => b.plainText !== '' || b.type !== 'paragraph')!
}

function parseBody(body: string) {
  return parseAozora(`テスト作品\nテスト著者\n\n${body}\n`)
}

/** InlineNode を読みやすい形に落として比較する。 */
function shape(n: InlineNode): unknown {
  switch (n.kind) {
    case 'text':
      return ['text', n.text]
    case 'ruby':
      return ['ruby', n.baseText, n.rubyText]
    case 'gaiji':
      return ['gaiji', n.text, n.resolution]
    case 'tcy':
      return ['tcy', n.text]
    case 'note':
      return ['note', n.raw]
    case 'emphasis':
      return ['emphasis', n.mark, n.children.map(shape)]
    case 'bold':
      return ['bold', n.children.map(shape)]
    case 'underline':
      return ['underline', n.style, n.children.map(shape)]
  }
}

/** すべての InlineNode の [start,end) が plainText と整合しているか検証する。 */
function assertOffsetsConsistent(block: Block): void {
  const walk = (nodes: InlineNode[], lo: number, hi: number): void => {
    for (const n of nodes) {
      expect(n.start).toBeGreaterThanOrEqual(lo)
      expect(n.end).toBeLessThanOrEqual(hi)
      expect(n.end).toBeGreaterThanOrEqual(n.start)
      if (n.kind === 'text') {
        expect(block.plainText.slice(n.start, n.end)).toBe(n.text)
      }
      if (n.kind === 'ruby') {
        expect(block.plainText.slice(n.start, n.end)).toBe(n.baseText)
      }
      if (n.kind === 'note') {
        // 【不変条件 A】未対応注記は必ずゼロ幅
        expect(n.end).toBe(n.start)
      }
      if (n.kind === 'emphasis' || n.kind === 'bold' || n.kind === 'underline') {
        walk(n.children, n.start, n.end)
      }
    }
  }
  walk(block.children, 0, block.plainText.length)
}

describe('通常テキスト', () => {
  it('そのまま段落になる', () => {
    const b = firstBlock('　吾輩は猫である。')
    expect(b.type).toBe('paragraph')
    expect(b.plainText).toBe('　吾輩は猫である。')
    expect(b.children.map(shape)).toEqual([['text', '　吾輩は猫である。']])
    assertOffsetsConsistent(b)
  })
})

describe('ルビ', () => {
  it('要件 §16 の例どおりに分解される', () => {
    const b = firstBlock('　吾輩《わがはい》は猫である。')
    expect(b.plainText).toBe('　吾輩は猫である。')
    expect(b.children.map(shape)).toEqual([
      ['text', '　'],
      ['ruby', '吾輩', 'わがはい'],
      ['text', 'は猫である。']
    ])
    assertOffsetsConsistent(b)
  })

  it('【不変条件 A】ルビの読みは plainText に入らない', () => {
    const b = firstBlock('吾輩《わがはい》は猫である。')
    expect(b.plainText).not.toContain('わがはい')
    expect(b.plainText.length).toBe('吾輩は猫である。'.length)
  })

  it('親文字は同一文字種だけを遡る', () => {
    expect(firstBlock('その日本語《にほんご》を').plainText).toBe('その日本語を')
    expect(
      (firstBlock('その日本語《にほんご》を').children.map(shape) as unknown[])[1]
    ).toEqual(['ruby', '日本語', 'にほんご'])
  })

  it('カタカナの親文字は漢字を巻き込まない', () => {
    const b = firstBlock('食パン《ぱん》')
    expect((b.children.map(shape) as unknown[])[1]).toEqual(['ruby', 'パン', 'ぱん'])
  })

  it('｜ で親文字を強制指定できる', () => {
    const b = firstBlock('｜精神的《メンタル》な問題')
    expect(b.plainText).toBe('精神的な問題')
    expect(b.children.map(shape)).toEqual([
      ['ruby', '精神的', 'メンタル'],
      ['text', 'な問題']
    ])
    assertOffsetsConsistent(b)
  })

  it('｜ は直前のひらがなも親文字に含められる', () => {
    const b = firstBlock('｜そこはかとなく《・・・・・・・・》')
    expect(b.plainText).toBe('そこはかとなく')
    expect((b.children.map(shape) as unknown[])[0]).toEqual([
      'ruby',
      'そこはかとなく',
      '・・・・・・・・'
    ])
  })

  it('※《 は literal の《 として扱う', () => {
    const b = firstBlock('記号※《を出す')
    expect(b.plainText).toBe('記号《を出す')
  })
})

describe('見出し', () => {
  it('後置形 ［＃「〜」は大見出し］ を章にする', () => {
    const r = parseBody('上　先生と私［＃「上　先生と私」は大見出し］\n\n　私はその人を。')
    const heading = r.chapters.flatMap((c) => c.blocks).find((b) => b.type === 'heading')!
    expect(heading.plainText).toBe('上　先生と私')
    expect(heading.headingLevel).toBe(1)
    expect(r.chapters.map((c) => c.title)).toContain('上　先生と私')
  })

  it('大/中/小 の3レベルを区別する', () => {
    const r = parseBody(
      '巻一［＃「巻一」は大見出し］\n第一章［＃「第一章」は中見出し］\n一［＃「一」は小見出し］'
    )
    const hs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'heading')
    expect(hs.map((h) => h.headingLevel)).toEqual([1, 2, 3])
  })

  it('ブロック形 ［＃ここから中見出し］〜［＃ここで中見出し終わり］', () => {
    const r = parseBody('［＃ここから中見出し］\n第一章\n［＃ここで中見出し終わり］\n　本文。')
    const hs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'heading')
    expect(hs.map((h) => h.plainText)).toEqual(['第一章'])
    expect(hs[0]!.headingLevel).toBe(2)
  })

  it('同行形 ［＃中見出し］〜［＃中見出し終わり］', () => {
    const r = parseBody('［＃中見出し］第一章［＃中見出し終わり］\n　本文。')
    const hs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'heading')
    expect(hs.map((h) => h.plainText)).toEqual(['第一章'])
  })

  it('見出しから章が構成され charStart が累積する', () => {
    const r = parseBody('一［＃「一」は大見出し］\n　あいう。\n二［＃「二」は大見出し］\n　かきく。')
    expect(r.chapters.map((c) => c.title)).toEqual(['一', '二'])
    expect(r.chapters[0]!.charStart).toBe(0)
    expect(r.chapters[1]!.charStart).toBe(r.chapters[0]!.characterCount)
    expect(r.totalCharacters).toBe(
      r.chapters.reduce((n, c) => n + c.characterCount, 0)
    )
  })
})

describe('傍点 / 傍線 / 太字', () => {
  it('対象指定の傍点', () => {
    const b = firstBlock('　これは大事［＃「大事」に傍点］です。')
    expect(b.plainText).toBe('　これは大事です。')
    expect(b.children.map(shape)).toEqual([
      ['text', '　これは'],
      ['emphasis', 'sesame', [['text', '大事']]],
      ['text', 'です。']
    ])
    assertOffsetsConsistent(b)
  })

  it('傍点の種類を区別する', () => {
    const b = firstBlock('　白ゴマ［＃「白ゴマ」に白ゴマ傍点］')
    expect((b.children.map(shape) as unknown[])[1]).toEqual([
      'emphasis',
      'white-sesame',
      [['text', '白ゴマ']]
    ])
  })

  it('範囲指定の傍点', () => {
    const b = firstBlock('　［＃傍点］強調する［＃傍点終わり］部分')
    expect(b.plainText).toBe('　強調する部分')
    expect(b.children.map(shape)).toEqual([
      ['text', '　'],
      ['emphasis', 'sesame', [['text', '強調する']]],
      ['text', '部分']
    ])
    assertOffsetsConsistent(b)
  })

  it('太字', () => {
    const b = firstBlock('　これは太字［＃「太字」は太字］です。')
    expect((b.children.map(shape) as unknown[])[1]).toEqual([
      'bold',
      [['text', '太字']]
    ])
  })

  it('傍線と種類', () => {
    const b = firstBlock('　傍線部［＃「傍線部」に二重傍線］')
    expect((b.children.map(shape) as unknown[])[1]).toEqual([
      'underline',
      'double',
      [['text', '傍線部']]
    ])
  })

  it('装飾はルビを内側に持てる', () => {
    const b = firstBlock('　［＃傍点］吾輩《わがはい》は［＃傍点終わり］猫')
    expect(b.plainText).toBe('　吾輩は猫')
    expect(b.children.map(shape)).toEqual([
      ['text', '　'],
      ['emphasis', 'sesame', [['ruby', '吾輩', 'わがはい'], ['text', 'は']]],
      ['text', '猫']
    ])
    assertOffsetsConsistent(b)
  })

  it('範囲指定は行をまたいで継続する', () => {
    const r = parseBody('　［＃ここから傍点］一行目\n二行目［＃ここで傍点終わり］\n　三行目')
    const blocks = r.chapters.flatMap((c) => c.blocks).filter((b) => b.plainText !== '')
    expect(blocks[0]!.children.map(shape)).toEqual([
      ['text', '　'],
      ['emphasis', 'sesame', [['text', '一行目']]]
    ])
    expect(blocks[1]!.children.map(shape)).toEqual([
      ['emphasis', 'sesame', [['text', '二行目']]]
    ])
    expect(blocks[2]!.children.map(shape)).toEqual([['text', '　三行目']])
  })
})

describe('字下げ', () => {
  it('単発の字下げは その行だけに適用される', () => {
    const r = parseBody('［＃２字下げ］二字下げの行\n通常の行')
    const bs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.plainText !== '')
    expect(bs[0]!.indentLevel).toBe(2)
    expect(bs[1]!.indentLevel).toBe(0)
  })

  it('ここから〜ここで字下げ終わり が範囲に適用される', () => {
    const r = parseBody('［＃ここから３字下げ］\n一行目\n二行目\n［＃ここで字下げ終わり］\n三行目')
    const bs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.plainText !== '')
    expect(bs.map((b) => b.indentLevel)).toEqual([3, 3, 0])
  })

  it('折り返し指定つきでも先頭の値を採る', () => {
    const r = parseBody('［＃ここから２字下げ、折り返して４字下げ］\n行')
    const bs = r.chapters.flatMap((c) => c.blocks).filter((b) => b.plainText !== '')
    expect(bs[0]!.indentLevel).toBe(2)
  })
})

describe('外字', () => {
  it('名前指定をUnicodeに変換する', () => {
    const b = firstBlock('　※［＃ローマ数字1、1-13-21］章')
    expect(b.plainText).toBe('　Ⅰ章')
    expect((b.children.map(shape) as unknown[])[1]).toEqual(['gaiji', 'Ⅰ', 'unicode'])
    assertOffsetsConsistent(b)
  })

  it('丸数字を変換する', () => {
    expect(firstBlock('※［＃丸3］').plainText).toBe('③')
  })

  it('面区点表からUnicodeに変換する', () => {
    const b = firstBlock('　※［＃「弓＋耳」、第3水準1-84-22］の字')
    expect(b.plainText).toBe('　弴の字')
    expect((b.children.map(shape) as unknown[])[1]).toEqual(['gaiji', '弴', 'unicode'])
    assertOffsetsConsistent(b)
  })

  it('面区点が表に無い合成指定は代替文字にフォールバックする', () => {
    const b = firstBlock('　※［＃「弓＋耳」、第9水準9-99-99］の字')
    const g = b.children.map(shape)[1] as unknown[]
    expect(g[0]).toBe('gaiji')
    expect(g[2]).toBe('substitute')
    expect(g[1]).toBe('弓')
    assertOffsetsConsistent(b)
  })

  it('【UTF-16】サロゲートペアの外字でもオフセットが整合する', () => {
    // 1-47-52 は U+20B9F(𠮟)。1文字だが UTF-16 では2コードユニット。
    const b = firstBlock('　※［＃「口＋七」、第3水準1-47-52］る')
    expect(b.plainText).toBe('　𠮟る')
    expect(b.plainText.length).toBe(4) // 全角空白1 + サロゲートペア2 + る1
    const g = b.children[1]!
    expect(g.kind).toBe('gaiji')
    expect(g.start).toBe(1)
    expect(g.end).toBe(3)
    expect(b.plainText.slice(g.start, g.end)).toBe('𠮟')
    assertOffsetsConsistent(b)
  })

  it('解決不能でもプレースホルダーで本文を継続する', () => {
    const r = parseBody('　※［＃謎の文字、9-99-99］があっても続く')
    const b = r.chapters.flatMap((c) => c.blocks).find((x) => x.plainText !== '')!
    expect(b.plainText).toContain('があっても続く')
    expect((b.children.map(shape) as unknown[])[1]).toEqual(['gaiji', '〓', 'placeholder'])
    expect(r.issues.some((i) => i.kind === 'unresolved-gaiji')).toBe(true)
    assertOffsetsConsistent(b)
  })
})

describe('縦中横', () => {
  it('対象指定を TcyNode にする', () => {
    const b = firstBlock('　明治４２［＃「４２」は縦中横］年')
    expect(b.plainText).toBe('　明治４２年')
    expect(b.children.map(shape)).toEqual([
      ['text', '　明治'],
      ['tcy', '４２'],
      ['text', '年']
    ])
    assertOffsetsConsistent(b)
  })
})

describe('改ページ / 画像 / 罫線', () => {
  it('改ページはブロックになる', () => {
    const r = parseBody('前［＃「前」は大見出し］\n［＃改ページ］\n後')
    expect(r.chapters.flatMap((c) => c.blocks).some((b) => b.type === 'pageBreak')).toBe(true)
  })

  it('挿絵を画像ブロックにする', () => {
    const r = parseBody('［＃「fig1.png」の図（fig1.png、横321×縦123）入る］')
    const img = r.chapters.flatMap((c) => c.blocks).find((b) => b.type === 'image')!
    expect(img.image).toMatchObject({ src: 'fig1.png', width: 321, height: 123 })
  })
})

describe('不正注記 / 頑健性', () => {
  it('未対応注記はゼロ幅 note として保持し本文を壊さない', () => {
    const b = firstBlock('　本文［＃地から３字上げ］の続き')
    expect(b.plainText).toBe('　本文の続き')
    const note = b.children.map(shape).find((s) => (s as unknown[])[0] === 'note')
    expect(note).toEqual(['note', '地から３字上げ'])
    assertOffsetsConsistent(b)
  })

  it('閉じていない注記でクラッシュしない', () => {
    expect(() => parseBody('　本文［＃壊れた注記')).not.toThrow()
    const r = parseBody('　本文［＃壊れた注記')
    expect(r.issues.some((i) => i.kind === 'malformed-annotation')).toBe(true)
  })

  it('閉じていないルビでクラッシュしない', () => {
    const b = firstBlock('　吾輩《わがはい')
    expect(b.plainText).toBe('　吾輩《わがはい')
  })

  it('対応する開始が無い終了注記を記録する', () => {
    const r = parseBody('　本文［＃傍点終わり］')
    expect(r.issues.some((i) => i.kind === 'unclosed-span')).toBe(true)
  })

  it('対象文字列が見つからない場合を記録する', () => {
    const r = parseBody('　本文［＃「存在しない」に傍点］')
    expect(r.issues.some((i) => i.kind === 'unmatched-target')).toBe(true)
  })

  it('空入力でも最低1章を返す', () => {
    const r = parseAozora('')
    expect(r.chapters.length).toBeGreaterThanOrEqual(1)
  })
})

describe('複数注記の組合せ', () => {
  it('ルビ・傍点・外字・縦中横が同居しても整合する', () => {
    const b = firstBlock(
      '　吾輩《わがはい》は※［＃ローマ数字2、1-13-22］の大事［＃「大事」に傍点］な４２［＃「４２」は縦中横］匹目'
    )
    expect(b.plainText).toBe('　吾輩はⅡの大事な４２匹目')
    expect(b.children.map(shape)).toEqual([
      ['text', '　'],
      ['ruby', '吾輩', 'わがはい'],
      ['text', 'は'],
      ['gaiji', 'Ⅱ', 'unicode'],
      ['text', 'の'],
      ['emphasis', 'sesame', [['text', '大事']]],
      ['text', 'な'],
      ['tcy', '４２'],
      ['text', '匹目']
    ])
    assertOffsetsConsistent(b)
  })

  it('入れ子の装飾を保持する', () => {
    const b = firstBlock('　［＃傍点］外［＃太字］内［＃太字終わり］側［＃傍点終わり］')
    expect(b.plainText).toBe('　外内側')
    expect(b.children.map(shape)).toEqual([
      ['text', '　'],
      [
        'emphasis',
        'sesame',
        [['text', '外'], ['bold', [['text', '内']]], ['text', '側']]
      ]
    ])
    assertOffsetsConsistent(b)
  })
})

describe('ヘッダとメタデータ', () => {
  it('タイトルと著者を取り出す', () => {
    const r = parseAozora('こころ\n夏目漱石\n\n　本文。\n')
    expect(r.title).toBe('こころ')
    expect(r.author).toBe('夏目漱石')
    expect(r.subtitle).toBeNull()
  })

  it('副題と翻訳者を取り出す', () => {
    const r = parseAozora('車輪の下\n副題です\nヘルマン・ヘッセ\n実吉捷郎 訳\n\n　本文。\n')
    expect(r.title).toBe('車輪の下')
    expect(r.subtitle).toBe('副題です')
    expect(r.author).toBe('ヘルマン・ヘッセ')
    expect(r.translator).toBe('実吉捷郎 訳')
  })

  it('ヘッダのルビを取り除く', () => {
    const r = parseAozora('吾輩《わがはい》は猫である\n夏目漱石\n\n　本文。\n')
    expect(r.title).toBe('吾輩は猫である')
  })

  it('凡例ブロックと底本を本文から除外する', () => {
    const src = [
      'こころ',
      '夏目漱石',
      '',
      '-------------------------------------------------------',
      '【テキスト中に現れる記号について】',
      '《》：ルビ',
      '-------------------------------------------------------',
      '',
      '　本文である。',
      '',
      '底本：「こころ」新潮文庫',
      '入力：だれか'
    ].join('\n')
    const r = parseAozora(src)
    const body = r.chapters.flatMap((c) => c.blocks).map((b) => b.plainText).join('')
    expect(body).toBe('　本文である。')
    expect(r.metadata.legend).toContain('《》：ルビ')
    expect(r.metadata.bibliography).toContain('新潮文庫')
    expect(body).not.toContain('底本')
  })
})
