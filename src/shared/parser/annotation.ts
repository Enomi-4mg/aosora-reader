/**
 * 青空文庫注記 ［＃...］ の分類。
 *
 * ここが「青空文庫固有の知識」を閉じ込める唯一の場所(要件 §20-4)。
 * 分類結果は表示に依存しない中立的な形にして返し、
 * Renderer 側は Document Model しか見なくて済むようにする。
 */
import type { EmphasisMark, UnderlineStyle } from '../model/document'
import { toHalfWidthDigits } from './gaiji'

/** 装飾の種類。範囲指定・対象指定のどちらの形でも同じ値になる。 */
export type DecorationKind = 'emphasis' | 'bold' | 'underline' | 'tcy'

export interface Decoration {
  kind: DecorationKind
  mark?: EmphasisMark
  style?: UnderlineStyle
}

export type Annotation =
  /** ［＃改ページ］など */
  | { type: 'page-break' }
  /** ［＃N字下げ］— 直後の1行に適用 */
  | { type: 'indent'; level: number }
  /** ［＃ここからN字下げ］ */
  | { type: 'indent-start'; level: number }
  /** ［＃ここで字下げ終わり］ */
  | { type: 'indent-end' }
  /** ［＃「X」は大見出し］— 直前のテキスト X を見出しにする */
  | { type: 'heading-target'; level: 1 | 2 | 3; target: string }
  /** ［＃ここから大見出し］/［＃大見出し］ */
  | { type: 'heading-start'; level: 1 | 2 | 3 }
  /** ［＃ここで大見出し終わり］/［＃大見出し終わり］ */
  | { type: 'heading-end'; level: 1 | 2 | 3 }
  /** ［＃「X」に傍点］— 直前のテキスト X に装飾を適用 */
  | { type: 'decoration-target'; decoration: Decoration; target: string }
  /** ［＃傍点］/［＃ここから傍点］ */
  | { type: 'decoration-start'; decoration: Decoration }
  /** ［＃傍点終わり］/［＃ここで傍点終わり］ */
  | { type: 'decoration-end'; decoration: Decoration }
  /** ［＃挿絵（fig.png）入る］ */
  | {
      type: 'image'
      src: string
      alt: string
      caption?: string
      width?: number
      height?: number
    }
  /** ［＃「X」はキャプション］— 直前の図に属する説明行であることの指定 */
  | { type: 'caption'; target: string }
  /** 罫線 */
  | { type: 'horizontal-rule' }
  /** 未対応。ゼロ幅の note ノードとして保持する。 */
  | { type: 'unknown'; raw: string }

const HEADING_LEVELS: Array<[string, 1 | 2 | 3]> = [
  ['大見出し', 1],
  ['中見出し', 2],
  ['小見出し', 3]
]

const EMPHASIS_MARKS: Array<[string, EmphasisMark]> = [
  // 長いものから先に照合する(「白ゴマ傍点」が「傍点」に食われないように)
  ['白ゴマ傍点', 'white-sesame'],
  ['二重丸傍点', 'double-dot'],
  ['白丸傍点', 'white-dot'],
  ['蛇の目傍点', 'bullseye'],
  ['白三角傍点', 'white-triangle'],
  ['三角傍点', 'triangle'],
  ['丸傍点', 'dot'],
  ['×傍点', 'x'],
  ['ゴマ傍点', 'sesame'],
  ['傍点', 'sesame']
]

const UNDERLINE_STYLES: Array<[string, UnderlineStyle]> = [
  ['二重傍線', 'double'],
  ['鎖線', 'dotted'],
  ['破線', 'dashed'],
  ['波線', 'wave'],
  ['傍線', 'solid']
]

/** 装飾語を Decoration に変換する。該当しなければ null。 */
function matchDecoration(word: string): Decoration | null {
  for (const [needle, mark] of EMPHASIS_MARKS) {
    if (word === needle) return { kind: 'emphasis', mark }
  }
  for (const [needle, style] of UNDERLINE_STYLES) {
    if (word === needle) return { kind: 'underline', style }
  }
  if (word === '太字') return { kind: 'bold' }
  if (word === '縦中横') return { kind: 'tcy' }
  return null
}

