/**
 * 外字(※［＃...］)の解決。
 *
 * 要件 §4.2 の優先順位に従う:
 *   1. Unicode 対応文字へ変換
 *   2. 代替文字
 *   3. 画像
 *   4. プレースホルダー表示
 *
 * **解析不能な外字で本文全体のレンダリングを止めない**。必ず何らかの
 * plainText を返し、resolution で「どこまで解決できたか」を伝える。
 */
import type { GaijiNode, GaijiResolution } from '../model/document'
import kutenTable from '../data/gaiji-kuten.json'

const KUTEN: Record<string, string> = kutenTable as Record<string, string>

/** 名前で指定される外字。面区点が無い/表に無い場合のフォールバックにもなる。 */
const NAMED: Record<string, string> = (() => {
  const m: Record<string, string> = {
    感嘆符二つ: '‼',
    感嘆符疑問符: '⁉',
    疑問符感嘆符: '⁈',
    疑問符二つ: '⁇',
    二の字点: '〻',
    小書き平仮名か: 'ゕ',
    小書き平仮名け: 'ゖ',
    小書き片仮名ク: 'ㇰ',
    小書き片仮名シ: 'ㇱ',
    小書き片仮名ス: 'ㇲ',
    小書き片仮名ト: 'ㇳ',
    小書き片仮名ヌ: 'ㇴ',
    小書き片仮名ハ: 'ㇵ',
    小書き片仮名ヒ: 'ㇶ',
    小書き片仮名フ: 'ㇷ',
    小書き片仮名ヘ: 'ㇸ',
    小書き片仮名ホ: 'ㇹ',
    小書き片仮名ム: 'ㇺ',
    小書き片仮名ラ: 'ㇻ',
    小書き片仮名ル: 'ㇽ',
    小書き片仮名レ: 'ㇾ',
    小書き片仮名ロ: 'ㇿ'
  }
  const romanUpper = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ'
  const romanLower = 'ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ'
  for (let i = 0; i < 12; i++) {
    m[`ローマ数字${i + 1}`] = romanUpper[i]!
    m[`小書きローマ数字${i + 1}`] = romanLower[i]!
  }
  for (let i = 0; i < 20; i++) {
    m[`丸${i + 1}`] = String.fromCodePoint(0x2460 + i)
  }
  return m
})()

/** 全角数字を半角に直す。注記中の数値は全角で書かれることが多い。 */
export function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  )
}

/** 注記本文から面区点(例 "1-84-22")を取り出す。 */
export function extractKuten(body: string): string | null {
  const m = toHalfWidthDigits(body).match(/(\d+)-(\d+)-(\d+)/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export interface GaijiResolveResult {
  text: string
  resolution: GaijiResolution
  kuten?: string
  src?: string
}

/**
 * 外字注記の本文(※［＃ と ］ のあいだ)を解決する。
 * 例: 「弓＋耳」、第3水準1-84-22
 */
export function resolveGaiji(body: string): GaijiResolveResult {
  const kuten = extractKuten(body)

  // 1. 面区点 → Unicode
  if (kuten) {
    const ch = KUTEN[kuten]
    if (ch) return { text: ch, resolution: 'unicode', kuten }
  }

  // 1'. 名前指定 → Unicode
  const nameKey = body.split(/[、，]/)[0]?.trim() ?? ''
  const named = NAMED[nameKey]
  if (named) {
    return kuten
      ? { text: named, resolution: 'unicode', kuten }
      : { text: named, resolution: 'unicode' }
  }

  // 2. 代替文字: 「A＋B」のような合成指定は、説明を括弧書きで見せるより
  //    構成要素の1文字目を出したほうが読みを妨げない
  const composed = body.match(/^「([^」]+)」/)
  if (composed) {
    const parts = composed[1]!
    // 「二の字点」のような説明語ではなく実際の漢字合成のときだけ代替する
    const first = [...parts].find((c) => /\p{Script=Han}/u.test(c))
    if (first && /[＋+／/×]/.test(parts)) {
      return kuten
        ? { text: first, resolution: 'substitute', kuten }
        : { text: first, resolution: 'substitute' }
    }
  }

  // 3. 画像指定
  const img = body.match(/([\w.-]+\.(?:png|jpg|jpeg|gif))/i)
  if (img) {
    return { text: '□', resolution: 'image', src: img[1]! }
  }

  // 4. プレースホルダー。本文は止めない。
  return kuten
    ? { text: '〓', resolution: 'placeholder', kuten }
    : { text: '〓', resolution: 'placeholder' }
}

export function makeGaijiNode(
  start: number,
  body: string,
  r: GaijiResolveResult
): GaijiNode {
  const node: GaijiNode = {
    kind: 'gaiji',
    start,
    end: start + r.text.length,
    text: r.text,
    resolution: r.resolution,
    description: body
  }
  if (r.kuten) node.kuten = r.kuten
  if (r.src) node.src = r.src
  return node
}
