/**
 * DOM ↔ TextPosition の唯一の橋。
 *
 * ハイライト・選択・検索・読書位置・読み上げは、すべてこのモジュールを通す。
 * ここ以外の場所で DOM オフセットを直接いじってはいけない。
 *
 * 【前提】dom/contract.ts の DOM 規約と、Block.plainText が UTF-16 オフセットで
 * 表現されていること(不変条件 A)。DOM の Range.startOffset も UTF-16 なので、
 * 両者のあいだに変換は必要ない。
 */
import type { TextPosition, TextRange } from '@shared/model/position'
import {
  ATTR_BLOCK,
  ATTR_CHAPTER,
  ATTR_START,
  SELECTOR_BLOCK,
  SELECTOR_RUN,
  isExcludedFromText
} from './contract'

/** run 要素からその run が担当する plainText 開始オフセットを読む。 */
function runStart(run: Element): number {
  const v = run.getAttribute(ATTR_START)
  const n = v === null ? NaN : Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : 0
}

/** run 内のテキスト長。<rt>(ルビの読み)は数えない。 */
export function runTextLength(run: Element): number {
  let n = 0
  walkText(run, (t) => {
    n += t.data.length
    return false
  })
  return n
}

/**
 * root の子孫のテキストノードを文書順に辿る。<rt> 配下は plainText に含まれないので飛ばす。
 * visit が true を返したら打ち切る。
 */
function walkText(root: Node, visit: (t: Text) => boolean): boolean {
  for (let c = root.firstChild; c !== null; c = c.nextSibling) {
    if (walkNode(c, visit)) return true
  }
  return false
}

/**
 * node 自身とその子孫を辿る。テキストノードを単体で渡せるようにするための入口。
 *
 * ここを walkText で代用してはいけない。walkText は firstChild から nextSibling を
 * 追うので、テキストノードを渡すと**その後ろの兄弟まで**数えてしまう。
 */
function walkNode(node: Node, visit: (t: Text) => boolean): boolean {
  if (isExcludedFromText(node)) return false
  if (node.nodeType === Node.TEXT_NODE) return visit(node as Text)
  return walkText(node, visit)
}

/** run 内のテキストノードを文書順に集める。<rt> は除外する。 */
export function runTextNodes(run: Element): Text[] {
  const out: Text[] = []
  walkText(run, (t) => {
    out.push(t)
    return false
  })
  return out
}

/**
 * run 内の指定オフセットに 1 文字分の Range を作る。
 * ページ境界の文字位置を幾何から二分探索するために使う。
 */
export function rangeAtRunOffset(run: Element, offset: number): Range | null {
  const nodes = runTextNodes(run)
  let remaining = offset
  for (const t of nodes) {
    if (remaining < t.data.length) {
      const r = document.createRange()
      r.setStart(t, remaining)
      r.setEnd(t, remaining + 1)
      return r
    }
    remaining -= t.data.length
  }
  const last = nodes[nodes.length - 1]
  if (!last || last.data.length === 0) return null
  const r = document.createRange()
  r.setStart(last, last.data.length - 1)
  r.setEnd(last, last.data.length)
  return r
}

/** ノードを含む最も近い run 要素。 */
function closestRun(node: Node): Element | null {
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el?.closest(SELECTOR_RUN) ?? null
}

function closestBlock(node: Node): Element | null {
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el?.closest(SELECTOR_BLOCK) ?? null
}

/**
 * DOM 上の一点を TextPosition に変換する。
 * 対応する run が見つからない場合は null(選択が本文外にある等)。
 */
export function domPointToPosition(
  bookId: string,
  node: Node,
  offset: number
): TextPosition | null {
  const block = closestBlock(node)
  if (!block) return null
  const blockId = block.getAttribute(ATTR_BLOCK)
  const chapterId = block.getAttribute(ATTR_CHAPTER)
  if (!blockId || !chapterId) return null

  const run = closestRun(node)
  if (!run) {
    // run の外(段落の隙間など)を指している場合は Block 内で最も近い境界に寄せる
    return { bookId, chapterId, blockId, offset: nearestBoundary(block, node) }
  }

  let local = 0
  if (node.nodeType === Node.TEXT_NODE) {
    // 目的のテキストノードまでの長さを積む
    let found = false
    walkText(run, (t) => {
      if (t === node) {
        local += Math.min(offset, t.data.length)
        found = true
        return true
      }
      local += t.data.length
      return false
    })
    if (!found) local = Math.min(offset, runTextLength(run))
  } else {
    // 要素境界を指している場合。offset は子ノードのインデックス。
    const children = Array.from(node.childNodes).slice(0, offset)
    for (const c of children) {
      walkNode(c, (t) => {
        local += t.data.length
        return false
      })
    }
  }

  return { bookId, chapterId, blockId, offset: runStart(run) + local }
}