function parseNumber(s: string): number {
  const n = parseInt(toHalfWidthDigits(s), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * 注記本文(［＃ と ］ を除いた中身)を分類する。
 */
export function classifyAnnotation(body: string): Annotation {
  const b = body.trim()

  // --- 改ページ系 ---
  if (b === '改ページ' || b === '改丁' || b === '改段' || b === '改行') {
    return { type: 'page-break' }
  }
  if (b === '罫線' || b === 'ここで罫線') return { type: 'horizontal-rule' }

  // --- 字下げ ---
  // ［＃ここから２字下げ、折り返して４字下げ］のような複合形は先頭の値を採る
  let m = b.match(/^ここから(.+?)字下げ/)
  if (m) return { type: 'indent-start', level: parseNumber(m[1]!) }
  if (/^ここで字下げ終わり$/.test(b) || /^ここで字下げおわり$/.test(b)) {
    return { type: 'indent-end' }
  }
  m = b.match(/^(.+?)字下げ$/)
  if (m) return { type: 'indent', level: parseNumber(m[1]!) }

  // --- 見出し ---
  for (const [word, level] of HEADING_LEVELS) {
    // ［＃「第一章」は大見出し］
    const target = b.match(new RegExp(`^「(.+)」は${word}$`))
    if (target) return { type: 'heading-target', level, target: target[1]! }
    if (b === `ここから${word}` || b === word) {
      return { type: 'heading-start', level }
    }
    if (b === `ここで${word}終わり` || b === `${word}終わり`) {
      return { type: 'heading-end', level }
    }
  }

  // --- 装飾(対象指定): ［＃「X」に傍点］/［＃「X」は太字］ ---
  m = b.match(/^「(.+)」[には](.+)$/)
  if (m) {
    const d = matchDecoration(m[2]!.trim())
    if (d) return { type: 'decoration-target', decoration: d, target: m[1]! }
  }

  // --- 装飾(範囲指定) ---
  m = b.match(/^ここから(.+)$/)
  if (m) {
    const d = matchDecoration(m[1]!.trim())
    if (d) return { type: 'decoration-start', decoration: d }
  }
  m = b.match(/^ここで(.+?)終わり$/)
  if (m) {
    const d = matchDecoration(m[1]!.trim())
    if (d) return { type: 'decoration-end', decoration: d }
  }
  m = b.match(/^(.+?)終わり$/)
  if (m) {
    const d = matchDecoration(m[1]!.trim())
    if (d) return { type: 'decoration-end', decoration: d }
  }
  {
    const d = matchDecoration(b)
    if (d) return { type: 'decoration-start', decoration: d }
  }

  // --- キャプション ---
  // ［＃「X」はキャプション］。X は直前の行に本文として実在するので、
  // ここでは「この行は図の説明である」という事実だけを返す。
  m = b.match(/^「(.+)」は(?:キャプション|図のキャプション)$/)
  if (m) return { type: 'caption', target: m[1]! }

  // --- 画像 ---
  // ［＃挿絵（fig1.png）入る］
  // ［＃第六図（fig1.png、横260×縦537）入る］
  // ［＃「第一図」のキャプション付きの図（fig1.png、横321×縦123）入る］
  // 「入る。」のように句点で閉じる作品がある
  if (/入る[。．]?$/.test(b)) {
    const file = b.match(/([\w.-]+\.(?:png|jpg|jpeg|gif))/i)
    if (file) {
      const size = toHalfWidthDigits(b).match(/横(\d+)×縦(\d+)/)
      const label = describeImage(b)
      const img: Annotation = {
        type: 'image',
        src: file[1]!,
        alt: label.alt,
        ...(label.caption !== undefined ? { caption: label.caption } : {}),
        ...(size
          ? { width: parseInt(size[1]!, 10), height: parseInt(size[2]!, 10) }
          : {})
      }
      return img
    }
  }

  return { type: 'unknown', raw: body }
}

/**
 * 画像注記から、人が読める説明とキャプションを取り出す。
 *
 * 注記本文をそのまま alt にすると「挿絵（fig46817_01.png、横1238×縦785）」のような
 * ファイル名混じりの文字列が読み上げと代替表示に出てしまう。
 * 青空文庫の書式は「説明（ファイル名、寸法）入る」に揃っているので、
 * 丸括弧の前までが説明にあたる。
 */
function describeImage(body: string): { alt: string; caption?: string } {
  const head = body
    .replace(/入る[。．]?$/, '')
    .replace(/（[^（）]*）\s*$/, '')
    .trim()

  // ［＃「X」のキャプション付きの挿絵（…）入る］ — X が図のキャプション
  const captioned = head.match(/^「(.+)」のキャプション付きの(?:挿絵|図|写真|画像)\d*$/)
  if (captioned) return { alt: captioned[1]!, caption: captioned[1]! }

  // ［＃「X」の図（…）入る］ — X は説明だが、キャプションとして組むとは限らない
  const described = head.match(/^「(.+)」の(?:挿絵|図|写真|画像)\d*$/)
  if (described) return { alt: described[1]! }

  return { alt: head === '' ? '挿絵' : head }
}
