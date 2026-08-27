/**
 * 任意の TextRange を塗る唯一の窓口。
 *
 * CSS Custom Highlight API を使う理由: multicolumn + transform の座標系で
 * 絶対配置のオーバーレイを自前計算すると、ページ境界・段組・縦書きの
 * どれかで必ず破綻する。ハイライト・検索一致・読み上げ中の文を
 * すべてこの API に集約すれば、幾何計算そのものが不要になる。
 *
 * 実際の色は theme.css の ::highlight(...) 側で決める。内部では固定の色名で扱う。
 */
import type { TextRange } from '@shared/model/position'
import { textRangeToDomRange } from './positionMapping'

export const HIGHLIGHT_NAMES = {
  yellow: 'aozora-yellow',
  green: 'aozora-green',
  blue: 'aozora-blue',
  red: 'aozora-red',
  search: 'aozora-search',
  searchCurrent: 'aozora-search-current',
  tts: 'aozora-tts'
} as const

export type HighlightName = (typeof HIGHLIGHT_NAMES)[keyof typeof HIGHLIGHT_NAMES]

function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
}

/** 指定した名前のハイライトを、与えられた Range 群で置き換える。 */
export function setHighlight(name: HighlightName, ranges: Range[]): void {
  if (!supported()) return
  if (ranges.length === 0) {
    CSS.highlights.delete(name)
    return
  }
  CSS.highlights.set(name, new Highlight(...ranges))
}

export function clearHighlight(name: HighlightName): void {
  if (!supported()) return
  CSS.highlights.delete(name)
}

interface MatchLike {
  range: TextRange
}

/**
 * 検索結果を描画する。描画されていない章の一致は単に無視される
 * (章単位レンダリングでは正常な状態)。
 */
export function paintHighlights(
  root: ParentNode,
  matches: MatchLike[],
  current: MatchLike | null
): void {
  const all: Range[] = []
  for (const m of matches) {
    if (m === current) continue
    const r = textRangeToDomRange(m.range, root)
    if (r) all.push(r)
  }
  setHighlight(HIGHLIGHT_NAMES.search, all)

  const cur = current ? textRangeToDomRange(current.range, root) : null
  setHighlight(HIGHLIGHT_NAMES.searchCurrent, cur ? [cur] : [])
}