/** run の外を指しているときに、Block 内の妥当なオフセットへ寄せる。 */
function nearestBoundary(block: Element, node: Node): number {
  const runs = Array.from(block.querySelectorAll(SELECTOR_RUN))
  if (runs.length === 0) return 0
  for (const run of runs) {
    const pos = run.compareDocumentPosition(node)
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return runStart(run)
  }
  const last = runs[runs.length - 1]!
  return runStart(last) + runTextLength(last)
}

/** DOM Range を TextRange に変換する。 */
export function domRangeToTextRange(
  bookId: string,
  range: Range
): TextRange | null {
  const start = domPointToPosition(bookId, range.startContainer, range.startOffset)
  const end = domPointToPosition(bookId, range.endContainer, range.endOffset)
  if (!start || !end) return null
  return { start, end }
}

/** 現在の選択範囲を TextRange にする。選択が無ければ null。 */
export function selectionToTextRange(
  bookId: string,
  root: ParentNode = document
): TextRange | null {
  const sel = (root as Document).getSelection?.() ?? window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  return domRangeToTextRange(bookId, sel.getRangeAt(0))
}

export interface DomPoint {
  node: Node
  offset: number
}

/**
 * TextPosition を DOM 上の一点に解決する。
 * その Block がまだ描画されていない場合は null(章単位レンダリングでは通常の状態)。
 */
export function positionToDomPoint(
  p: TextPosition,
  root: ParentNode = document
): DomPoint | null {
  const block = root.querySelector(`[${ATTR_BLOCK}="${cssEscape(p.blockId)}"]`)
  if (!block) return null

  const runs = Array.from(block.querySelectorAll(SELECTOR_RUN))
  if (runs.length === 0) return { node: block, offset: 0 }

  // offset を含む run を探す。境界は「次の run の先頭」ではなく
  // 「その run の末尾」に寄せて、行末での位置復元を安定させる。
  let target: Element | null = null
  for (const run of runs) {
    const s = runStart(run)
    const e = s + runTextLength(run)
    if (p.offset >= s && p.offset <= e) {
      target = run
      if (p.offset < e) break
    }
  }
  if (!target) target = p.offset <= runStart(runs[0]!) ? runs[0]! : runs[runs.length - 1]!

  let remaining = p.offset - runStart(target)
  let result: DomPoint | null = null
  walkText(target, (t) => {
    if (remaining <= t.data.length) {
      result = { node: t, offset: Math.max(0, remaining) }
      return true
    }
    remaining -= t.data.length
    return false
  })

  return result ?? { node: target, offset: 0 }
}

/** TextRange を DOM Range に解決する。復元できなければ null。 */
export function textRangeToDomRange(
  r: TextRange,
  root: ParentNode = document
): Range | null {
  const s = positionToDomPoint(r.start, root)
  const e = positionToDomPoint(r.end, root)
  if (!s || !e) return null

  // start > end になっていたら入れ替える(復元時のずれに備える)。
  // Range に入れてから直すことはできない。setEnd は end が start より前のとき
  // Range をその一点へ潰してしまい、逆転していた事実が消えるため。
  const [from, to] = isBefore(e, s) ? [e, s] : [s, e]

  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return null
  }
  return range
}

/** DOM 上で a が b より前にあるか。 */
function isBefore(a: DomPoint, b: DomPoint): boolean {
  if (a.node === b.node) return a.offset < b.offset
  const rel = a.node.compareDocumentPosition(b.node)
  return (rel & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/** Block 要素そのものを取得する。 */
export function findBlockElement(
  blockId: string,
  root: ParentNode = document
): Element | null {
  return root.querySelector(`[${ATTR_BLOCK}="${cssEscape(blockId)}"]`)
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"')
}
